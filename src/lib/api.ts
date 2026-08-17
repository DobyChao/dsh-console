import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
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
const listeners = new Set<(kind: BackendKind) => void>();

let kind: BackendKind = isTauri() ? "tauri" : "mock";
let everHttp = false;
let probeTask: Promise<BackendKind> | null = null;

function setKind(next: BackendKind) {
  if (next === "http") everHttp = true;
  if (kind === next) return;
  kind = next;
  listeners.forEach((fn) => fn(kind));
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
  listeners.add(fn);
  if (isTauri()) {
    fn("tauri");
  } else {
    void ensureBackend().then(fn);
  }
  return () => {
    listeners.delete(fn);
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

export const backendReady = ensureBackend();

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const resolved = await ensureBackend();
  if (resolved === "tauri") return tauriInvoke<T>(cmd, args);
  if (resolved === "http" || everHttp) {
    try {
      return await httpInvoke<T>(cmd, args);
    } catch (e) {
      if (await probeHttp()) return httpInvoke<T>(cmd, args);
      if (everHttp) throw "网页桥暂不可用，请确认桌面控制台仍在运行。";
      setKind("mock");
      throw e instanceof Error || typeof e === "string" ? e : "网页桥调用失败";
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
  if (!json.ok) throw json.error || "网页桥调用失败";
  return json.data as T;
}

export function listen<T>(event: string, handler: (ev: { payload: T }) => void): Promise<() => void> {
  return ensureBackend().then((resolved) => {
    if (resolved === "tauri") return tauriListen<T>(event, handler);
    if (resolved === "http" || everHttp) return httpListen(event, handler);
    return browserListen(event, handler as (ev: { payload: unknown }) => void);
  });
}

function httpListen<T>(event: string, handler: (ev: { payload: T }) => void): () => void {
  const source = new EventSource(`${BRIDGE}/events`);
  const onMessage = (ev: MessageEvent) => {
    try {
      handler({ payload: JSON.parse(ev.data) as T });
    } catch {
      /* ignore malformed frames */
    }
  };
  source.addEventListener(event, onMessage);
  return () => {
    source.removeEventListener(event, onMessage);
    source.close();
  };
}

export const api = {
  getState: () => invoke<LauncherState>("get_state"),
  saveSettings: (patch: SettingsPatch) => invoke<LauncherState>("save_settings", { patch }),
  upsertInstance: (patch: InstancePatch) => invoke<LauncherState>("upsert_instance", { patch }),
  removeInstance: (id: string) => invoke<LauncherState>("remove_instance", { id }),
  setFocused: (id: string) => invoke<LauncherState>("set_focused", { id }),
  probeEnv: () => invoke<EnvProbe>("probe_env"),
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
