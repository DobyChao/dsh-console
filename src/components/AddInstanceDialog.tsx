import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import ui from "../styles/ui.module.css";

export function AddInstanceDialog({
  draft,
  onChange,
  onClose,
  onSubmit,
}: {
  draft: { displayName: string; dshHome: string; port: number };
  onChange: (next: { displayName: string; dshHome: string; port: number }) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const homeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    homeRef.current?.focus();
  }, []);

  function submitIfReady() {
    if (draft.dshHome.trim()) onSubmit();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-[480px] rounded-lg border border-border bg-surface p-6 shadow-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-instance-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submitIfReady();
          }
        }}
      >
        <h2 id="add-instance-title" className="m-0 text-[15px] font-semibold leading-[22px]">
          添加实例
        </h2>
        <p className="mt-2 mb-5 text-[13px] leading-5 text-label-3">
          每个实例使用独立的 home 目录和端口，互不影响。第一次启动时会在该目录初始化。
        </p>

        <label className={ui.label} htmlFor="add-instance-home">
          Home 目录
        </label>
        <div className={`${ui.row} mb-1`}>
          <input
            id="add-instance-home"
            ref={homeRef}
            className={`${ui.input} font-mono text-[13px]`}
            value={draft.dshHome}
            onChange={(e) => onChange({ ...draft, dshHome: e.target.value })}
            placeholder="C:\Users\Admin\.dsh-work"
          />
          <button
            type="button"
            className={`${ui.ghost} shrink-0 whitespace-nowrap`}
            onClick={() =>
              api.pickFolder().then((p) => {
                if (!p) return;
                const name = p.split(/[/\\]/).filter(Boolean).pop() ?? "";
                onChange({
                  ...draft,
                  dshHome: p,
                  displayName: draft.displayName.trim() || name,
                });
              })
            }
          >
            浏览
          </button>
        </div>
        <p className="mb-4 text-xs leading-[18px] text-label-3">对应环境变量 DSH_HOME。可用空目录，或已有的 harness home。</p>

        <label className={ui.label} htmlFor="add-instance-name">
          显示名
        </label>
        <input
          id="add-instance-name"
          className={`${ui.input} mb-4`}
          value={draft.displayName}
          onChange={(e) => onChange({ ...draft, displayName: e.target.value })}
          placeholder="浏览目录后会自动填入文件夹名"
        />

        <label className={ui.label} htmlFor="add-instance-port">
          端口
        </label>
        <input
          id="add-instance-port"
          className={`${ui.input} w-32`}
          type="number"
          min={1}
          max={65535}
          value={draft.port}
          onChange={(e) => onChange({ ...draft, port: Number(e.target.value) })}
        />
        <p className="mt-1 mb-0 text-xs leading-[18px] text-label-3">本机 Web UI 监听端口。第二实例建议 3081。</p>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={ui.ghost} onClick={onClose}>
            取消
          </button>
          <button type="button" className={ui.primary} disabled={!draft.dshHome.trim()} onClick={onSubmit}>
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
