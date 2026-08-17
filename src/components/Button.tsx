import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";
import ui from "../styles/ui.module.css";

type Variant = "primary" | "ghost" | "danger";
type Size = "md" | "tiny";

export function Button({
  variant = "ghost",
  size = "md",
  busy = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={clsx(ui[variant], size === "tiny" && ui.tiny, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className={ui.spinner} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
