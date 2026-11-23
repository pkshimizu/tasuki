/**
 * 管理画面からの操作（止める・起動し直す・エージェントを中断する）。
 */
import { NOT_FOUND } from "./server.js";
import type { OperationResult } from "./types.js";

export interface Operations {
  /** 動いているエージェントの終了を待って、止める */
  stop(): OperationResult;
  /** 動いているエージェントの終了を待って、設定を読み直して始め直す */
  restart(): OperationResult;
  /** エージェントを 1 つだけ中断する */
  abortRun(runId: number): OperationResult;
}

/** 操作の道（POST）から、操作を選んで実行する。無ければ NOT_FOUND */
export type AdminOperations = (
  path: string,
) => OperationResult | typeof NOT_FOUND;

export function adminOperations(ops: Operations): AdminOperations {
  return (path) => {
    if (path === "/api/ops/stop") return ops.stop();
    if (path === "/api/ops/restart") return ops.restart();
    const abort = /^\/api\/ops\/runs\/(\d{1,12})\/abort$/.exec(path);
    if (abort) return ops.abortRun(Number(abort[1]));
    return NOT_FOUND;
  };
}
