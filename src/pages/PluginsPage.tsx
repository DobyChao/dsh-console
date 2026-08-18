import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { t } from "../i18n";
import { api, errMessage } from "../lib/api";
import { useLauncher } from "../lib/launcher";
import {
  catalogCategories,
  filterPlugins,
  findInstalledName,
  mergeCatalogs,
  planFromKnownFields,
} from "../lib/catalog";
import { useWindowList } from "../lib/use-window-list";
import type { CuratedCatalog, InstalledPlugin, MergedPlugin } from "../lib/types";
import { Button } from "../components/Button";
import { InstanceCapsule } from "../components/InstanceCapsule";
import { TextInput } from "../components/TextInput";
import { AlertIcon, ExternalLinkIcon, PuzzleIcon, RefreshIcon } from "../components/icons";
import ui from "../styles/ui.module.css";
import styles from "./PluginsPage.module.css";

/** 必须�?.row 的实际高度一致，窗口化按它算区间 */
const ROW_HEIGHT = 56;

export function PluginsPage({ visible }: { visible: boolean }) {
  const { focused, runtime, run, refresh, restartInstance, openInstanceUrl, confirm, isBusy, reportError } =
    useLauncher();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
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
    // 数据获取�?effect：reloadInstalled 内的 setState 全部发生�?await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadInstalled();
  }, [reloadInstalled, focusedProfile]);

  const merged = useMemo(() => mergeCatalogs(curated, null), [curated]);
  const shown = useMemo(
    () => filterPlugins(merged, "curated", query, category),
    [merged, query, category],
  );
  const categories = useMemo(() => catalogCategories(merged, curated?.categories), [merged, curated]);
  const categoryLabels = useMemo(
    () => new Map(categories.map((c) => [c.key, c.label])),
    [categories],
  );
  const { attach, onScroll, scrollToTop, first, last, totalHeight, offsetTop } = useWindowList(
    shown.length,
    ROW_HEIGHT,
    { visible },
  );

  if (!focused) return null;
  const running = runtime?.status === "ready" || runtime?.status === "starting";
  const anyPluginBusy = isBusy("plugin:");
  const refreshingInstalled = isBusy(`installed:${focused.id}`);

  async function refreshInstalled() {
    if (!focused) return;
    await run(`installed:${focused.id}`, reloadInstalled);
  }

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
          <h1 className="m-0 text-[15px] font-semibold leading-[22px]">
            {t("plugins.title")}
            {shown.length > 0 ? (
              <span className="ml-2 text-xs font-normal text-label-3">
                {t("plugins.resultCount", { n: shown.length })}
              </span>
            ) : null}
          </h1>
          <p className="mt-0.5 mb-0 text-xs leading-[18px] text-label-3">{t("plugins.subtitle")}</p>
        </div>
        <InstanceCapsule />
        <TextInput
          className="ml-auto w-56"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            scrollToTop();
          }}
          placeholder={t("plugins.searchPlaceholder")}
        />
      </header>

      {runtime?.needsRestart && running ? (
        <div className={`${ui.banner} mx-6 mt-3`}>
          <span className="flex items-center gap-2">
            <AlertIcon className={ui.bannerIcon} />
            {t("plugins.needsRestart")}
          </span>
          <Button variant="primary" busy={isBusy(`restart:${focused.id}`)} onClick={() => void restartInstance(focused.id)}>
            {t("plugins.restart")}
          </Button>
        </div>
      ) : null}
      {stale ? <p className="mx-6 mt-2 mb-0 text-xs text-label-3">{t("plugins.staleCache")}</p> : null}

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-6 pt-4">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {categories.length > 0 ? (
            <div className={styles.chips} role="group" aria-label={t("plugins.title")}>
              <button
                type="button"
                className={clsx(styles.chip, !category && styles.chipOn)}
                aria-pressed={!category}
                onClick={() => {
                  setCategory(null);
                  scrollToTop();
                }}
              >
                {t("plugins.allCategories")}
                <span className={styles.chipCount}>{merged.length}</span>
              </button>
              {categories.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={clsx(styles.chip, category === c.key && styles.chipOn)}
                  aria-pressed={category === c.key}
                  onClick={(e) => {
                    setCategory(category === c.key ? null : c.key);
                    scrollToTop();
                    // 点到贴边只露一半的 chip 时把它整个滚出来（jsdom 下没有这个方法）
                    e.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" });
                  }}
                >
                  {c.label}
                  <span className={styles.chipCount}>{c.count}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className={styles.listCard}>
            {loading ? <p className={styles.listNote}>{t("plugins.loading")}</p> : null}
            {!loading && shown.length === 0 ? (
              <div className={styles.catalogEmpty}>
                <PuzzleIcon className={styles.catalogEmptyIcon} />
                <p className={styles.catalogEmptyText}>{t("plugins.empty")}</p>
              </div>
            ) : null}
            <div ref={attach} onScroll={onScroll} className={styles.scroller}>
              <div className={styles.spacer} style={{ height: totalHeight }}>
                <ul className={styles.rows} style={{ transform: `translateY(${offsetTop}px)` }}>
                  {shown.slice(first, last).map((p) => {
                    const installedAs = findInstalledName(p, installed);
                    const catKey = p.curatedEntry?.category;
                    const installing = isBusy(`plugin:add:${p.key}`);
                    const hashAt = p.name.indexOf("#");
                    const displayName = hashAt >= 0 ? p.name.slice(0, hashAt) : p.name;
                    const subpath = hashAt >= 0 ? p.name.slice(hashAt + 1) : null;
                    const repo = subpath ? `${p.fullName} · ${subpath}` : p.fullName;
                    return (
                      <li key={p.key} className={styles.row} style={{ height: ROW_HEIGHT }}>
                        <div className={styles.rowMain}>
                          <div className={styles.rowTop}>
                            <strong className={styles.rowName}>{displayName}</strong>
                            {catKey ? (
                              <span className={ui.badge}>{categoryLabels.get(catKey) ?? catKey}</span>
                            ) : null}
                            {installedAs ? (
                              <span
                                className={`${ui.badge} ${ui.badgeAccent}`}
                                title={t("plugins.installedBadge", { name: installedAs })}
                              >
                                {t("plugins.installedShort")}
                              </span>
                            ) : null}
                            <span className={styles.rowRepo} title={repo}>
                              {repo}
                            </span>
                          </div>
                          <p className={styles.rowDesc}>{p.description || t("plugins.noDesc")}</p>
                        </div>
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={styles.repoLink}
                            title={t("plugins.repo")}
                            aria-label={t("plugins.repo")}
                            onClick={() => void openInstanceUrl(undefined, p.url)}
                          >
                            <ExternalLinkIcon className={styles.repoIcon} />
                          </button>
                          <Button
                            size="tiny"
                            className={styles.installBtn}
                            busy={installing}
                            disabled={anyPluginBusy && !installing}
                            onClick={() => void installPlugin(p)}
                          >
                            {installing
                              ? t("plugins.installing")
                              : installedAs
                                ? t("plugins.reinstall")
                                : t("plugins.install")}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <aside className="flex w-[280px] shrink-0 flex-col gap-4 overflow-auto">
          <section className={ui.card}>
            <div className={styles.installedHead}>
              <h2 className={`${ui.h2} m-0`}>{t("plugins.installedTitle")}</h2>
              <button
                type="button"
                className={styles.refreshBtn}
                title={t("plugins.refreshInstalled")}
                aria-label={t("plugins.refreshInstalled")}
                disabled={refreshingInstalled}
                onClick={() => void refreshInstalled()}
              >
                <RefreshIcon className={clsx(styles.refreshIcon, refreshingInstalled && styles.spinning)} />
              </button>
            </div>
            {installed.length === 0 ? (
              <p className="m-0 text-xs leading-[18px] text-label-3">{t("plugins.installedEmpty")}</p>
            ) : null}
            {installed.map((p) => {
              // 内置由右侧标签负责，caption 不再重复写一�?
              const caption = p.version || p.from || "";
              return (
                <div
                  key={p.name}
                  className="flex items-center justify-between gap-2 border-b border-border-subtle py-2.5 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium" title={p.name}>
                      {p.name}
                    </div>
                    {caption ? (
                      <div className="truncate text-xs text-label-3" title={caption}>
                        {caption}
                      </div>
                    ) : null}
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
              );
            })}
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
