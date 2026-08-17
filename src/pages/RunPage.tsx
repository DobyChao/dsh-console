import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { useLauncher } from "../lib/launcher";
import { Button } from "../components/Button";
import { ExternalLinkIcon, FolderIcon } from "../components/icons";
import { StatusDot } from "../components/StatusDot";
import { statusLabel } from "../lib/status";
import styles from "./RunPage.module.css";

const STICK_THRESHOLD = 40;

export function RunPage({
  visible,
  listCollapsed,
  onExpandList,
}: {
  visible: boolean;
  listCollapsed: boolean;
  onExpandList: () => void;
}) {
  const { focused, runtime, logsOf, startInstance, stopInstance, openInstanceUrl, clearLogs, isBusy } = useLauncher();
  const logRef = useRef<HTMLPreElement>(null);
  const stickRef = useRef(true);
  const [detached, setDetached] = useState(false);
  const logs = useMemo(() => (focused ? logsOf(focused.id) : []), [focused, logsOf]);

  useEffect(() => {
    // 隐藏期间尺寸为 0，重新显示时也要贴底一次
    if (stickRef.current) logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs, visible]);

  if (!focused) {
    return (
      <div className={styles.empty}>
        <FolderIcon className={styles.emptyIcon} />
        <p className={styles.emptyText}>{t("run.emptyInstance")}</p>
      </div>
    );
  }

  const inst = focused;
  const status = runtime?.status ?? "idle";
  const transition = status === "starting" || status === "stopping";
  const running = transition || status === "ready";
  const canOpen = Boolean(runtime?.url) && inst.profile === "web";
  const actionBusy = isBusy(`start:${inst.id}`) || isBusy(`stop:${inst.id}`);
  const logText = logs.length ? logs.join("\n") : t("run.logEmpty");

  function onLogScroll() {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    stickRef.current = atBottom;
    setDetached(!atBottom);
  }

  function jumpToBottom() {
    const el = logRef.current;
    if (!el) return;
    stickRef.current = true;
    setDetached(false);
    el.scrollTo(0, el.scrollHeight);
  }

  return (
    <div className={styles.page}>
      {listCollapsed ? (
        <div className={styles.toolbar}>
          <button type="button" className={styles.textBtn} onClick={onExpandList}>
            {t("run.showInstances")}
          </button>
        </div>
      ) : null}

      <section className={styles.statusCard}>
        <header className={styles.cardHead}>
          <h1 className={styles.pageTitle}>{t("run.title")}</h1>
          <div className={styles.actions}>
            {running ? (
              <Button variant="primary" busy={actionBusy} disabled={transition} onClick={() => void stopInstance(inst.id)}>
                {t("run.stop")}
              </Button>
            ) : (
              <Button variant="primary" busy={actionBusy} disabled={transition} onClick={() => void startInstance(inst.id)}>
                {t("run.start")}
              </Button>
            )}
            <Button disabled={!canOpen} onClick={() => void openInstanceUrl(inst.id)}>
              {t("run.openWeb")}
            </Button>
          </div>
        </header>
        <dl className={styles.meta}>
          <div className={styles.metaRow}>
            <dt>{t("run.stateLabel")}</dt>
            <dd>
              <StatusDot status={status} />
              <span>{statusLabel(status)}</span>
            </dd>
          </div>
          <div className={styles.metaRow}>
            <dt>{t("run.addressLabel")}</dt>
            <dd>
              {runtime?.url ? (
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => void openInstanceUrl(inst.id)}
                  disabled={!canOpen}
                >
                  {runtime.url}
                  <ExternalLinkIcon className={styles.linkIcon} />
                </button>
              ) : (
                <span className={styles.placeholder}>—</span>
              )}
            </dd>
          </div>
        </dl>
        {runtime?.error ? <p className={styles.runtimeError}>{runtime.error}</p> : null}
      </section>

      <section className={styles.logCard}>
        <div className={styles.logHead}>
          <span className={styles.logTitle}>
            {t("run.logs")}
            {logs.length ? <span className={styles.logCount}>{t("run.logLines", { count: logs.length })}</span> : null}
          </span>
          <button
            type="button"
            className={styles.clear}
            onClick={() => void clearLogs(inst.id)}
            disabled={logs.length === 0}
          >
            {t("run.clear")}
          </button>
        </div>
        <div className={styles.logViewport}>
          <pre ref={logRef} className={styles.log} onScroll={onLogScroll}>
            {logText}
          </pre>
          {detached ? (
            <button type="button" className={styles.jump} onClick={jumpToBottom}>
              {t("run.jumpBottom")}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
