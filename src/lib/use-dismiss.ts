import { useEffect, useRef, type RefObject } from "react";

/**
 * active 时监听外部 pointerdown 与 Escape，触发 onDismiss。
 * 用于弹出菜单 / 下拉这类轻量浮层。
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active: boolean,
): void {
  const cb = useRef(onDismiss);
  useEffect(() => {
    cb.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [active, ref]);
}
