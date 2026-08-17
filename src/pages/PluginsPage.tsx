import { useEffect, useMemo, useState } from "react";
import { InstanceCapsule } from "../components/InstanceCapsule";
import { api, errMessage } from "../lib/api";
import { filterPlugins, findInstalledName, mergeCatalogs, planFromKnownFields } from "../lib/catalog";
import type { CuratedCatalog, InstalledPlugin, Instance, LauncherState, MergedPlugin, RuntimeInfo } from "../lib/types";
import ui from "../styles/ui.module.css";

export function PluginsPage({
  state,
  focused,
  runtime,
  onState,
  onError,
}: {
  state: LauncherState;
  focused?: Instance;
  runtime?: RuntimeInfo;
  onState: (s: LauncherState) => void;
  onError: (msg: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [curated, setCurated] = useState<CuratedCatalog | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [devSpec, setDevSpec] = useState("");
  const [output, setOutput] = useState("");

  const merged = useMemo(() => mergeCatalogs(curated, null), [curated]);
  const shown = useMemo(() => filterPlugins(merged, "curated", query), [merged, query]);

  async function reloadInstalled() {
    if (!focused) return;
    try {
      setInstalled(await api.listInstalled(focused.id));
    } catch (e) {
      onError(errMessage(e));
    }
  }

  useEffect(() => {
    let cancelled = false;
    onError(null);
    setLoading(true);
    void api
      .fetchCurated()
      .then((c) => {
        if (cancelled) return;
        setCurated(c.data && typeof c.data === "object" ? c.data : null);
        setStale(Boolean(c.stale));
        if (c.error) onError(c.error);
      })
      .catch((e) => {
        if (!cancelled) onError(errMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void reloadInstalled();
  }, [focused?.id, focused?.profile]);

  async function runArgs(args: string[], label: string) {
    if (!focused) return;
    setBusy(label);
    onError(null);
    try {
      const text = await api.runPlugin(args, focused.id);
      setOutput(text);
      onState(await api.getState());
      await reloadInstalled();
    } catch (e) {
      onError(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function installPlugin(plugin: MergedPlugin) {
    const plan = planFromKnownFields(plugin);
    if (!plan || plan.kind !== "ready" || !plan.args) {
      onError(plan?.reason ?? "精选条目没有可用的安装目标。");
      return;
    }
    await runArgs(plan.args, plugin.key);
  }

  if (!focused) return null;
  const running = runtime?.status === "ready" || runtime?.status === "starting";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-6 pt-6 pb-2">
        <div className="min-w-0">
          <h1 className="m-0 text-[15px] font-semibold leading-[22px]">插件</h1>
          <p className="mt-0.5 mb-0 text-xs leading-[18px] text-label-3">精选目录 · awesome-dsh-plugin.com</p>
        </div>
        <InstanceCapsule
          instances={state.config.instances}
          focused={focused}
          runtime={runtime}
          onFocus={(id) => api.setFocused(id).then(onState).catch((e) => onError(errMessage(e)))}
        />
        <input
          className="ml-auto w-56 rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus:border-ds"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索名称或描述"
        />
      </header>

      {runtime?.needsRestart && running ? (
        <div className={`${ui.banner} mx-6 mt-3`}>
          <span>插件层已变化，需要重启当前实例。</span>
          <button type="button" className={ui.primary} onClick={() => api.restartInstance(focused.id).then(onState)}>
            重启
          </button>
        </div>
      ) : null}
      {stale ? <p className="mx-6 mt-2 mb-0 text-xs text-label-3">目录缓存已过期，正在显示上次成功的数据。</p> : null}

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-6 pt-4">
        <section className="min-w-0 flex-1 overflow-auto">
          {loading ? <p className="m-0 text-sm text-label-3">正在拉取精选目录…</p> : null}
          {!loading && shown.length === 0 ? <p className="m-0 text-sm text-label-3">没有匹配的精选插件。</p> : null}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {shown.map((p) => {
              const installedAs = findInstalledName(p, installed);
              const category = p.curatedEntry?.category;
              return (
                <li key={p.key} className={`${ui.card} flex items-start justify-between gap-4 p-5`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <strong className="text-sm font-semibold">{p.name}</strong>
                      {category ? <span className={ui.badge}>{category}</span> : null}
                      {installedAs ? <span className={`${ui.badge} ${ui.badgeAccent}`}>已装 · {installedAs}</span> : null}
                    </div>
                    <p className="mt-1 mb-0 text-[13px] leading-5 text-label-2">{p.description || "（无描述）"}</p>
                    <p className="mt-1 mb-0 truncate text-xs text-label-3">{p.fullName}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className={ui.ghost}
                      onClick={() => api.openInstanceUrl(undefined, p.url).catch((e) => onError(errMessage(e)))}
                    >
                      仓库
                    </button>
                    <button
                      type="button"
                      className={ui.primary}
                      disabled={Boolean(busy)}
                      onClick={() => void installPlugin(p)}
                    >
                      {busy === p.key ? "安装中…" : installedAs ? "重新安装" : "安装"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="flex w-[280px] shrink-0 flex-col gap-4 overflow-auto">
          <section className={ui.card}>
            <h2 className={ui.h2}>已装</h2>
            {installed.length === 0 ? <p className="m-0 text-xs leading-[18px] text-label-3">当前实例还没有插件层。</p> : null}
            {installed.map((p) => (
              <div key={p.name} className="flex items-start justify-between gap-2 border-b border-border-subtle py-2.5 last:border-b-0 last:pb-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-label-3">{p.version || p.from || (p.builtin ? "内置" : "")}</div>
                </div>
                {p.builtin ? (
                  <span className="shrink-0 text-[11px] text-label-3">内置</span>
                ) : (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className={`${ui.tiny} ${ui.ghost}`}
                      disabled={Boolean(busy)}
                      onClick={() => void runArgs(["update", p.name], p.name)}
                    >
                      更新
                    </button>
                    <button
                      type="button"
                      className={`${ui.tiny} ${ui.danger}`}
                      disabled={Boolean(busy)}
                      onClick={() => void runArgs(["remove", p.name], p.name)}
                    >
                      卸载
                    </button>
                  </div>
                )}
              </div>
            ))}
          </section>

          <section className={ui.card}>
            <h2 className={ui.h2}>开发安装</h2>
            <p className="mt-0 mb-3 text-xs leading-[18px] text-label-3">本地路径或手输 spec，不走精选目录。</p>
            <input
              className={`${ui.input} mb-2 font-mono text-xs`}
              value={devSpec}
              onChange={(e) => setDevSpec(e.target.value)}
              placeholder="github:owner/repo"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className={ui.ghost}
                onClick={() =>
                  api.pickFolder().then((folder) => {
                    if (folder) setDevSpec(folder);
                  })
                }
              >
                选文件夹
              </button>
              <button
                type="button"
                className={ui.primary}
                disabled={!devSpec.trim() || Boolean(busy)}
                onClick={() => void runArgs(["add", devSpec.trim()], "dev")}
              >
                安装
              </button>
            </div>
            {output ? (
              <pre className="mt-3 mb-0 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-[18px] text-label-2">
                {output}
              </pre>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
