/**
 * 管理画面の API が返す値の形。画面（web/）もこの型を使う。
 * 実行時の値を持たない（型だけ）ので、画面のビルドにサーバーのコードは入らない。
 */
import type { Role, Stage } from "../config/config.js";
import type { Target, WorkerRole } from "../domain/types.js";

/** 稼働状態 */
export type AppStatus =
  | "running" // エージェントか司令塔が動いている
  | "idle" // 次の出来事を待っている
  | "limited" // 利用上限で待機中
  | "stopped"; // 監視を止めた

/** 画面ヘッダーとメニューに出すもの */
export interface AppInfo {
  repo: string;
  version: string;
  status: AppStatus;
  /** 利用上限で待機中のときの、再開の時刻 */
  limitUntil: string | null;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  /** 人の番のものの件数 */
  needsAction: { questions: number; pullRequests: number; notices: number };
}

export interface AwaitingReply {
  threadId: string;
  title: string;
  /** どの役からの質問か。司令塔からなら dispatcher。分からなければ null */
  origin: Role | null;
  target: Target | null;
  createdAt: string;
  /** 質問の本文の冒頭 */
  excerpt: string;
  /** Discord のスレッド。まだ分からなければ null */
  url: string | null;
}

export interface AwaitingMerge {
  number: number;
  title: string;
  stage: Stage;
  url: string;
  updatedAt: string;
}

export type Notice =
  | { kind: "dispatcher_failing"; failures: number; error: string }
  | { kind: "dirty_worktree"; name: string };

export interface RunningAgent {
  runId: number;
  role: WorkerRole;
  target: Target;
  /** 対象の Issue・PR のタイトル。分からなければ null */
  targetTitle: string | null;
  startedAt: string;
  /** 指示書 */
  instruction: string;
  /** 作業フォルダの名前。用意できるまでは null */
  worktree: string | null;
}

export interface ActiveRequirement {
  id: string;
  content: string;
  author: string;
  createdAt: string;
  /** この要件についての質問の数 */
  questions: number;
}

/** 司令塔の指示と、その結果 */
export interface Directive {
  type:
    | "run_agent"
    | "ask_human"
    | "notify"
    | "merge_pr"
    | "complete_requirement"
    | "wait";
  role: WorkerRole | null;
  target: Target | null;
  /** merge_pr の PR 番号 */
  number: number | null;
  /** 実行したか、見送ったか、失敗したか。wait は none */
  outcome: "done" | "skipped" | "failed" | "none";
  /** 結果の説明（見送りや失敗の理由） */
  detail: string;
}

export interface DecisionSummary {
  id: number;
  at: string;
  /** もとになった出来事の 1 件目（1 行） */
  event: string;
  /** ほかの出来事の件数 */
  moreEvents: number;
  directives: Directive[];
}

export interface DashboardData {
  awaitingReply: AwaitingReply[];
  awaitingMerge: AwaitingMerge[];
  notices: Notice[];
  agents: RunningAgent[];
  requirements: ActiveRequirement[];
  decisions: DecisionSummary[];
}
