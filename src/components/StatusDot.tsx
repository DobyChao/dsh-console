import clsx from "clsx";
import { statusLabel } from "../lib/status";
import type { ProcStatus } from "../lib/types";
import styles from "./StatusDot.module.css";

export function StatusDot({ status, title }: { status: ProcStatus; title?: string }) {
  const label = title ?? statusLabel(status);
  return <span className={clsx(styles.dot, styles[status])} title={label} aria-label={label} />;
}
