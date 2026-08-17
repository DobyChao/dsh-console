import { useState } from "react";
import clsx from "clsx";
import { StatusDot } from "./StatusDot";
import type { Instance, RuntimeInfo } from "../lib/types";
import ui from "../styles/ui.module.css";
import styles from "./InstanceList.module.css";

export function InstanceList({
  instances,
  focusedId,
  runtimes,
  collapsed,
  onToggleCollapsed,
  onFocus,
  onAdd,
  onRemove,
}: {
  instances: Instance[];
  focusedId: string;
  runtimes: Record<string, RuntimeInfo>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onFocus: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const [menuId, setMenuId] = useState<string | null>(null);
  if (collapsed) return null;
  return (
    <aside className={styles.col}>
      <div className={styles.head}>
        <h1 className={styles.title}>实例</h1>
        <button type="button" className={styles.fold} title="折叠实例列" onClick={onToggleCollapsed}>
          ‹
        </button>
      </div>
      <div className={styles.list}>
        {instances.length === 0 ? (
          <div className={styles.empty}>还没有实例。用下面的按钮添加一个独立 home。</div>
        ) : (
          instances.map((inst) => {
            const rt = runtimes[inst.id];
            return (
              <button
                key={inst.id}
                type="button"
                className={clsx(styles.item, inst.id === focusedId && styles.active)}
                onClick={() => onFocus(inst.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuId(inst.id);
                }}
              >
                <span className={styles.row}>
                  <StatusDot status={rt?.status ?? "idle"} />
                  <span className={styles.name}>{inst.displayName}</span>
                  <span className={styles.port}>{inst.port}</span>
                </span>
                <span className={styles.path}>{inst.dshHome}</span>
                {menuId === inst.id ? (
                  <span
                    className={clsx(ui.danger, ui.tiny, styles.remove)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuId(null);
                      onRemove(inst.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onRemove(inst.id);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    删除
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
      <button type="button" className={styles.add} onClick={onAdd}>
        + 添加实例
      </button>
    </aside>
  );
}
