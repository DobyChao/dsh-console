import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { api, errMessage, listen, subscribeBackend, type BackendKind } from "./api";
import { applyAppearance } from "./appearance";
import type {
  Appearance,
  DshMode,
  EnvProbe,
  Instance,
  InstancePatch,
  LauncherState,
  RuntimeInfo,
} from "./types";

const LOG_LIMIT = 1800;

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface ActionCtx {
  reqId: number;
  startedAt: number;
}

interface LauncherContextValue {
  state: LauncherState | null;
  env: EnvProbe | null;
  backend: BackendKind | "checking";
  error: string | null;
  focused: Instance | undefined;
  runtime: RuntimeInfo | undefined;
  logsOf(id: string): string[];
  /** 前缀匹配：isBusy("start") 匹配所有 start:* */
  isBusy(prefix: string): boolean;
  confirm(req: ConfirmRequest): Promise<boolean>;
  dismissError(): void;
  /** 页面主动上报的非异常错误（如目录数据自带的 error 字段） */
  reportError(message: string): void;
  /** 统一的 invoke 包装：busy 按_key_记录、错误统一进 error；fn 拿到带序号的 ctx，用 apply 结果防竞态 */
  run<T>(key: string, fn: (ctx: ActionCtx) => Promise<T>): Promise<T | undefined>;
  refresh(): Promise<void>;
  setFocused(id: string): Promise<void>;
  saveSettings(patch: Partial<{ dshMode: DshMode; dshPath: string | null; checkoutPath: string | null; appearance: Appearance }>): Promise<void>;
  addInstance(patch: InstancePatch): Promise<boolean>;
  removeInstance(id: string): Promise<void>;
  startInstance(id: string): Promise<void>;
  stopInstance(id: string): Promise<void>;
  restartInstance(id: string): Promise<void>;
  openInstanceUrl(id?: string, url?: string): Promise<void>;
  clearLogs(id: string): Promise<void>;
  probeEnv(): Promise<void>;
}

const LauncherContext = createContext<LauncherContextValue | null>(null);

export function useLauncher(): LauncherContextValue {
  const ctx = useContext(LauncherContext);
  if (!ctx) throw new Error("useLauncher 必须在 LauncherProvider 内使用");
  return ctx;
}

