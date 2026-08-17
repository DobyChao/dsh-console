import { useRef, useState } from "react";
import { useLauncher } from "../lib/launcher";
import { useDismiss } from "../lib/use-dismiss";
import { statusLabel } from "../lib/status";
import { StatusDot } from "./StatusDot";
import styles from "./InstanceCapsule.module.css";

export function InstanceCapsule() {
  const { state, focused, runtime, setFocused } = useLauncher();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(wrapRef, () => setOpen(false), open);

  if (!focused) return null;
  const status = runtime?.status ?? "idle";

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.cap}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <StatusDot status={status} />
        <span className={styles.name}>{focused.displayName}</span>
        <span className={styles.meta}>· {focused.port}</span>
        <span className={styles.meta}>· {statusLabel(status)}</span>
      </button>
      {open && state ? (
        <div className={styles.menu} role="menu">
          {state.config.instances.map((inst) => {
            const current = inst.id === focused.id;
            return (
              <button
                key={inst.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={current}
                className={current ? styles.optionCurrent : styles.option}
                disabled={current}
                onClick={() => {
                  setOpen(false);
                  void setFocused(inst.id);
                }}
              >
                <span className={styles.optionName}>{inst.displayName}</span>
                <span className={styles.meta}> :{inst.port}</span>
                {current ? <span className={styles.check}>✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
