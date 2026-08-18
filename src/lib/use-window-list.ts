import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface WindowListOptions {
  /**
   * 所在页是否正在显示。App 里三页常驻、切页只改父级内联 display，
   * 首次挂载时隐藏页的 clientHeight 是 0，而 ResizeObserver 在
   * not-rendered → rendered 这一跳上不可靠——不传这个标志会永远停在 0、只渲染 overscan 行。
   */
  visible?: boolean;
  overscan?: number;
}

export interface WindowList {
  /** 挂到滚动容器的 ref 上（callback ref） */
  attach: (node: HTMLElement | null) => void;
  onScroll: () => void;
  /** 切筛选条件后把滚动位置收回顶部 */
  scrollToTop: () => void;
  /** 要渲染的区间 [first, last) */
  first: number;
  last: number;
  /** 撑开滚动条的总高度 */
  totalHeight: number;
  /** 可见区间相对列表顶部的位移 */
  offsetTop: number;
}

/**
 * 定高列表窗口化：只渲染视口内 ± overscan 行。
 * 精选目录有 1200+ 条，全量渲染会堆出上万 DOM 节点、把滚动条拉到十万像素级。
 * 依赖每行高度严格等于 rowHeight——所以插件行的描述只能占一行。
 */
export function useWindowList(
  count: number,
  rowHeight: number,
  { visible = true, overscan = 6 }: WindowListOptions = {},
): WindowList {
  const node = useRef<HTMLElement | null>(null);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  // 用 callback ref 而非 effect 做首测：commit 阶段就能拿到高度，也避开 set-state-in-effect
  const attach = useCallback((next: HTMLElement | null) => {
    node.current = next;
    setEl(next);
    if (next) {
      setViewport(next.clientHeight);
      setScrollTop(next.scrollTop);
    }
  }, []);

  // 本页重新显示时补一次测量：挂载时量到的很可能是 display:none 下的 0
  useLayoutEffect(() => {
    if (!visible || !node.current) return;
    setViewport(node.current.clientHeight);
  }, [visible]);

  // 窗口缩放 / 实例列折叠不会让本组件重渲染，这类尺寸变化交给 ResizeObserver
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const onScroll = useCallback(() => {
    if (node.current) setScrollTop(node.current.scrollTop);
  }, []);

  const scrollToTop = useCallback(() => {
    if (node.current) node.current.scrollTop = 0;
    setScrollTop(0);
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);

  return {
    attach,
    onScroll,
    scrollToTop,
    first,
    last: Math.max(first, last),
    totalHeight: count * rowHeight,
    offsetTop: first * rowHeight,
  };
}
