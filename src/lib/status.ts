import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import type { ProcStatus } from "./types";

const LABELS: Record<ProcStatus, MessageKey> = {
  idle: "status.idle",
  starting: "status.starting",
  ready: "status.ready",
  stopping: "status.stopping",
  error: "status.error",
};

export function statusLabel(status: ProcStatus): string {
  return t(LABELS[status]);
}
