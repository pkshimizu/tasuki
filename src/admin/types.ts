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
  /** 止める・起動し直す操作を受けて、エージェントの終了を待っているか */
  pending: "stop" | "restart" | null;
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
  /** この要件に結びつく Issue・PR の数 */
  issues: number;
  pullRequests: number;
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
  /** どの要件のための指示か（run_agent・complete_requirement）。無ければ null */
  requirement: string | null;
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

// ---------- PR とレビュー

import type { Finding, ReviewState, Severity } from "../domain/review.js";
import type { EventType, RunStatus } from "../domain/types.js";

export type { Finding, ReviewState, Severity };

export interface PullRequestRow {
  number: number;
  title: string;
  stage: Stage;
  branch: string;
  state: "open" | "merged" | "closed";
  url: string;
  updatedAt: string;
  /** 開いている PR だけ。閉じた PR では null */
  ci: "pass" | "fail" | "pending" | "none" | null;
  failedChecks: string[];
  conflicting: boolean | null;
  /** この工程のマージの設定 */
  merge: "auto" | "human";
  review: ReviewState | null;
}

/** マージできない理由 */
export type MergeBlocker =
  | { kind: "ci_pending" }
  | { kind: "ci_fail"; checks: string[] }
  | { kind: "ci_none" }
  | { kind: "conflict" }
  | { kind: "draft" }
  | { kind: "review_changes"; round: number }
  | { kind: "review_stale"; sha: string };

export interface ReviewRound {
  round: number;
  sha: string;
  verdict: "approve" | "request_changes";
  at: string;
  /** レビュアーの要約 */
  summary: string;
  /** この回で出た指摘の数 */
  findings: Record<Severity, number>;
}

/** 経過の 1 件。出来事・司令塔の判断・エージェントの実行のどれか */
export type TimelineItem =
  | {
      kind: "event";
      id: string;
      at: string;
      type: EventType;
      /** 出来事の内容（1 行目が見出し、2 行目からが本文） */
      text: string;
      /** 司令塔に渡したか */
      handled: boolean;
    }
  | {
      kind: "decision";
      id: string;
      at: string;
      /** もとになった出来事（1 件 1 行にしたもの） */
      events: string[];
      reasoning: string;
      directives: Directive[];
    }
  | {
      kind: "run";
      id: string;
      runId: number;
      at: string;
      role: WorkerRole;
      target: Target;
      status: RunStatus | "running";
      finishedAt: string | null;
      instruction: string;
      summary: string;
    };

export interface PullRequestDetail {
  pr: PullRequestRow;
  /** マージできない理由。開いていない PR では空 */
  blockers: MergeBlocker[];
  reviews: ReviewRound[];
  findings: Finding[];
  timeline: TimelineItem[];
}

export interface PullRequestList {
  open: PullRequestRow[];
  closed: PullRequestRow[];
}

// ---------- 活動の履歴

export interface ActivityData {
  decisions: Extract<TimelineItem, { kind: "decision" }>[];
  runs: Extract<TimelineItem, { kind: "run" }>[];
  events: Extract<TimelineItem, { kind: "event" }>[];
}

// ---------- 質問

export interface QuestionItem {
  threadId: string;
  title: string;
  body: string;
  origin: Role | null;
  target: Target | null;
  answered: boolean;
  createdAt: string;
  url: string | null;
}

// ---------- プロダクトの情報

export interface ProductKind {
  kind: string;
  /** 設定に書かれた置き場 */
  paths: string[];
  /** 渡す先の役 */
  roles: Role[];
  docs: { path: string; content: string }[];
}

export interface ProductData {
  /** 読み込んだコミット。まだ読み込んでいなければ null */
  commit: string | null;
  loadedAt: string | null;
  kinds: ProductKind[];
}

// ---------- システム

