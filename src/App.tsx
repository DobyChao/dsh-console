import { useState } from "react";
import { AddInstanceDialog } from "./components/AddInstanceDialog";
import { AlertIcon } from "./components/icons";
import { IconRail } from "./components/IconRail";
import { InstanceList } from "./components/InstanceList";
import { PluginsPage } from "./pages/PluginsPage";
import { RunPage } from "./pages/RunPage";
import { SettingsPage } from "./pages/SettingsPage";
import { t } from "./i18n";
import { useLauncher } from "./lib/launcher";
import type { PageId } from "./lib/types";
import ui from "./styles/ui.module.css";

export default function App() {
  const { state, env, backend, error, dismissError } = useLauncher();
  const [page, setPage] = useState<PageId>("run");
  const [collapsed, setCollapsed] = useState(false);
  const [instanceForm, setInstanceForm] = useState<{ id?: string } | null>(null);
  const [scrollToEnv, setScrollToEnv] = useState(false);

  if (!state) {
    return (
      <div className="grid h-full place-items-center text-label-2">
        {error || (backend === "checking" ? t("app.connecting") : t("app.loading"))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {backend === "http" ? (
        <div className="shrink-0 border-b border-border bg-bubble px-3 py-1.5 text-center text-xs leading-[18px] text-ds">
          {t("app.httpBanner")}
        </div>
      ) : null}
      {backend === "mock" ? (
        <div className="shrink-0 border-b border-border bg-bubble px-3 py-1.5 text-center text-xs leading-[18px] text-ds">
          {t("app.mockBanner")}
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
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed(true)}
            onAdd={() => setInstanceForm({})}
            onEdit={(id) => setInstanceForm({ id })}
          />
        ) : null}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-platform">
          {error ? (
            <div className={`${ui.errorBanner} mx-4 mt-3`}>
              <AlertIcon className={ui.bannerIcon} />
              <pre className="m-0 flex-1 whitespace-pre-wrap text-xs">{error}</pre>
              <button type="button" className={ui.tiny} onClick={dismissError}>
                {t("common.close")}
              </button>
            </div>
          ) : null}
          {/* 三页常驻，切页只切显示：避免每次进插件页都重新拉目录 */}
          <div className="flex min-h-0 flex-1 flex-col" style={{ display: page === "run" ? "flex" : "none" }}>
            <RunPage visible={page === "run"} listCollapsed={collapsed} onExpandList={() => setCollapsed(false)} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col" style={{ display: page === "plugins" ? "flex" : "none" }}>
            <PluginsPage visible={page === "plugins"} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col" style={{ display: page === "settings" ? "flex" : "none" }}>
            <SettingsPage scrollToEnv={scrollToEnv} />
          </div>
        </main>
        {instanceForm ? (
          <AddInstanceDialog instanceId={instanceForm.id} onClose={() => setInstanceForm(null)} />
        ) : null}
      </div>
    </div>
  );
}
