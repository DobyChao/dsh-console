import clsx from "clsx";
import type { InputHTMLAttributes } from "react";
import ui from "../styles/ui.module.css";

export function TextInput({
  invalid = false,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={clsx(ui.input, invalid && ui.invalid, className)} {...rest} />;
}
