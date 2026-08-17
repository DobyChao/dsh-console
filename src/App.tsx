import { useEffect, useMemo, useState } from "react";
import { AddInstanceDialog } from "./components/AddInstanceDialog";
import { IconRail } from "./components/IconRail";
import { InstanceList } from "./components/InstanceList";
import { PluginsPage } from "./pages/PluginsPage";
import { RunPage } from "./pages/RunPage";
import { SettingsPage } from "./pages/SettingsPage";
import { api, errMessage, listen, subscribeBackend, type BackendKind } from "./lib/api";
import { applyAppearance } from "./lib/appearance";
import type { InstancePatch, LauncherState, PageId, RuntimeInfo } from "./lib/types";
import ui from "./styles/ui.module.css";

const LOG_LIMIT = 1800;

export default function App() {
  const [page, setPage] = useState<PageId>("run");
  const [state, setState] = useState<LauncherState | null>(null);
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [env, setEnv] = useState<Awaited<ReturnType<typeof api.probeEnv>> | null>(null);
  const [backend, setBackend] = useState<BackendKind | "checking">("checking");
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ displayName: "", dshHome: "", port: 3081 });
  const [scrollToEnv, setScrollToEnv] = useState(false);

  async function refresh() {
    const s = await api.getState();
    setState(s);
    setLogs((prev) => {
      const next = { ...prev };
      for (const [id, lines] of Object.entries(s.logs)) next[id] = lines;
      return next;
    });
    applyAppearance(s.config.appearance);
    return s;
  }

  useEffect(() => subscribeBackend(setBackend), []);

  useEffect(() => {
    if (backend === "checking") return;
    void (async () => {
      try {
        await refresh();
        setEnv(await api.probeEnv());
      } catch (e) {
        setError(errMessage(e));
      }
    })();
  }, [backend]);

  useEffect(() => {
    if (backend === "checking") return;
    const unsubs: Array<() => void> = [];
    let cancelled = false;
    const track = (p: Promise<() => void>) => {
      void p.then((u) => {
        if (cancelled) u();
        else unsubs.push(u);
      });
    };
    track(
      listen<{ id: string; line: string }>("instance-log", (ev) => {
        const { id, line } = ev.payload;
        setLogs((prev) => {
          const cur = prev[id] ?? [];
          const next = cur.length >= LOG_LIMIT ? cur.slice(cur.length - LOG_LIMIT + 1) : cur.slice();
          next.push(line);
          return { ...prev, [id]: next };
        });
      }),
    );
    track(
      listen<Record<string, RuntimeInfo>>("runtimes-changed", (ev) => {
        setState((s) => (s ? { ...s, runtimes: ev.payload } : s));
      }),
    );
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [backend]);

  useEffect(() => {
    if (!state) return;
    applyAppearance(state.config.appearance);
    if (state.config.appearance !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyAppearance("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [state?.config.appearance]);

  const focused = useMemo(
    () => state?.config.instances.find((i) => i.id === state.config.focusedId) ?? state?.config.instances[0],
    [state],
  );
  const runtime = focused ? state?.runtimes[focused.id] : undefined;

  async function onFocus(id: string) {
    try {
      const s = await api.setFocused(id);
      setState(s);
      setEnv(await api.probeEnv());
    } catch (e) {
      setError(errMessage(e));
    }
  }

  async function openAdd() {
    const port = await api.nextInstancePort();
    setDraft({ displayName: "", dshHome: "", port });
    setAdding(true);
  }

  async function submitAdd() {
    const patch: InstancePatch = {
      displayName: draft.displayName.trim() || "新实例",
      dshHome: draft.dshHome.trim(),
      port: Number(draft.port) || 3081,
      profile: "web",
    };
    try {
      const s = await api.upsertInstance(patch);
      setState(s);
      setAdding(false);
    } catch (e) {
      setError(errMessage(e));
    }
  }

  if (!state) {
    return (
      <div className="grid h-full place-items-center text-label-2">
        {error || (backend === "checking" ? "正在连接后端…" : "加载中…")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {backend === "http" ? (
        <div className="shrink-0 border-b border-border bg-bubble px-3 py-1.5 text-center text-xs leading-[18px] text-ds">
          网页 · 已连接桌面后端 · 启停走真实 dsh
        </div>
      ) : null}
      {backend === "mock" ? (
        <div className="shrink-0 border-b border-border bg-bubble px-3 py-1.5 text-center text-xs leading-[18px] text-ds">
          网页预览 · 桌面进程未开 · 当前是假数据
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 bg-platform">
      <IconRail
        page={page}
        env={env}
        onNavigate={(p) => {
          setPage(p);
          if (p !== "settings") setScrollToEnv(false);
        }}
        onOpenEnv={() => {
          setPage("settings");
          setScrollToEnv(true);
        }}
      />
      {page === "run" ? (
        <InstanceList
          instances={state.config.instances}
          focusedId={focused?.id ?? ""}
          runtimes={state.runtimes}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed(true)}
          onFocus={(id) => void onFocus(id)}
          onAdd={() => void openAdd()}
          onRemove={(id) => {
            api
              .removeInstance(id)
              .then(setState)
              .catch((e) => setError(errMessage(e)));
          }}
        />
      ) : null}
      <main className="flex min-w-0 flex-1 flex-col bg-platform">
        {error ? (
          <div className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-lg bg-error p-2.5 text-white">
            <pre className="m-0 whitespace-pre-wrap text-xs">{error}</pre>
            <button type="button" className={ui.tiny} onClick={() => setError(null)}>
              关闭
            </button>
          </div>
        ) : null}
        {page === "run" ? (
          <RunPage
            focused={focused}
            runtime={runtime}
            logs={focused ? (logs[focused.id] ?? []) : []}
            listCollapsed={collapsed}
            onExpandList={() => setCollapsed(false)}
            onClearLogs={() => {
              if (!focused) return;
              setLogs((prev) => ({ ...prev, [focused.id]: [] }));
            }}
            onState={setState}
            onError={setError}
          />
        ) : null}
        {page === "plugins" ? (
          <PluginsPage state={state} focused={focused} runtime={runtime} onState={setState} onError={setError} />
        ) : null}
        {page === "settings" ? (
          <SettingsPage
            state={state}
            focused={focused}
            runtime={runtime}
            env={env}
            scrollToEnv={scrollToEnv}
            onState={setState}
            onEnv={setEnv}
            onError={setError}
          />
        ) : null}
      </main>
      {adding ? (
        <AddInstanceDialog
          draft={draft}
          onChange={setDraft}
          onClose={() => setAdding(false)}
          onSubmit={() => void submitAdd()}
        />
      ) : null}
      </div>
    </div>
  );
}
