import { t } from "../i18n";
import type {
  CatalogPayload,
  CuratedCatalog,
  DiscoveryCatalog,
  EnvProbe,
  Instance,
  InstancePatch,
  InstalledPlugin,
  LauncherState,
  ProfileInfo,
  RuntimeInfo,
  SettingsPatch,
} from "./types";

type Handler = (ev: { payload: unknown }) => void;

const listeners = new Map<string, Set<Handler>>();

export function browserListen(event: string, handler: Handler): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler);
  return () => set.delete(handler);
}

function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((handler) => handler({ payload }));
}

const defaultInst: Instance = {
  id: "default",
  displayName: "默认",
  dshHome: "C:\\Users\\Admin\\.dsh",
  port: 3080,
  profile: "web",
};

const labInst: Instance = {
  id: "lab",
  displayName: "实验室",
  dshHome: "D:\\dsh-lab",
  port: 3081,
  profile: "web",
};

const readyLogs = [
  "2025-05-26 14:22:18.123 [dsh] info: dsh v0.9.0",
  "2025-05-26 14:22:18.124 [dsh] info: working directory: C:\\Users\\Admin\\.dsh",
  "2025-05-26 14:22:18.125 [dsh] info: config loaded",
  "2025-05-26 14:22:18.126 [dsh] info: http server listening on http://127.0.0.1:3080",
  "2025-05-26 14:22:18.127 [dsh] info: ready",
];

function runtime(id: string, status: RuntimeInfo["status"], url?: string): RuntimeInfo {
  return { id, status, url: url ?? null, error: null, pid: status === "ready" ? 4242 : null, needsRestart: false };
}

const state: LauncherState = {
  config: {
    instances: [defaultInst, labInst],
    focusedId: "default",
    dshMode: "path",
    appearance: "light",
  },
  runtimes: {
    default: runtime("default", "ready", "http://127.0.0.1:3080"),
    lab: runtime("lab", "idle"),
  },
  logs: {
    default: [...readyLogs],
    lab: [],
  },
};

const profiles: ProfileInfo[] = [
  { name: "web", path: "C:\\Users\\Admin\\.dsh\\profiles\\web", kind: "web" },
  { name: "headless", path: "C:\\Users\\Admin\\.dsh\\profiles\\headless", kind: "headless" },
];

const installed: InstalledPlugin[] = [
  { name: "@dsh/example-tools", from: "npm", version: "0.1.0", builtin: false },
];

function snapshot(): LauncherState {
  return structuredClone(state);
}

function focused(): Instance {
  return state.config.instances.find((i) => i.id === state.config.focusedId) ?? state.config.instances[0];
}

function probe(): EnvProbe {
  return {
    ok: true,
    firstFailure: null,
    items: [
      { id: "node", name: "Node", ok: true, detail: "v22.14.0", hint: "安装 Node 22+" },
      { id: "dsh", name: "dsh", ok: true, detail: "dsh 0.9.0", hint: "在设置里指定二进制或 checkout" },
      { id: "pnpm", name: "pnpm", ok: true, detail: "10.8.0", hint: "安装 pnpm 以管理 profile 插件" },
      { id: "home", name: "DSH_HOME", ok: true, detail: focused()?.dshHome ?? "—", hint: "父目录需要可写" },
    ],
    gitOk: true,
    gitHint: null,
  };
}

const curated: CuratedCatalog = {
  plugins: [
    {
      name: "example-tools",
      owner: "dsh-market",
      url: "https://github.com/dsh-market/example-tools",
      category: "tools",
      description: { zh: "示例工具包（预览数据）", en: "Example tools" },
      npm: "@dsh/example-tools",
      stars: 12,
    },
  ],
  categories: { tools: { zh: "工具", en: "Tools" } },
};

const discovery: DiscoveryCatalog = {
  schemaVersion: 1,
  repositories: [
    {
      fullName: "dsh-market/example-tools",
      name: "example-tools",
      description: "示例工具包（预览数据）",
      htmlUrl: "https://github.com/dsh-market/example-tools",
      defaultBranch: "main",
      stargazersCount: 12,
      topics: ["dsh-plugin"],
      validation: { overall: "verified", sourceSha: "a".repeat(40) },
      install: {
        status: "ok",
        candidate: { source: "npm", target: "@dsh/example-tools", executable: true },
      },
    },
  ],
};

function setRuntime(id: string, next: RuntimeInfo) {
  state.runtimes[id] = next;
  emit("runtimes-changed", structuredClone(state.runtimes));
}

function appendLog(id: string, line: string) {
  const cur = state.logs[id] ?? [];
  state.logs[id] = [...cur, line];
  emit("instance-log", { id, line });
}

