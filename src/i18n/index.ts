import { useCallback } from "react";
import zh from "./zh";

export type MessageKey = keyof typeof zh;
export type MessageDict = Record<MessageKey, string>;

const dicts: Record<string, MessageDict> = { zh };
// 未来切换 locale 时改为可变状态 + 订阅；现阶段只有中文
const locale = "zh";

/**
 * 取一条文案；params 做 {name} 形式的简单插值。
 * 目前只有 zh，未来加 en.ts 并切换 locale 即可，组件不用改。
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let text: string = dicts[locale][key] ?? zh[key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export function useT(): (key: MessageKey, params?: Record<string, string | number>) => string {
  // 之后切换 locale 时改为订阅 context；现阶段 t 是纯函数，包一层保持调用形态稳定
  return useCallback((key: MessageKey, params?: Record<string, string | number>) => t(key, params), []);
}
