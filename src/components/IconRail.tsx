import clsx from "clsx";
import type { EnvProbe, PageId } from "../lib/types";
import { AlertIcon, CheckIcon, GearIcon, PlayIcon, PuzzleIcon } from "./icons";

const ITEMS: { id: PageId; title: string; Icon: typeof PlayIcon }[] = [
  { id: "run", title: "运行", Icon: PlayIcon },
  { id: "plugins", title: "插件", Icon: PuzzleIcon },
];

const btn =
  "relative flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-rail px-1 py-2 text-label-2 transition-colors duration-200 ease-ds hover:bg-hover hover:text-label";
const active =
  "bg-surface text-ds before:absolute before:top-1/2 before:left-1 before:h-9 before:w-1 before:-translate-y-1/2 before:rounded-full before:bg-ds before:content-['']";
const icon = "size-5";
const label = "text-[11px] font-medium leading-4";

export function IconRail({
  page,
  env,
  onNavigate,
  onOpenEnv,
}: {
  page: PageId;
  env: EnvProbe | null;
  onNavigate: (page: PageId) => void;
  onOpenEnv: () => void;
}) {
  const ok = env?.ok ?? false;
  const envTitle = ok ? "环境正常" : (env?.firstFailure ?? "环境未就绪");
  return (
    <nav
      className="flex w-20 shrink-0 flex-col items-center border-r border-border bg-sidebar px-2 py-3"
      aria-label="主导航"
    >
      <div className="flex w-full flex-col items-center gap-1.5">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={clsx(btn, page === item.id && active)}
            title={item.title}
            aria-label={item.title}
            aria-current={page === item.id ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <item.Icon className={icon} />
            <span className={label}>{item.title}</span>
          </button>
        ))}
      </div>
      <div className="mt-auto flex w-full flex-col items-center gap-1.5">
        <button
          type="button"
          className={clsx(btn, ok ? "text-success" : "text-warn")}
          title={envTitle}
          aria-label={envTitle}
          onClick={onOpenEnv}
        >
          {ok ? <CheckIcon className={icon} /> : <AlertIcon className={icon} />}
          <span className={label}>环境</span>
        </button>
        <button
          type="button"
          className={clsx(btn, page === "settings" && active)}
          title="设置"
          aria-label="设置"
          aria-current={page === "settings" ? "page" : undefined}
          onClick={() => onNavigate("settings")}
        >
          <GearIcon className={icon} />
          <span className={label}>设置</span>
        </button>
      </div>
    </nav>
  );
}
