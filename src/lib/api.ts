import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { t } from "../i18n";
import { browserInvoke, browserListen } from "./browser-preview";
import { isTauri } from "./runtime";
import type {
  CatalogPayload,
  CuratedCatalog,
  DiscoveryCatalog,
  EnvProbe,
  InstancePatch,
  InstalledPlugin,
  LauncherState,
  ProfileInfo,
  SettingsPatch,
} from "./types";

export type BackendKind = "tauri" | "http" | "mock";

const BRIDGE = "http://127.0.0.1:1422";
const backendListeners = new Set<(kind: BackendKind) => void>();

let kind: BackendKind = isTauri() ? "tauri" : "mock";
let everHttp = false;
let mockSettled = false;
let probeTask: Promise<BackendKind> | null = null;

// ---------------------------------------------------------------------------
// 事件 fan-out：监听方只注册到本地 hub；实际通道（tauri listen / 共享 EventSource /
// mock 发射器）按当前 backend 绑定，backend 切换（如 mock → http）时自动重绑，
// 避免监听永远留在旧通道上。
// ---------------------------------------------------------------------------
type Handler = (payload: unknown) => void;
const hub = new Map<string, Set<Handler>>();
let unbindChannel: (() => void) | null = null;

function dispatch(event: string, payload: unknown) {
  hub.get(event)?.forEach((handler) => handler(payload));
}

function bindChannel() {
  unbindChannel?.();
  unbindChannel = null;
  const events = [...hub.keys()];
  if (events.length === 0) return;
  if (kind === "tauri") {
    const pending = events.map((ev) => tauriListen(ev, (e) => dispatch(ev, e.payload)));
    unbindChannel = () => {
      void Promise.all(pending).then((unsubs) => unsubs.forEach((u) => u()));
    };
  } else if (kind === "http") {
    const source = new EventSource(`${BRIDGE}/events`);
    const onFrame = (ev: MessageEvent) => {
      try {
        dispatch(ev.type, JSON.parse(ev.data));
      } catch {
        /* 忽略坏帧 */
      }
    };
    events.forEach((ev) => source.addEventListener(ev, onFrame as EventListener));
    unbindChannel = () => {
      events.forEach((ev) => source.removeEventListener(ev, onFrame as EventListener));
      source.close();
    };
  } else {
    const unsubs = events.map((ev) => browserListen(ev, (e) => dispatch(ev, e.payload)));
    unbindChannel = () => unsubs.forEach((u) => u());
  }
}

function setKind(next: BackendKind) {
  const prev = kind;
  if (next === "http") everHttp = true;
  if (next === "mock") mockSettled = true;
  if (next !== "mock") mockSettled = false;
  kind = next;
  if (prev !== next) {
    bindChannel();
    backendListeners.forEach((fn) => fn(kind));
  }
}

async function probeHttp(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(attempts: number, delayBase = 250): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await probeHttp()) return true;
    if (i < attempts - 1) await sleep(delayBase * (i + 1));
  }
  return false;
}

async function ensureBackend(): Promise<BackendKind> {
  if (isTauri()) {
    setKind("tauri");
    return "tauri";
  }
  if (kind === "http" && (await probeHttp())) return "http";
  if (everHttp) {
    if (await waitForHttp(4, 300)) {
      setKind("http");
      return "http";
    }
    return "http";
  }
  // 已判定 mock 后不再反复等探测：发现网页桥交给后台轮询，
  // 否则纯预览模式下每次 invoke 都要空等一轮重试
  if (mockSettled) return "mock";
  if (!probeTask) {
    probeTask = (async () => {
      if (await waitForHttp(8, 250)) {
        setKind("http");
        return "http";
      }
      setKind("mock");
      return "mock";
    })().finally(() => {
      probeTask = null;
    });
  }
  return probeTask;
}

export function subscribeBackend(fn: (kind: BackendKind) => void): () => void {
  backendListeners.add(fn);
  if (isTauri()) {
    fn("tauri");
  } else {
    void ensureBackend().then(fn);
  }
  return () => {
    backendListeners.delete(fn);
  };
}

if (!isTauri()) {
  void ensureBackend();
  window.setInterval(() => {
    void (async () => {
      if (isTauri()) return;
      if (await probeHttp()) setKind("http");
    })();
  }, 2000);
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const resolved = await ensureBackend();
  if (resolved === "tauri") return tauriInvoke<T>(cmd, args);
  if (resolved === "http" || everHttp) {
    try {
      return await httpInvoke<T>(cmd, args);
    } catch (e) {
      if (await probeHttp()) return httpInvoke<T>(cmd, args);
      // 真连过桥之后掉线必须报错，不允许静默退回假数据
      if (everHttp) throw new Error(t("error.bridgeUnavailable"), { cause: e });
      setKind("mock");
      throw e instanceof Error ? e : new Error(t("error.bridgeFailed"), { cause: e });
    }
  }
  return browserInvoke<T>(cmd, args);
}

async function httpInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BRIDGE}/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd, args: args ?? {} }),
  });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(json.error || t("error.bridgeFailed"));
  return json.data as T;
}

export function listen<T>(event: string, handler: (payload: T) => void): () => void {
  let set = hub.get(event);
  if (!set) {
    set = new Set();
    hub.set(event, set);
    bindChannel();
  }
  const wrapped = handler as Handler;
  set.add(wrapped);
  return () => {
    set.delete(wrapped);
    if (set.size === 0) {
      hub.delete(event);
      bindChannel();
    }
  };
}

export const api = {
  getState: () => invoke<LauncherState>("get_state"),
  saveSettings: (patch: SettingsPatch) => invoke<LauncherState>("save_settings", { patch }),
  upsertInstance: (patch: InstancePatch) => invoke<LauncherState>("upsert_instance", { patch }),
  removeInstance: (id: string) => invoke<LauncherState>("remove_instance", { id }),
  setFocused: (id: string) => invoke<LauncherState>("set_focused", { id }),
  probeEnv: (force = true) => invoke<EnvProbe>("probe_env", { force }),
  startInstance: (id: string) => invoke<LauncherState>("start_instance", { id }),
  stopInstance: (id: string) => invoke<LauncherState>("stop_instance", { id }),
  restartInstance: (id: string) => invoke<LauncherState>("restart_instance", { id }),
  openInstanceUrl: (id?: string, url?: string) =>
    invoke<void>("open_instance_url", { id: id ?? null, url: url ?? null }),
  listProfiles: (id?: string) => invoke<ProfileInfo[]>("list_profiles", { id: id ?? null }),
  createProfile: (name: string, id?: string) =>
    invoke<ProfileInfo[]>("create_profile", { name, id: id ?? null }),
  dumpConfig: (profile?: string, id?: string) =>
    invoke<string>("dump_config", { profile: profile ?? null, id: id ?? null }),
  runPlugin: (args: string[], id?: string) => invoke<string>("run_plugin", { args, id: id ?? null }),
  listInstalled: (id?: string) => invoke<InstalledPlugin[]>("list_installed", { id: id ?? null }),
  clearLogs: (id: string) => invoke<LauncherState>("clear_logs", { id }),
  pickFolder: () => invoke<string | null>("pick_folder"),
  fetchCurated: () => invoke<CatalogPayload<CuratedCatalog | null>>("fetch_curated"),
  fetchDiscovery: () => invoke<CatalogPayload<DiscoveryCatalog | null>>("fetch_discovery"),
  fetchReadme: (fullName: string, branch?: string) =>
    invoke<string>("fetch_readme", { fullName, branch: branch ?? null }),
  nextInstancePort: () => invoke<number>("next_instance_port"),
};

export function errMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
