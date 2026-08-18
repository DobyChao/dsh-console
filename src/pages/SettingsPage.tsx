import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { useLauncher } from "../lib/launcher";
import { api } from "../lib/api";
import type { Appearance } from "../lib/types";
import { Button } from "../components/Button";
import { InstanceCapsule } from "../components/InstanceCapsule";
import { TextInput } from "../components/TextInput";
import { AlertIcon, CheckIcon } from "../components/icons";
import ui from "../styles/ui.module.css";
import styles from "./SettingsPage.module.css";

/** 跟随后端值同步的受控字段；用户编辑期间不被覆盖，只有外部值真正变化时才刷新 */
function useSyncedField(value: string): [string, (v: string) => void] {
  const [field, setField] = useState(value);
  const external = useRef(value);
  useEffect(() => {
    if (value !== external.current) {
      external.current = value;
      setField(value);
    }
  }, [value]);
  return [field, setField];
}

export function SettingsPage({ scrollToEnv }: { scrollToEnv: boolean }) {
  const { state, env, saveSettings, probeEnv, isBusy } = useLauncher();
  const envRef = useRef<HTMLElement>(null);
  const cfg = state?.config;
  const [dshPath, setDshPath] = useSyncedField(cfg?.dshPath ?? "");
  const [checkoutPath, setCheckoutPath] = useSyncedField(cfg?.checkoutPath ?? "");

  useEffect(() => {
    if (scrollToEnv) envRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollToEnv]);

  if (!cfg) return null;
  const probing = isBusy("probe");

  function commitPath(kind: "dshPath" | "checkoutPath", raw: string) {
    const trimmed = raw.trim();
    const current = (kind === "dshPath" ? cfg?.dshPath : cfg?.checkoutPath) ?? "";
    if (trimmed === current) return;
    if (kind === "dshPath") void saveSettings({ dshPath: trimmed });
    else void saveSettings({ checkoutPath: trimmed, dshMode: "checkout" });
  }

  async function pick(kind: "dsh" | "checkout") {
    const folder = await api.pickFolder();
    if (!folder) return;
    if (kind === "checkout") {
      setCheckoutPath(folder);
      void saveSettings({ dshMode: "checkout", checkoutPath: folder });
    } else {
      setDshPath(folder);
      void saveSettings({ dshMode: "path", dshPath: folder });
    }
  }

  function jump(id: string) {
    document.getElementById(`ctrl-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <InstanceCapsule />
      </header>
      <div className={styles.body}>
        <section ref={envRef} className={ui.card} id="env">
          <div className={styles.sectionHead}>
            <h1 className={ui.h1}>{t("settings.envTitle")}</h1>
            <Button busy={probing} onClick={() => void probeEnv()}>
              {t("settings.reprobe")}
            </Button>
          </div>
          <ul className={styles.probe}>
            {(env?.items ?? []).map((item) => (
              <li key={item.id}>
                {item.ok ? (
                  <CheckIcon className={`${styles.probeIcon} ${styles.pass}`} />
                ) : (
                  <AlertIcon className={`${styles.probeIcon} ${styles.fail}`} />
                )}
                <div className={styles.probeBody}>
                  <div>
                    <strong>{item.name}</strong>
                    <span className={item.ok ? styles.pass : styles.fail}>
                      {item.ok ? t("settings.probeOk") : t("settings.probeFail")}
                    </span>
                  </div>
                  <div className={ui.muted}>{item.detail || "—"}</div>
                  {!item.ok && item.hint ? <div className={styles.hint}>{item.hint}</div> : null}
                </div>
                {!item.ok ? (
                  <Button size="tiny" onClick={() => jump(item.id)}>
                    {t("settings.fix")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {env && !env.gitOk ? <p className={ui.muted}>{env.gitHint}</p> : null}
        </section>

        <section className={ui.card}>
          <h1 className={ui.h1}>{t("settings.sourceTitle")}</h1>
          <div className={styles.modes}>
            <label>
              <input
                type="radio"
                name="dsh-mode"
                checked={cfg.dshMode === "path"}
                onChange={() => void saveSettings({ dshMode: "path" })}
              />
              {t("settings.modePath")}
            </label>
            <label>
              <input
                type="radio"
                name="dsh-mode"
                checked={cfg.dshMode === "checkout"}
                onChange={() => void saveSettings({ dshMode: "checkout" })}
              />
              {t("settings.modeCheckout")}
            </label>
          </div>
          <div id="ctrl-dsh" className={styles.field}>
            <label className={ui.label} htmlFor="settings-dsh-path">
              {t("settings.dshPathLabel")}
            </label>
            <div className={ui.row}>
              <TextInput
                id="settings-dsh-path"
                className="font-mono"
                value={dshPath}
                onChange={(e) => setDshPath(e.target.value)}
                onBlur={(e) => commitPath("dshPath", e.target.value)}
              />
              <Button onClick={() => void pick("dsh")}>{t("common.browse")}</Button>
            </div>
          </div>
          <div id="ctrl-node" />
          <div id="ctrl-pnpm" className={styles.field}>
            <p className={ui.muted}>{t("settings.pnpmNote")}</p>
          </div>
          <div id="ctrl-home" className={styles.field}>
            <p className={ui.muted}>{t("settings.homeNote")}</p>
          </div>
          <div id="ctrl-checkout" className={styles.field}>
            <label className={ui.label} htmlFor="settings-checkout-path">
              {t("settings.checkoutLabel")}
            </label>
            <div className={ui.row}>
              <TextInput
                id="settings-checkout-path"
                className="font-mono"
                value={checkoutPath}
                onChange={(e) => setCheckoutPath(e.target.value)}
                onBlur={(e) => commitPath("checkoutPath", e.target.value)}
              />
              <Button onClick={() => void pick("checkout")}>{t("common.browse")}</Button>
            </div>
          </div>
        </section>

        <section className={ui.card}>
          <h1 className={ui.h1}>{t("settings.appearanceTitle")}</h1>
          <div className={styles.modes}>
            {(["light", "dark", "system"] as Appearance[]).map((a) => (
              <label key={a}>
                <input
                  type="radio"
                  name="appearance"
                  checked={cfg.appearance === a}
                  onChange={() => void saveSettings({ appearance: a })}
                />
                {t(`settings.appearance.${a}`)}
              </label>
            ))}
          </div>
        </section>

        <section className={ui.card}>
          <h1 className={ui.h1}>{t("settings.instancesTitle")}</h1>
          <p className={ui.muted}>{t("settings.instancesNote")}</p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("settings.colName")}</th>
                <th>{t("settings.colPort")}</th>
                <th>{t("settings.colProfile")}</th>
                <th>{t("settings.colHome")}</th>
              </tr>
            </thead>
            <tbody>
              {cfg.instances.map((i) => (
                <tr key={i.id}>
                  <td>{i.displayName}</td>
                  <td>{i.port}</td>
                  <td>{i.profile}</td>
                  <td title={i.dshHome}>{i.dshHome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
