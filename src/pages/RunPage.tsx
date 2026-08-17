import { useEffect, useRef } from "react";
import { ExternalLinkIcon } from "../components/icons";
import { StatusDot, statusLabel } from "../components/StatusDot";
import { api, errMessage } from "../lib/api";
import type { Instance, LauncherState, RuntimeInfo } from "../lib/types";
import ui from "../styles/ui.module.css";
import styles from "./RunPage.module.css";

export function RunPage({
  focused,
  runtime,
  logs,
  listCollapsed,
  onExpandList,
  onClearLogs,
  onState,
  onError,
}: {
  focused?: Instance;
  runtime?: RuntimeInfo;
  logs: string[];
  listCollapsed: boolean;
  onExpandList: () => void;
  onClearLogs: () => void;
  onState: (s: LauncherState) => void;
  onError: (msg: string | null) => void;
}) {
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs]);

  if (!focused) {
    return <div className={styles.empty}>请先添加一个实例。</div>;
  }

  const inst = focused;
  const status = runtime?.status ?? "idle";
  const running = status === "starting" || status === "ready" || status === "stopping";
  const canOpen = Boolean(runtime?.url) && inst.profile === "web";

  async function act(fn: () => Promise<LauncherState>) {
    onError(null);
    try {
      onState(await fn());
    } catch (e) {
      onError(errMessage(e));
    }
  }

  async function openUrl() {
    try {
      await api.openInstanceUrl(inst.id);
    } catch (e) {
      onError(errMessage(e));
    }
  }

  return (
    <div className={styles.page}>
      {listCollapsed ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.textBtn} onClick={onExpandList}>
            显示实例
          </button>
        </div>
      ) : null}

      <section className={styles.statusCard}>
        <header className={styles.cardHead}>
          <h1 className={styles.pageTitle}>运行</h1>
          <div className={styles.actions}>
            {running ? (
              <button type="button" className={ui.primary} onClick={() => act(() => api.stopInstance(inst.id))}>
                停止
              </button>
            ) : (
              <button type="button" className={ui.primary} onClick={() => act(() => api.startInstance(inst.id))}>
                启动
              </button>
            )}
            <button type="button" className={ui.ghost} disabled={!canOpen} onClick={() => void openUrl()}>
              打开 Web UI
            </button>
          </div>
        </header>
        <dl className={styles.meta}>
          <div className={styles.metaRow}>
            <dt>状态</dt>
            <dd>
              <StatusDot status={status} />
              <span>{statusLabel(status)}</span>
            </dd>
          </div>
          <div className={styles.metaRow}>
            <dt>地址</dt>
            <dd>
              {runtime?.url ? (
                <button type="button" className={styles.link} onClick={() => void openUrl()} disabled={!canOpen}>
                  {runtime.url}
                  <ExternalLinkIcon className={styles.linkIcon} />
                </button>
              ) : (
                <span className={styles.placeholder}>—</span>
              )}
            </dd>
          </div>
        </dl>
        {runtime?.error ? <p className={ui.error}>{runtime.error}</p> : null}
      </section>

      <section className={styles.logCard}>
        <div className={styles.logHead}>
          <span className={styles.logTitle}>日志</span>
          <button type="button" className={styles.clear} onClick={onClearLogs} disabled={logs.length === 0}>
            清空
          </button>
        </div>
        <pre ref={logRef} className={styles.log}>
          {logs.length ? logs.join("\n") : "启动后会显示进程输出。"}
        </pre>
      </section>
    </div>
  );
}
