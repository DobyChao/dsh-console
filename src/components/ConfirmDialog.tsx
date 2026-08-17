import type { ConfirmRequest } from "../lib/launcher";
import { t } from "../i18n";
import { Button } from "./Button";
import { Modal, ModalFooterActions } from "./Modal";

export function ConfirmDialog({
  req,
  onDone,
}: {
  req: ConfirmRequest;
  onDone: (ok: boolean) => void;
}) {
  return (
    <Modal title={req.title} onClose={() => onDone(false)} width={440}>
      <p className="mt-4 mb-0 text-[13px] leading-5 text-label-2">{req.body}</p>
      <ModalFooterActions>
        <Button onClick={() => onDone(false)}>{t("common.cancel")}</Button>
        <Button
          variant={req.danger ? "danger" : "primary"}
          data-autofocus
          onClick={() => onDone(true)}
        >
          {req.confirmLabel ?? t("common.confirm")}
        </Button>
      </ModalFooterActions>
    </Modal>
  );
}
