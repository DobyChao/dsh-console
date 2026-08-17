import clsx from "clsx";
import type { ProcStatus } from "../lib/types";
import styles from "./StatusDot.module.css";

const LABELS: Record<ProcStatus, string> = {
  idle: "空闲",
  starting: "启动中",
  ready: "就绪",
  stopping: "停止中",
  error: "错误",
};

export function StatusDot({ status, title }: { status: ProcStatus; title?: string }) {
  return (
    <span
      className={clsx(styles.dot, styles[status])}
      title={title ?? LABELS[status]}
      aria-label={LABELS[status]}
    />
  );
}

export function statusLabel(status: ProcStatus): string {
  return LABELS[status];
}