export function browserInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  switch (cmd) {
    case "get_state":
      return Promise.resolve(snapshot() as T);
    case "save_settings": {
      const patch = args.patch as SettingsPatch;
      state.config.dshMode = patch.dshMode;
      state.config.dshPath = patch.dshPath ?? undefined;
      state.config.checkoutPath = patch.checkoutPath ?? undefined;
      state.config.appearance = patch.appearance;
      return Promise.resolve(snapshot() as T);
    }
    case "upsert_instance": {
      const patch = args.patch as InstancePatch;
      if (patch.id) {
        state.config.instances = state.config.instances.map((inst) =>
          inst.id === patch.id
            ? {
                ...inst,
                displayName: patch.displayName,
                dshHome: patch.dshHome,
                port: patch.port,
                profile: patch.profile ?? inst.profile,
                cwd: patch.cwd ?? inst.cwd,
              }
            : inst,
        );
        state.config.focusedId = patch.id;
      } else {
        const id = `inst-${Date.now()}`;
        const inst: Instance = {
          id,
          displayName: patch.displayName,
          dshHome: patch.dshHome,
          port: patch.port,
          profile: patch.profile ?? "web",
          cwd: patch.cwd ?? undefined,
        };
        state.config.instances.push(inst);
        state.config.focusedId = id;
        state.runtimes[id] = runtime(id, "idle");
        state.logs[id] = [];
      }
      return Promise.resolve(snapshot() as T);
    }
    case "remove_instance": {
      const id = String(args.id);
      state.config.instances = state.config.instances.filter((inst) => inst.id !== id);
      delete state.runtimes[id];
      delete state.logs[id];
      if (state.config.focusedId === id) {
        state.config.focusedId = state.config.instances[0]?.id ?? "";
      }
      return Promise.resolve(snapshot() as T);
    }
    case "set_focused": {
      state.config.focusedId = String(args.id);
      return Promise.resolve(snapshot() as T);
    }
    case "probe_env":
      return Promise.resolve(probe() as T);
    case "start_instance": {
      const id = String(args.id);
      const inst = state.config.instances.find((item) => item.id === id);
      if (!inst) return Promise.reject(t("error.instanceNotFound"));
      setRuntime(id, runtime(id, "starting"));
      window.setTimeout(() => {
        const url = `http://127.0.0.1:${inst.port}`;
        for (const line of [
          `[dsh] info: starting profile ${inst.profile}`,
          `[dsh] info: http server listening on ${url}`,
          `[dsh] info: ready`,
        ]) {
          appendLog(id, line);
        }
        setRuntime(id, runtime(id, "ready", url));
      }, 280);
      return Promise.resolve(snapshot() as T);
    }
    case "stop_instance": {
      const id = String(args.id);
      setRuntime(id, runtime(id, "idle"));
      appendLog(id, "[dsh] info: stopped");
      return Promise.resolve(snapshot() as T);
    }
    case "restart_instance": {
      const id = String(args.id);
      setRuntime(id, runtime(id, "starting"));
      window.setTimeout(() => {
        const inst = state.config.instances.find((item) => item.id === id);
        const url = `http://127.0.0.1:${inst?.port ?? 3080}`;
        appendLog(id, "[dsh] info: ready");
        setRuntime(id, runtime(id, "ready", url));
      }, 280);
      return Promise.resolve(snapshot() as T);
    }
    case "open_instance_url": {
      const id = args.id ? String(args.id) : state.config.focusedId;
      const url = (args.url as string | null) || state.runtimes[id]?.url;
      if (url) window.open(url, "_blank", "noopener");
      return Promise.resolve(undefined as T);
    }
    case "list_profiles":
      return Promise.resolve(structuredClone(profiles) as T);
    case "create_profile": {
      const name = String(args.name).trim();
      if (name && !profiles.some((p) => p.name === name)) {
        profiles.push({
          name,
          path: `${focused()?.dshHome ?? ""}\\profiles\\${name}`,
          kind: name === "web" || name === "headless" ? name : "base",
          note: name === "web" || name === "headless" ? null : "只有 base 层",
        });
      }
      return Promise.resolve(structuredClone(profiles) as T);
    }
    case "dump_config":
      return Promise.resolve(
        [
          "profile: web",
          "port: 3080",
          "home: C:\\\\Users\\\\Admin\\\\.dsh",
          "layers:",
          "  - base",
          "  - web",
        ].join("\n") as T,
      );
    case "run_plugin":
      return Promise.resolve(t("error.mockRunPlugin", { args: (args.args as string[])?.join(" ") ?? "" }) as T);
    case "list_installed":
      return Promise.resolve(structuredClone(installed) as T);
    case "clear_logs": {
      const id = String(args.id);
      state.logs[id] = [];
      return Promise.resolve(snapshot() as T);
    }
    case "pick_folder":
      return Promise.resolve("C:\\Users\\Admin\\dsh-preview" as T);
    case "fetch_curated":
      return Promise.resolve({ data: curated, stale: false, fetchedAt: Date.now(), error: null } as CatalogPayload<CuratedCatalog> as T);
    case "fetch_discovery":
      return Promise.resolve({
        data: discovery,
        stale: false,
        fetchedAt: Date.now(),
        error: null,
      } as CatalogPayload<DiscoveryCatalog> as T);
    case "fetch_readme":
      return Promise.resolve("# example\n\n```\ndsh plugin add @dsh/example-tools\n```\n" as T);
    case "next_instance_port": {
      const used = state.config.instances.map((i) => i.port);
      let port = 3081;
      while (used.includes(port)) port += 1;
      return Promise.resolve(port as T);
    }
    default:
      return Promise.reject(t("error.mockUnknownCmd", { cmd }) as T);
  }
}
