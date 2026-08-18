import { useEffect, useState } from "react";
import { t } from "../i18n";
import { api } from "../lib/api";
import { useLauncher } from "../lib/launcher";
import type { InstancePatch } from "../lib/types";
import { Button } from "./Button";
import { Modal, ModalFooterActions } from "./Modal";
import { TextInput } from "./TextInput";
import ui from "../styles/ui.module.css";

interface Draft {
  displayName: string;
  dshHome: string;
  port: string;
}

function folderName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? "";
}

export function AddInstanceDialog({ instanceId, onClose }: { instanceId?: string; onClose: () => void }) {
  const { state, addInstance, isBusy } = useLauncher();
  const editing = instanceId ? state?.config.instances.find((i) => i.id === instanceId) : undefined;
  const [draft, setDraft] = useState<Draft>(() =>
    editing
      ? { displayName: editing.displayName, dshHome: editing.dshHome, port: String(editing.port) }
      : { displayName: "", dshHome: "", port: "3081" },
  );
  const [errors, setErrors] = useState<{ home?: string; port?: string }>({});
  const submitting = Boolean(editing ? isBusy(`save-instance:${editing.id}`) : isBusy("add-instance"));

  useEffect(() => {
    if (instanceId && !editing) onClose();
  }, [instanceId, editing, onClose]);

  useEffect(() => {
    if (editing) return;
    let cancelled = false;
    api
      .nextInstancePort()
      .then((port) => {
        if (!cancelled) setDraft((d) => ({ ...d, port: String(port) }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [editing]);

  function patch(next: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...next }));
    setErrors((e) => ({ ...e, ...Object.fromEntries(Object.keys(next).map((k) => [k, undefined])) }));
  }

  function pickFolder() {
    api.pickFolder().then((p) => {
      if (!p) return;
      patch({ dshHome: p, displayName: draft.displayName.trim() || folderName(p) });
    });
  }

  function validate(): boolean {
    const next: { home?: string; port?: string } = {};
    if (!draft.dshHome.trim()) next.home = t("addInstance.homeRequired");
    const port = Number(draft.port);
    if (!/^\d+$/.test(draft.port.trim()) || port < 1 || port > 65535) {
      next.port = t("addInstance.portInvalid");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    const p: InstancePatch = {
      ...(editing ? { id: editing.id } : {}),
      displayName: draft.displayName.trim() || folderName(draft.dshHome) || t("addInstance.defaultName"),
      dshHome: draft.dshHome.trim(),
      port: Number(draft.port.trim()),
      profile: editing?.profile ?? "web",
    };
    if (await addInstance(p)) onClose();
  }

  return (
    <Modal title={editing ? t("instances.editTitle") : t("addInstance.title")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="mt-2 mb-5 text-[13px] leading-5 text-label-3">{editing ? t("addInstance.editDesc") : t("addInstance.desc")}</p>

        <label className={ui.label} htmlFor="add-instance-home">
          {t("addInstance.homeLabel")}
        </label>
        <div className={`${ui.row} mb-1`}>
          <TextInput
            id="add-instance-home"
            data-autofocus={!editing}
            className="font-mono text-[13px]"
            invalid={Boolean(errors.home)}
            value={draft.dshHome}
            onChange={(e) => patch({ dshHome: e.target.value })}
            placeholder={t("addInstance.homePlaceholder")}
          />
          <Button className="shrink-0 whitespace-nowrap" onClick={() => void pickFolder()}>
            {t("common.browse")}
          </Button>
        </div>
        {errors.home ? <p className={ui.fieldError}>{errors.home}</p> : null}
        <p className="mb-4 text-xs leading-[18px] text-label-3">{t("addInstance.homeHint")}</p>

        <label className={ui.label} htmlFor="add-instance-name">
          {t("addInstance.nameLabel")}
        </label>
        <TextInput
          id="add-instance-name"
          data-autofocus={Boolean(editing)}
          className="mb-4"
          value={draft.displayName}
          onChange={(e) => patch({ displayName: e.target.value })}
          placeholder={t("addInstance.namePlaceholder")}
        />

        <label className={ui.label} htmlFor="add-instance-port">
          {t("addInstance.portLabel")}
        </label>
        <TextInput
          id="add-instance-port"
          className="w-32"
          type="number"
          min={1}
          max={65535}
          inputMode="numeric"
          invalid={Boolean(errors.port)}
          value={draft.port}
          onChange={(e) => patch({ port: e.target.value })}
        />
        {errors.port ? <p className={ui.fieldError}>{errors.port}</p> : null}
        <p className="mt-1 mb-0 text-xs leading-[18px] text-label-3">{t("addInstance.portHint")}</p>

        <ModalFooterActions>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" busy={submitting} disabled={!draft.dshHome.trim()}>
            {editing ? t("addInstance.save") : t("addInstance.submit")}
          </Button>
        </ModalFooterActions>
      </form>
    </Modal>
  );
}
