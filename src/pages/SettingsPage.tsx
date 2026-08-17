import { useEffect, useRef } from "react";
import clsx from "clsx";
import { InstanceCapsule } from "../components/InstanceCapsule";
import { api, errMessage } from "../lib/api";
import type { Appearance, DshMode, EnvProbe, Instance, LauncherState, RuntimeInfo } from "../lib/types";
import ui from "../styles/ui.module.css";
import styles from "./SettingsPage.module.css";

export function SettingsPage({
  state,
  focused,
  runtime,
  env,
  scrollToEnv,
  onState,
  onEnv,
  onError,
}: {
  state: LauncherState;
  focused?: Instance;
  runtime?: RuntimeInfo;
  env: EnvProbe | null;
  scrollToEnv: boolean;
  onState: (s: LauncherState) => void;
  onEnv: (e: EnvProbe) => void;
  onError: (msg: string | null) => void;
}) {
  const envRef = useRef<HTMLElement>(null);
  const cfg = state.config;

  useEffect(() => {
    if (scrollToEnv) envRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollToEnv]);

  async function save(partial: {
    dshMode?: DshMode;
    dshPath?: string | null;
    checkoutPath?: string | null;
    appearance?: Appearance;
  }) {
    onError(null);
    try {
      const next = await api.saveSettings({
        dshMode: partial.dshMode ?? cfg.dshMode,
        dshPath: partial.dshPath === undefined ? cfg.dshPath : partial.dshPath,
        checkoutPath: partial.checkoutPath === undefined ? cfg.checkoutPath : partial.checkoutPath,
        appearance: partial.appearance ?? cfg.appearance,
      });
      onState(next);
      onEnv(await api.probeEnv());
    } catch (e) {
      onError(errMessage(e));
    }
  }

  async function pick(kind: "dsh" | "checkout") {
    const folder = await api.pickFolder();
    if (!folder) return;
    if (kind === "checkout") await save({ dshMode: "checkout", checkoutPath: folder });
    else await save({ dshMode: "path", dshPath: folder });
  }

  function jump(id: string) {
    document.getElementById(`ctrl-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <InstanceCapsule
          instances={cfg.instances}
          focused={focused}
          runtime={runtime}
          onFocus={(id) => api.setFocused(id).then(onState).catch((e) => onError(errMessage(e)))}
        />
      </header>
      <div className={styles.body}>
        <section ref={envRef} className={ui.card} id="env">
          <div className={styles.sectionHead}>
            <h1 className={ui.h1}>环境</h1>
            <button
              type="button"
              className={ui.ghost}
              onClick={() => api.probeEnv().then(onEnv).catch((e) => onError(errMessage(e)))}
            >
              重新检测
            </button>
          </div>
          <ul className={styles.probe}>
            {(env?.items ?? []).map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span className={item.ok ? styles.pass : styles.fail}>{item.ok ? "正常" : "未就绪"}</span>
                  <div className={ui.muted}>{item.detail || "—"}</div>
                  {!item.ok && item.hint ? <div className={styles.hint}>{item.hint}</div> : null}
                </div>
                {!item.ok ? (
                  <button type="button" className={clsx(ui.ghost, ui.tiny)} onClick={() => jump(item.id)}>
                    去设置
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {env && !env.gitOk ? <p className={ui.muted}>{env.gitHint}</p> : null}
        </section>

        <section className={ui.card}>
          <h1 className={ui.h1}>dsh 来源</h1>
          <div className={styles.modes}>
            <label>
              <input
                type="radio"
                checked={cfg.dshMode === "path"}
                onChange={() => void save({ dshMode: "path" })}
              />
              PATH / 指定二进制
            </label>
            <label>
              <input
                type="radio"
                checked={cfg.dshMode === "checkout"}
                onChange={() => void save({ dshMode: "checkout" })}
              />
              harness checkout
            </label>
          </div>
          <div id="ctrl-dsh" className={styles.field}>
            <label className={ui.label}>dsh 路径（空 = PATH 上的 dsh）</label>
            <div className={ui.row}>
              <input
                className={ui.input}
                defaultValue={cfg.dshPath ?? ""}
                key={`dsh-${cfg.dshPath ?? ""}`}
                onBlur={(e) => void save({ dshPath: e.target.value })}
              />
              <button type="button" className={ui.ghost} onClick={() => void pick("dsh")}>
                浏览
              </button>
            </div>
          </div>
          <div id="ctrl-node" />
          <div id="ctrl-pnpm" className={styles.field}>
            <p className={ui.muted}>pnpm 必须在 PATH 上。install pnpm to manage profile plugins。</p>
          </div>
          <div id="ctrl-home" className={styles.field}>
            <p className={ui.muted}>焦点 DSH_HOME 在运行页实例列里改。</p>
          </div>
          <div id="ctrl-checkout" className={styles.field}>
            <label className={ui.label}>checkout 根目录（需已 pnpm run build）</label>
            <div className={ui.row}>
              <input
                className={ui.input}
                defaultValue={cfg.checkoutPath ?? ""}
                key={`co-${cfg.checkoutPath ?? ""}`}
                onBlur={(e) => void save({ checkoutPath: e.target.value, dshMode: "checkout" })}
              />
              <button type="button" className={ui.ghost} onClick={() => void pick("checkout")}>
                浏览
              </button>
            </div>
          </div>
        </section>

        <section className={ui.card}>
          <h1 className={ui.h1}>外观</h1>
          <div className={styles.modes}>
            {(["light", "dark", "system"] as Appearance[]).map((a) => (
              <label key={a}>
                <input
                  type="radio"
                  checked={cfg.appearance === a}
                  onChange={() => void save({ appearance: a })}
                />
                {a === "light" ? "浅色" : a === "dark" ? "深色" : "跟随系统"}
              </label>
            ))}
          </div>
        </section>

        <section className={ui.card}>
          <h1 className={ui.h1}>实例一览</h1>
          <p className={ui.muted}>增删改以运行页左列为准。</p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>名称</th>
                <th>端口</th>
                <th>启动配置</th>
                <th>DSH_HOME</th>
              </tr>
            </thead>
            <tbody>
              {cfg.instances.map((i) => (
                <tr key={i.id}>
                  <td>{i.displayName}</td>
                  <td>{i.port}</td>
                  <td>{i.profile}</td>
                  <td>{i.dshHome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
