import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import { api, errMessage } from "../lib/api";
import { useLauncher } from "../lib/launcher";
import { filterPlugins, findInstalledName, mergeCatalogs, planFromKnownFields } from "../lib/catalog";
import type { CuratedCatalog, InstalledPlugin, MergedPlugin } from "../lib/types";
import { Button } from "../components/Button";
import { InstanceCapsule } from "../components/InstanceCapsule";
import { TextInput } from "../components/TextInput";
import { PuzzleIcon } from "../components/icons";
import ui from "../styles/ui.module.css";
import styles from "./PluginsPage.module.css";

export function PluginsPage() {
  const { focused, runtime, run, refresh, restartInstance, openInstanceUrl, confirm, isBusy, reportError } =
    useLauncher();
  const [query, setQuery] = useState("");
  const [curated, setCurated] = useState<CuratedCatalog | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [devSpec, setDevSpec] = useState("");
  const [output, setOutput] = useState("");

  const focusedId = focused?.id;
  const focusedProfile = focused?.profile;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const c = await api.fetchCurated();
        if (cancelled) return;
        setCurated(c.data && typeof c.data === "object" ? c.data : null);
        setStale(Boolean(c.stale));
        if (c.error) reportError(c.error);
      } catch (e) {
        if (!cancelled) reportError(errMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportError]);

  const reloadInstalled = useCallback(async () => {
    if (!focusedId) return;
    try {
      const list = await api.listInstalled(focusedId);
      setInstalled(list);
    } catch (e) {
      reportError(errMessage(e));
    }
  }, [focusedId, reportError]);

  useEffect(() => {
    // 数据获取型 effect：reloadInstalled 内的 setState 全部发生在 await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadInstalled();
  }, [reloadInstalled, focusedProfile]);

  const merged = useMemo(() => mergeCatalogs(curated, null), [curated]);
  const shown = useMemo(() => filterPlugins(merged, "curated", query), [merged, query]);

  if (!focused) return null;
  const running = runtime?.status === "ready" || runtime?.status === "starting";
  const anyPluginBusy = isBusy("plugin:");

  async function runPluginArgs(args: string[], key: string) {
    if (!focused) return;
    const text = await run(key, () => api.runPlugin(args, focused.id));
    if (text !== undefined) {
      setOutput(text);
      await refresh();
      void reloadInstalled();
    }
  }

  async function installPlugin(plugin: MergedPlugin) {
    const plan = planFromKnownFields(plugin);
    if (!plan || plan.kind !== "ready" || !plan.args) {
      reportError(plan?.reason ?? t("plugins.noInstallTarget"));
      return;
    }
    await runPluginArgs(plan.args, `plugin:add:${plugin.key}`);
  }

  async function removePlugin(name: string) {
    const ok = await confirm({
      title: t("plugins.removeTitle"),
      body: t("plugins.removeConfirm", { name }),
      confirmLabel: t("plugins.remove"),
      danger: true,
    });
    if (ok) await runPluginArgs(["remove", name], `plugin:remove:${name}`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-6 pt-6 pb-2">
        <div className="min-w-0">
          <h1 className="m-0 text-[15px] font-semibold leading-[22px]">{t("plugins.title")}</h1>
          <p className="mt-0.5 mb-0 text-xs leading-[18px] text-label-3">{t("plugins.subtitle")}</p>
        </div>
        <InstanceCapsule />
        <TextInput
          className="ml-auto w-56"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("plugins.searchPlaceholder")}
        />
      </header>

      {runtime?.needsRestart && running ? (
        <div className={`${ui.banner} mx-6 mt-3`}>
          <span>{t("plugins.needsRestart")}</span>
          <Button variant="primary" busy={isBusy(`restart:${focused.id}`)} onClick={() => void restartInstance(focused.id)}>
            {t("plugins.restart")}
          </Button>
        </div>
      ) : null}
      {stale ? <p className="mx-6 mt-2 mb-0 text-xs text-label-3">{t("plugins.staleCache")}</p> : null}

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-6 pt-4">
        <section className="min-w-0 flex-1 overflow-auto">
          {loading ? <p className="m-0 text-sm text-label-3">{t("plugins.loading")}</p> : null}
          {!loading && shown.length === 0 ? (
            <div className={styles.catalogEmpty}>
              <PuzzleIcon className={styles.catalogEmptyIcon} />
              <p className={styles.catalogEmptyText}>{t("plugins.empty")}</p>
            </div>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {shown.map((p) => {
              const installedAs = findInstalledName(p, installed);
              const category = p.curatedEntry?.category;
              const installing = isBusy(`plugin:add:${p.key}`);
              return (
                <li key={p.key} className={`${ui.card} flex items-start justify-between gap-4 p-5`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <strong className="text-sm font-semibold">{p.name}</strong>
                      {category ? <span className={ui.badge}>{category}</span> : null}
                      {installedAs ? (
                        <span className={`${ui.badge} ${ui.badgeAccent}`}>
                          {t("plugins.installedBadge", { name: installedAs })}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 mb-0 text-[13px] leading-5 text-label-2">{p.description || t("plugins.noDesc")}</p>
                    <p className="mt-1 mb-0 truncate text-xs text-label-3" title={p.fullName}>
                      {p.fullName}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button onClick={() => void openInstanceUrl(undefined, p.url)}>{t("plugins.repo")}</Button>
                    <Button
                      variant="primary"
                      busy={installing}
                      disabled={anyPluginBusy && !installing}
                      onClick={() => void installPlugin(p)}
                    >
                      {installing ? t("plugins.installing") : installedAs ? t("plugins.reinstall") : t("plugins.install")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="flex w-[280px] shrink-0 flex-col gap-4 overflow-auto">
          <section className={ui.card}>
            <h2 className={ui.h2}>{t("plugins.installedTitle")}</h2>
            {installed.length === 0 ? (
              <p className="m-0 text-xs leading-[18px] text-label-3">{t("plugins.installedEmpty")}</p>
            ) : null}
            {installed.map((p) => (
              <div
                key={p.name}
                className="flex items-start justify-between gap-2 border-b border-border-subtle py-2.5 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-label-3">{p.version || p.from || (p.builtin ? t("plugins.builtin") : "")}</div>
                </div>
                {p.builtin ? (
                  <span className="shrink-0 text-[11px] text-label-3">{t("plugins.builtin")}</span>
                ) : (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="tiny"
                      disabled={anyPluginBusy}
                      onClick={() => void runPluginArgs(["update", p.name], `plugin:update:${p.name}`)}
                    >
                      {t("plugins.update")}
                    </Button>
                    <Button size="tiny" variant="danger" disabled={anyPluginBusy} onClick={() => void removePlugin(p.name)}>
                      {t("plugins.remove")}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </section>

          <section className={ui.card}>
            <h2 className={ui.h2}>{t("plugins.devTitle")}</h2>
            <p className="mt-0 mb-3 text-xs leading-[18px] text-label-3">{t("plugins.devDesc")}</p>
            <TextInput
              className="mb-2 font-mono text-xs"
              value={devSpec}
              onChange={(e) => setDevSpec(e.target.value)}
              placeholder={t("plugins.devPlaceholder")}
            />
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  api.pickFolder().then((folder) => {
                    if (folder) setDevSpec(folder);
                  })
                }
              >
                {t("plugins.pickFolder")}
              </Button>
              <Button
                variant="primary"
                disabled={!devSpec.trim() || anyPluginBusy}
                onClick={() => void runPluginArgs(["add", devSpec.trim()], "plugin:add:dev")}
              >
                {t("plugins.devInstall")}
              </Button>
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
