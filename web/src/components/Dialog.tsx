/**
 * 確認ダイアログ。操作（止める・起動し直す・中断する）の前に出す。
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { OperationResult } from "../../../src/admin/types.js";
import { operate } from "../api.js";
import type { Messages } from "../i18n.js";

/** できなかった操作の理由を、人が読む文にする */
export function operationError(
  t: Messages,
  result: Exclude<OperationResult, { ok: true }> | undefined,
): string {
  if (!result) return t.ops.errors.failed;
  const text = t.ops.errors[result.reason];
  return result.detail ? `${text}\n${result.detail}` : text;
}

export function ConfirmDialog({
  t,
  title,
  confirm,
  danger = false,
  path,
  onClose,
  children,
}: {
  t: Messages;
  title: string;
  /** 実行するボタンの文言 */
  confirm: string;
  danger?: boolean;
  /** 実行する操作の道 */
  path: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    const result = await operate(path);
    if (result?.ok) {
      onClose();
      return;
    }
    setBusy(false);
    setError(operationError(t, result));
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onClose={onClose}
      onClick={(e) => {
        // 枠の外（背景）を押したら閉じる
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-body">
        <h2 id="dialog-title">{title}</h2>
        {children}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog-foot">
        <button type="button" className="button" onClick={onClose}>
          {t.ops.cancel}
        </button>
        <button
          type="button"
          className={danger ? "button danger" : "button primary"}
          disabled={busy}
          onClick={() => void run()}
        >
          {confirm}
        </button>
      </div>
    </dialog>
  );
}