export interface SystemData {
  version: string;
  startedAt: string;
  pid: number;
  paths: { state: string; worktrees: string; repo: string };
  /** エージェントが使うシェル */
  shell: {
    name: "bash" | "powershell";
    path: string | null;
    warning: string | null;
  };
  limitUntil: string | null;
  adminUrl: string | null;
  worktrees: {
    name: string;
    target: Target | null;
    branch: string | null;
    dirty: boolean;
    /** 準備コマンドを実行済みか。準備コマンドの設定が無ければ null */
    setupDone: boolean | null;
  }[];
  /** 最近のログ（古い順） */
  logs: string[];
}

// ---------- 要件

export interface RequirementRow {
  id: string;
  content: string;
  author: string;
  status: "open" | "done";
  createdAt: string;
  /** Discord の投稿。まだ分からなければ null */
  url: string | null;
  /** 結びつくものの数。waiting は返信待ちの質問 */
  counts: {
    questions: number;
    waiting: number;
    issues: number;
    pullRequests: number;
  };
}

/** 要件に結びつくもの。done は、終わったもの（返信のあった質問・閉じた Issue・PR） */
export type RelatedItem =
  | {
      kind: "question";
      id: string;
      title: string;
      origin: Role | null;
      done: boolean;
      at: string;
      url: string | null;
    }
  | {
      kind: "issue";
      id: string;
      number: number;
      title: string | null;
      state: "open" | "closed" | null;
      done: boolean;
      at: string | null;
      url: string;
    }
  | {
      kind: "pr";
      id: string;
      number: number;
      title: string | null;
      stage: Stage | null;
      state: "open" | "merged" | "closed" | null;
      done: boolean;
      at: string | null;
      url: string;
    };

export interface RequirementDetail {
  requirement: RequirementRow;
  related: RelatedItem[];
  timeline: TimelineItem[];
}

// ---------- 操作

/** 操作の結果。できなかったときは、その理由 */
export type OperationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_running" // 中断するエージェントが、もう動いていない
        | "stopping" // 止めている最中
        | "invalid_config"; // 設定に誤りがあって、起動し直せない
      detail: string;
    };

// ---------- 設定

/** フォームで変えられる設定の値。項目の名前は .tasuki/config.yaml と同じ */
export interface SettingsValues {
  /** 数として読めない入力は null */
  poll_interval: number | null;
  limits: { agents: number | null };
  language: string;
  merge: {
    spec: string;
    design: string;
    implementation: string;
    require_ci: boolean;
  };
  discord: {
    channels: { requirements: string; questions: string; notices: string };
    allowed_users: string[];
  };
  paths: { specs: string; design: string; design_system: string };
  /** プロダクトの情報の置き場。種類ごとのパスの一覧 */
  knowledge: Record<string, string[]>;
  workspace: { setup: string[]; setup_on_change: string[] };
  /** 役ごとのモデル。空欄は既定のモデル */
  agents: Record<Role, string>;
}

/** 入力の誤り。path は項目（例: limits.agents）。全体についてのものは空 */
export interface SettingsProblem {
  path: string;
  message: string;
}

export type DiffLine =
  { kind: "same" | "add" | "remove"; text: string } | { kind: "gap" };

export interface SettingsData {
  repo: string;
  /** 設定ファイルの場所 */
  file: string;
  /** 既定のブランチ */
  branch: string;
  /** 既定のブランチにある設定ファイルの印。読めなければ null */
  sha: string | null;
  /** 既定のブランチにある設定。読めないか、誤りがあれば null */
  values: SettingsValues | null;
  /** 省略したときの値 */
  defaults: SettingsValues;
  /** 読めなかった理由。ファイルが無いときは not_found */
  error: string | null;
  /** Discord のトークンが環境変数に入っているか（値は返さない） */
  tokenSet: boolean;
  /** 既定のブランチの設定が、いま動いている設定と違うか */
  differsFromRunning: boolean;
}

export interface SettingsPreview {
  problems: SettingsProblem[];
  /** 変えた項目 */
  changed: string[];
  diff: DiffLine[];
}

export type SettingsSaveResult =
  | { ok: true; number: number; url: string }
  | {
      ok: false;
      reason: "invalid" | "conflict" | "unchanged" | "failed";
      detail: string;
    };
