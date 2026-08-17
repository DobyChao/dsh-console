import type { ReactNode } from "react";

export function Modal({
  title,
  children,
  onClose,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex w-full max-w-[520px] flex-col rounded-lg border border-border bg-surface p-6 shadow-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="m-0 text-[15px] font-semibold leading-[22px] text-label">{title}</h2>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs text-label-3 hover:bg-hover hover:text-label"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <div className="flex flex-col gap-4">{children}</div>
        {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
