import { useRef, useState } from "react";
import clsx from "clsx";
import { t } from "../i18n";
import { useLauncher } from "../lib/launcher";
import { useDismiss } from "../lib/use-dismiss";
import { StatusDot } from "./StatusDot";
import { FolderIcon } from "./icons";
import styles from "./InstanceList.module.css";

const MENU_WIDTH = 140;

export function InstanceList({
  collapsed,
  onToggleCollapsed,
  onAdd,
  onEdit,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onAdd: () => void;
  onEdit: (id: string) => void;
}) {
  const { state, focused, confirm, setFocused, removeInstance } = useLauncher();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuAnchorRef = useRef<HTMLDivElement>(null);
  useDismiss(menuAnchorRef, () => setMenu(null), menu !== null);

  if (collapsed || !state) return null;
  const instances = state.config.instances;
  const runtimes = state.runtimes;
  const canRemove = instances.length > 1;

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

  function openMenu(id: string, x: number, y: number) {
    setMenu({
      id,
      x: Math.min(x, window.innerWidth - MENU_WIDTH - 8),
      y: Math.min(y, window.innerHeight - 88),
    });
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
            const open = menu?.id === inst.id;
            return (
              <div
                key={inst.id}
                ref={open ? menuAnchorRef : undefined}
                className={clsx(styles.item, inst.id === focused?.id && styles.active)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(inst.id, e.clientX, e.clientY);
                }}
              >
                <button
                  type="button"
                  className={styles.itemMain}
                  onClick={() => {
                    void setFocused(inst.id);
                    setMenu(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      openMenu(inst.id, rect.right, rect.bottom + 4);
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
                <button
                  type="button"
                  className={clsx(styles.more, open && styles.moreOpen)}
                  aria-label={t("instances.actions")}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  title={t("instances.itemHint")}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (open) {
                      setMenu(null);
                      return;
                    }
                    const rect = e.currentTarget.getBoundingClientRect();
                    openMenu(inst.id, rect.right - MENU_WIDTH, rect.bottom + 4);
                  }}
                >
                  ⋯
                </button>
                {open && menu ? (
                  <div className={styles.menu} role="menu" style={{ left: menu.x, top: menu.y }}>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuItem}
                      onClick={() => {
                        const id = menu.id;
                        setMenu(null);
                        onEdit(id);
                      }}
                    >
                      {t("instances.edit")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={clsx(styles.menuItem, styles.menuDanger)}
                      disabled={!canRemove}
                      title={canRemove ? undefined : t("instances.removeLast")}
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
              </div>
            );
          })
        )}
      </div>
      <button type="button" className={styles.add} onClick={onAdd}>
        {t("instances.add")}
      </button>
    </aside>
  );
}
