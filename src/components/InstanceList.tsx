import { useRef, useState } from "react";
import clsx from "clsx";
import { t } from "../i18n";
import { useLauncher } from "../lib/launcher";
import { useDismiss } from "../lib/use-dismiss";
import { StatusDot } from "./StatusDot";
import { FolderIcon } from "./icons";
import ui from "../styles/ui.module.css";
import styles from "./InstanceList.module.css";

const MENU_WIDTH = 140;

export function InstanceList({
  collapsed,
  onToggleCollapsed,
  onAdd,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onAdd: () => void;
}) {
  const { state, focused, confirm, setFocused, removeInstance } = useLauncher();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, () => setMenu(null), menu !== null);

  if (collapsed || !state) return null;
  const instances = state.config.instances;
  const runtimes = state.runtimes;

  async function remove(id: string) {
    const inst = instances.find((i) => i.id === id);
    if (!inst) return;
    const running = runtimes[id]?.status === "starting" || runtimes[id]?.status === "ready";
    const ok = await confirm({
      title: t("instances.removeTitle"),
      body: running ? t("instances.removeRunning", { name: inst.displayName }) : t("instances.removeConfirm", { name: inst.displayName }),
      confirmLabel: t("instances.remove"),
      danger: true,
    });
    if (ok) void removeInstance(id);
  }

  return (
    <aside className={styles.col}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t("instances.title")}</h1>
        <button type="button" className={styles.fold} title={t("instances.collapse")} onClick={onToggleCollapsed}>
          ‹
        </button>
      </div>
      <div className={styles.list}>
        {instances.length === 0 ? (
          <div className={styles.empty}>
            <FolderIcon className={styles.emptyIcon} />
            <p className={styles.emptyText}>{t("instances.empty")}</p>
          </div>
        ) : (
          instances.map((inst) => {
            const rt = runtimes[inst.id];
            return (
              <button
                key={inst.id}
                type="button"
                className={clsx(styles.item, inst.id === focused?.id && styles.active)}
                aria-haspopup="menu"
                onClick={() => void setFocused(inst.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ id: inst.id, x: e.clientX, y: e.clientY });
                }}
                onKeyDown={(e) => {
                  if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setMenu({ id: inst.id, x: rect.right, y: rect.bottom + 4 });
                  }
                }}
              >
                <span className={styles.row}>
                  <StatusDot status={rt?.status ?? "idle"} />
                  <span className={styles.name}>{inst.displayName}</span>
                  <span className={styles.port}>{inst.port}</span>
                </span>
                <span className={styles.path}>{inst.dshHome}</span>
              </button>
            );
          })
        )}
      </div>
      <button type="button" className={styles.add} onClick={onAdd}>
        {t("instances.add")}
      </button>
      {menu ? (
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - MENU_WIDTH - 8),
            top: Math.min(menu.y, window.innerHeight - 48),
          }}
        >
          <button
            type="button"
            role="menuitem"
            className={clsx(ui.danger, ui.tiny, styles.menuItem)}
            onClick={() => {
              const id = menu.id;
              setMenu(null);
              void remove(id);
            }}
          >
            {t("instances.remove")}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
