import { useState } from "react";
import { StatusDot, statusLabel } from "./StatusDot";
import type { Instance, RuntimeInfo } from "../lib/types";
import styles from "./InstanceCapsule.module.css";

export function InstanceCapsule({
  instances,
  focused,
  runtime,
  onFocus,
}: {
  instances: Instance[];
  focused: Instance | undefined;
  runtime?: RuntimeInfo;
  onFocus: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!focused) return null;
  const status = runtime?.status ?? "idle";
  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.cap} onClick={() => setOpen((v) => !v)}>
        <StatusDot status={status} />
        <span className={styles.name}>{focused.displayName}</span>
        <span className={styles.meta}>· {focused.port}</span>
        <span className={styles.meta}>· {statusLabel(status)}</span>
      </button>
      {open ? (
        <div className={styles.menu} role="listbox">
          {instances.map((inst) => (
            <button
              key={inst.id}
              type="button"
              className={styles.option}
              onClick={() => {
                onFocus(inst.id);
                setOpen(false);
              }}
            >
              {inst.displayName}
              <span className={styles.meta}> :{inst.port}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