export function LauncherProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LauncherState | null>(null);
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [env, setEnv] = useState<EnvProbe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<BackendKind | "checking">("checking");
  const [busy, setBusy] = useState<Record<string, true>>({});
  const [confirmState, setConfirmState] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);

  const reqCounter = useRef(0);
  const appliedReq = useRef(0);
  const runtimeEventAt = useRef<Record<string, number>>({});
  const cfgRef = useRef<LauncherState["config"] | undefined>(undefined);
  useEffect(() => {
    cfgRef.current = state?.config;
  }, [state?.config]);

  const applyResponse = useCallback((s: LauncherState, reqId: number, startedAt: number) => {
    // 过期的响应直接丢弃，避免慢请求覆盖新状态
    if (reqId < appliedReq.current) return;
    appliedReq.current = reqId;
    setState((prev) => {
      const runtimes = { ...s.runtimes };
      // 比Invoke请求更晚的 runtimes-changed 事件不回退
      const prevRuntimes = prev?.runtimes ?? {};
      for (const id of Object.keys(runtimes)) {
        if ((runtimeEventAt.current[id] ?? 0) > startedAt && prevRuntimes[id]) {
          runtimes[id] = prevRuntimes[id];
        }
      }
      return { config: s.config, runtimes, logs: s.logs };
    });
    setLogs((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (!(id in s.logs)) delete next[id];
      }
      for (const [id, lines] of Object.entries(s.logs)) {
        // 事件流可能已追加了更新的行；后端数组只有在更长时才采纳
        if (!next[id] || lines.length > next[id].length) next[id] = lines;
      }
      return next;
    });
  }, []);

  const run = useCallback(async <T,>(key: string, fn: (ctx: ActionCtx) => Promise<T>): Promise<T | undefined> => {
    const reqId = ++reqCounter.current;
    const startedAt = Date.now();
    setBusy((b) => ({ ...b, [key]: true }));
    setError(null);
    try {
      return await fn({ reqId, startedAt });
    } catch (e) {
      setError(errMessage(e));
      return undefined;
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[key];
        return next;
      });
    }
  }, []);

  const probeEnv = useCallback(async () => {
    await run("probe", async () => {
      setEnv(await api.probeEnv());
    });
  }, [run]);

  const refresh = useCallback(async () => {
    const reqId = ++reqCounter.current;
    const startedAt = Date.now();
    try {
      const s = await api.getState();
      applyResponse(s, reqId, startedAt);
      setEnv(await api.probeEnv());
    } catch (e) {
      setError(errMessage(e));
    }
  }, [applyResponse]);

  useEffect(() => subscribeBackend((k) => {
    setBackend(k);
    void refresh();
  }), [refresh]);

  useEffect(() => {
    const offLog = listen<{ id: string; line: string }>("instance-log", ({ id, line }) => {
      setLogs((prev) => {
        const cur = prev[id] ?? [];
        const next = cur.length >= LOG_LIMIT ? cur.slice(cur.length - LOG_LIMIT + 1) : cur.slice();
        next.push(line);
        return { ...prev, [id]: next };
      });
    });
    const offRuntimes = listen<Record<string, RuntimeInfo>>("runtimes-changed", (runtimes) => {
      const now = Date.now();
      for (const id of Object.keys(runtimes)) runtimeEventAt.current[id] = now;
      setState((s) => (s ? { ...s, runtimes: { ...s.runtimes, ...runtimes } } : s));
    });
    return () => {
      offLog();
      offRuntimes();
    };
  }, []);

  // 外观跟随配置；system 模式监听系统切换
  const appearance = state?.config.appearance;
  useEffect(() => {
    if (!appearance) return;
    applyAppearance(appearance);
    if (appearance !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [appearance]);

  const setFocused = useCallback(
    async (id: string) => {
      await run(`focus:${id}`, async (ctx) => {
        applyResponse(await api.setFocused(id), ctx.reqId, ctx.startedAt);
        setEnv(await api.probeEnv());
      });
    },
    [applyResponse, run],
  );

  // 设置保存串行执行，patch 在执行时与最新 config 合并，避免并发读-改-写互相覆盖
  const saveQueue = useRef(Promise.resolve());
  const saveSettings = useCallback(
    (patch: Parameters<LauncherContextValue["saveSettings"]>[0]) => {
      const task = saveQueue.current.then(async () => {
        const cfg = cfgRef.current;
        if (!cfg) return;
        await run("settings", async (ctx) => {
          applyResponse(
            await api.saveSettings({
              dshMode: patch.dshMode ?? cfg.dshMode,
              dshPath: patch.dshPath === undefined ? cfg.dshPath ?? null : patch.dshPath,
              checkoutPath: patch.checkoutPath === undefined ? cfg.checkoutPath ?? null : patch.checkoutPath,
              appearance: patch.appearance ?? cfg.appearance,
            }),
            ctx.reqId,
            ctx.startedAt,
          );
        });
        await probeEnv();
      });
      saveQueue.current = task.catch(() => {});
      return task;
    },
    [applyResponse, probeEnv, run],
  );

  const addInstance = useCallback(
    async (patch: InstancePatch) => {
      const ok = await run("add-instance", async (ctx) => {
        applyResponse(await api.upsertInstance(patch), ctx.reqId, ctx.startedAt);
        return true;
      });
      return ok === true;
    },
    [applyResponse, run],
  );

  const removeInstance = useCallback(
    async (id: string) => {
      await run(`remove:${id}`, async (ctx) => {
        applyResponse(await api.removeInstance(id), ctx.reqId, ctx.startedAt);
      });
      setLogs((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [applyResponse, run],
  );

  const startInstance = useCallback(
    async (id: string) => {
      await run(`start:${id}`, async (ctx) => {
        applyResponse(await api.startInstance(id), ctx.reqId, ctx.startedAt);
      });
    },
    [applyResponse, run],
  );

  const stopInstance = useCallback(
    async (id: string) => {
      await run(`stop:${id}`, async (ctx) => {
        applyResponse(await api.stopInstance(id), ctx.reqId, ctx.startedAt);
      });
    },
    [applyResponse, run],
  );

  const restartInstance = useCallback(
    async (id: string) => {
      await run(`restart:${id}`, async (ctx) => {
        applyResponse(await api.restartInstance(id), ctx.reqId, ctx.startedAt);
      });
    },
    [applyResponse, run],
  );

  const openInstanceUrl = useCallback(
    async (id?: string, url?: string) => {
      await run(`open:${id ?? "url"}`, () => api.openInstanceUrl(id, url));
    },
    [run],
  );

  const clearLogs = useCallback(
    async (id: string) => {
      await run(`clear:${id}`, async () => {
        await api.clearLogs(id);
        setLogs((prev) => ({ ...prev, [id]: [] }));
      });
    },
    [run],
  );

  const confirm = useCallback(
    (req: ConfirmRequest) => new Promise<boolean>((resolve) => setConfirmState({ ...req, resolve })),
    [],
  );

  const focused = useMemo(
    () =>
      state?.config.instances.find((i) => i.id === state.config.focusedId) ?? state?.config.instances[0],
    [state],
  );
  const runtime = focused ? state?.runtimes[focused.id] : undefined;

  const value = useMemo<LauncherContextValue>(
    () => ({
      state,
      env,
      backend,
      error,
      focused,
      runtime,
      logsOf: (id: string) => logs[id] ?? [],
      isBusy: (prefix: string) => Object.keys(busy).some((k) => k.startsWith(prefix)),
      confirm,
      dismissError: () => setError(null),
      reportError: (message: string) => setError(message),
      run,
      refresh,
      setFocused,
      saveSettings,
      addInstance,
      removeInstance,
      startInstance,
      stopInstance,
      restartInstance,
      openInstanceUrl,
      clearLogs,
      probeEnv,
    }),
    [
      state,
      env,
      backend,
      error,
      focused,
      runtime,
      logs,
      busy,
      confirm,
      run,
      refresh,
      setFocused,
      saveSettings,
      addInstance,
      removeInstance,
      startInstance,
      stopInstance,
      restartInstance,
      openInstanceUrl,
      clearLogs,
      probeEnv,
    ],
  );

  return (
    <LauncherContext.Provider value={value}>
      {children}
      {confirmState ? (
        <ConfirmDialog
          req={confirmState}
          onDone={(ok) => {
            confirmState.resolve(ok);
            setConfirmState(null);
          }}
        />
      ) : null}
    </LauncherContext.Provider>
  );
}
