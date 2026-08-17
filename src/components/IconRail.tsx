import clsx from "clsx";
import { t } from "../i18n";
import type { EnvProbe, PageId } from "../lib/types";
import { AlertIcon, CheckIcon, GearIcon, PlayIcon, PuzzleIcon } from "./icons";

const ITEMS: { id: PageId; titleKey: "nav.run" | "nav.plugins"; Icon: typeof PlayIcon }[] = [
  { id: "run", titleKey: "nav.run", Icon: PlayIcon },
  { id: "plugins", titleKey: "nav.plugins", Icon: PuzzleIcon },
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
  // null = 还在探测：中性图标，不误报「未就绪」
  const envState = env === null ? "checking" : env.ok ? "ok" : "bad";
  const envTitle =
    envState === "checking"
      ? t("nav.envChecking")
      : envState === "ok"
        ? t("nav.envOk")
        : (env?.firstFailure ?? t("nav.envBad"));
  return (
    <nav
      className="flex w-20 shrink-0 flex-col items-center border-r border-border bg-sidebar px-2 py-3"
      aria-label={t("nav.region")}
    >
      <div className="flex w-full flex-col items-center gap-1.5">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={clsx(btn, page === item.id && active)}
            title={t(item.titleKey)}
            aria-label={t(item.titleKey)}
            aria-current={page === item.id ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <item.Icon className={icon} />
            <span className={label}>{t(item.titleKey)}</span>
          </button>
        ))}
      </div>
      <div className="mt-auto flex w-full flex-col items-center gap-1.5">
        <button
          type="button"
          className={clsx(
            btn,
            envState === "ok" && "text-success",
            envState === "bad" && "text-warn",
            envState === "checking" && "text-label-3",
          )}
          title={envTitle}
          aria-label={envTitle}
          onClick={onOpenEnv}
        >
          {envState === "ok" ? <CheckIcon className={icon} /> : <AlertIcon className={icon} />}
          <span className={label}>{t("nav.env")}</span>
        </button>
        <button
          type="button"
          className={clsx(btn, page === "settings" && active)}
          title={t("nav.settings")}
          aria-label={t("nav.settings")}
          aria-current={page === "settings" ? "page" : undefined}
          onClick={() => onNavigate("settings")}
        >
          <GearIcon className={icon} />
          <span className={label}>{t("nav.settings")}</span>
        </button>
      </div>
    </nav>
  );
}
