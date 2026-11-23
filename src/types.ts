/**
 * 部品の間で受け渡す値の形。
 */
import { z } from "zod";
import { ROLES, STAGES } from "./config.js";

/** エージェントが作業する対象 */
export const targetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("requirement"),
    id: z.string().describe("要件の投稿 ID"),
  }),
  z.strictObject({ kind: z.literal("issue"), number: z.number().int() }),
  z.strictObject({ kind: z.literal("pr"), number: z.number().int() }),
  z
    .strictObject({ kind: z.literal("repo") })
    .describe("リポジトリ全体（プランナーなど）"),
]);
export type Target = z.infer<typeof targetSchema>;

/** 対象を見分ける文字列。同じ対象のエージェントを同時に動かさないために使う */
export function targetKey(target: Target): string {
  switch (target.kind) {
    case "requirement":
      return `requirement:${target.id}`;
    case "issue":
      return `issue:${String(target.number)}`;
    case "pr":
      return `pr:${String(target.number)}`;
    case "repo":
      return "repo";
  }
}

/** 作業エージェントの役（司令塔を除く） */
export const WORKER_ROLES = ROLES.filter((r) => r !== "dispatcher");
export const workerRoleSchema = z.enum([
  "spec-master",
  "planner",
  "designer",
  "programmer",
  "reviewer",
]);
export type WorkerRole = z.infer<typeof workerRoleSchema>;

export const stageSchema = z.enum(STAGES);

/** エージェントの実行の結果 */
export const RUN_STATUSES = [
  "done", // 終えた
  "question", // 人に確かめたい
  "failed", // 進められない
  "error", // 実行そのものが失敗した
  "limit", // 利用上限で終わった
  "interrupted", // Tasuki が止まって途中で終わった
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** 出来事の中身。type ごとに形が決まる */
export type EventPayload =
  | {
      type: "requirement_posted";
      requirementId: string;
      author: string;
      content: string;
    }
  | {
      type: "question_answered";
      threadId: string;
      title: string;
      target: Target | null;
      replies: { author: string; content: string }[];
    }
  | {
      type: "docs_changed";
      stage: "spec" | "design";
      commit: string;
      files: string[];
    }
  | {
      type: "issue_changed";
      number: number;
      title: string;
      change: "opened" | "updated" | "closed" | "reopened";
    }
  | {
      type: "pr_changed";
      number: number;
      title: string;
      change: "opened" | "updated" | "merged" | "closed";
      stage: z.infer<typeof stageSchema>;
      branch: string;
    }
  | { type: "ci_changed"; number: number; status: "pass" | "fail" }
  | {
      type: "pr_comment";
      number: number;
      author: string;
      body: string;
      path: string | null;
    }
  | {
      type: "agent_finished";
      runId: number;
      role: WorkerRole;
      target: Target;
      status: RunStatus;
      summary: string;
      questions: string[];
      pr: number | null;
    }
  | {
      type: "merge_refused";
      number: number;
      reason: string;
    }
  | { type: "limit_recovered" };

export type EventType = EventPayload["type"];

export interface TasukiEvent {
  id: number;
  /** 重複を防ぐキー */
  key: string;
  payload: EventPayload;
  createdAt: string;
}
