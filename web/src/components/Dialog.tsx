/**
 * 確認ダイアログ。操作（止める・起動し直す・中断する・設定の保存）の前に出す。
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

/** 操作の道に送る。できなかったときは、理由の文を返す */
export function operation(
  t: Messages,
  path: string,
): () => Promise<string | null> {
  return async () => {
    const result = await operate(path);
    return result?.ok ? null : operationError(t, result);
  };
}

export function ConfirmDialog({
  t,
  title,
  confirm,
  danger = false,
  wide = false,
  disabled = false,
  run,
  onClose,
  children,
}: {
  t: Messages;
  title: string;
  /** 実行するボタンの文言 */
  confirm: string;
  danger?: boolean;
  wide?: boolean;
  /** 実行できないとき（中身を読み込んでいる間など） */
  disabled?: boolean;
  /** 実行する。できなかったときは、理由の文を返す */
  run: () => Promise<string | null>;
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

  const submit = async () => {
    setBusy(true);
    setError(null);
    const problem = await run();
    if (problem === null) {
      onClose();
      return;
    }
    setBusy(false);
    setError(problem);
  };

  return (
    <dialog
      ref={ref}
      className={wide ? "dialog wide" : "dialog"}
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
          disabled={busy || disabled}
          onClick={() => void submit()}
        >
          {confirm}
        </button>
      </div>
    </dialog>
  );
}
