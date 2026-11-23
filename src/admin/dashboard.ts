/**
 * 管理画面に出す内容を、記録と今の様子から組み立てる。
 */
import { type Role, ROLES } from "../config/config.js";
import { requirementLinks } from "./requirements.js";
import type { SituationPullRequest } from "../dispatcher/dispatcher.js";
import { type Target, targetKey, type WorkerRole } from "../domain/types.js";
import type { Issue } from "../integrations/github.js";
import type { Clock, Store } from "../store/store.js";
import type {
  AppInfo,
  AppStatus,
  DashboardData,
  DecisionSummary,
  Directive,
} from "./types.js";

/** 監視スレッドの今の様子 */
export interface MonitorSnapshot {
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  /** 司令塔に判断を頼んでいる最中か */
  dispatching: boolean;
  /** 監視を止めたか */
  stopped: boolean;
  /** 司令塔の実行が続けて失敗した回数と、最後のエラー */
  dispatcherFailures: number;
  lastDispatchError: string | null;
  /** 最後に読めた GitHub の様子。まだ読めていなければ null */
  github: { issues: Issue[]; pullRequests: SituationPullRequest[] } | null;
}

/** 動いているエージェントの今の様子 */
export interface ExecutorSnapshot {
  agents: {
    runId: number;
    role: WorkerRole;
    target: Target;
    cwd: string | null;
  }[];
  limitUntil: string | null;
  /** 変更が残っていて消せない作業フォルダの名前 */
  dirtyWorktrees: string[];
}

export interface AdminSources {
  repo: string;
  version: string;
  store: Store;
  monitor: () => MonitorSnapshot;
  executor: () => ExecutorSnapshot;
  /** Discord のスレッドの URL。まだ分からなければ undefined */
  threadUrl: (threadId: string) => string | undefined;
  /** 要件の投稿の URL */
  requirementUrl: (messageId: string) => string | undefined;
  clock: Clock;
}

const RECENT_DECISIONS = 5;
/** 司令塔の失敗を「そのほかの知らせ」に出す回数 */
export const NOTICE_FAILURES = 3;
const EXCERPT = 160;

function status(m: MonitorSnapshot, e: ExecutorSnapshot): AppStatus {
  if (m.stopped) return "stopped";
  if (e.limitUntil !== null) return "limited";
  if (e.agents.length > 0 || m.dispatching) return "running";
  return "idle";
}

/** 人がマージするのを待っている PR（マージの設定が human で、approve 済み・CI 合格） */
function awaitingMerge(m: MonitorSnapshot): SituationPullRequest[] {
  return (m.github?.pullRequests ?? []).filter(
    (pr) =>
      pr.merge === "human" &&
      !pr.draft &&
      pr.ci === "pass" &&
      pr.mergeable !== "conflicting" &&
      pr.review?.lastVerdict === "approve" &&
      pr.review.reviewedHead,
  );
}

function notices(
  m: MonitorSnapshot,
  e: ExecutorSnapshot,
): DashboardData["notices"] {
  const list: DashboardData["notices"] = [];
  if (m.dispatcherFailures >= NOTICE_FAILURES) {
    list.push({
      kind: "dispatcher_failing",
      failures: m.dispatcherFailures,
      error: m.lastDispatchError ?? "",
    });
  }
  for (const name of e.dirtyWorktrees) {
    list.push({ kind: "dirty_worktree", name });
  }
  return list;
}

export function buildApp(s: AdminSources): AppInfo {
  const m = s.monitor();
  const e = s.executor();
  return {
    repo: s.repo,
    version: s.version,
    status: status(m, e),
    limitUntil: e.limitUntil,
    lastCheckAt: m.lastCheckAt,
    nextCheckAt: m.stopped ? null : m.nextCheckAt,
    needsAction: {
      questions: s.store.questions().filter((q) => !q.answered).length,
      pullRequests: awaitingMerge(m).length,
      notices: notices(m, e).length,
    },
  };
}

function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" && (ROLES as readonly string[]).includes(value)
  );
}

function isTarget(value: unknown): value is Target {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "requirement" ||
    kind === "issue" ||
    kind === "pr" ||
    kind === "repo"
  );
}

const DIRECTIVE_TYPES = [
  "run_agent",
  "ask_human",
  "notify",
  "merge_pr",
  "complete_requirement",
  "wait",
] as const;

/** 記録に残した指示（指示と結果）を、画面に出す形にする。読めないものは捨てる */
export function toDirective(raw: unknown): Directive | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const a = raw as Record<string, unknown>;
  const type = DIRECTIVE_TYPES.find((t) => t === a.type);
  if (!type) return undefined;
  const result = typeof a.result === "string" ? a.result : "";
  const outcome: Directive["outcome"] =
    type === "wait"
      ? "none"
      : result.startsWith("見送り")
        ? "skipped"
        : result.startsWith("失敗")
          ? "failed"
          : "done";
  return {
    type,
    role: isRole(a.role) && a.role !== "dispatcher" ? a.role : null,
    target: isTarget(a.target) ? a.target : null,
    number: typeof a.number === "number" ? a.number : null,
    requirement:
      typeof a.requirement === "string"
        ? a.requirement
        : typeof a.requirementId === "string"
          ? a.requirementId
          : null,
    outcome,
    detail:
      type === "wait"
        ? typeof a.reason === "string"
          ? a.reason
          : ""
        : result.replace(/^(見送り|失敗): /, ""),
  };
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

export function summarizeDecision(d: {
  id: number;
  createdAt: string;
  events: string[];
  actions: unknown[];
}): DecisionSummary {
  return {
    id: d.id,
    at: d.createdAt,
    event: firstLine(d.events[0] ?? ""),
    moreEvents: Math.max(0, d.events.length - 1),
    directives: d.actions
      .map(toDirective)
      .filter((x): x is Directive => x !== undefined),
  };
}

function titleOf(target: Target, m: MonitorSnapshot): string | null {
  if (target.kind === "issue") {
    return (
      m.github?.issues.find((i) => i.number === target.number)?.title ?? null
    );
  }
  if (target.kind === "pr") {
    return (
      m.github?.pullRequests.find((p) => p.number === target.number)?.title ??
      null
    );
  }
  return null;
}

function basename(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? path
  );
}

export function buildDashboard(s: AdminSources): DashboardData {
  const m = s.monitor();
  const e = s.executor();
  const questions = s.store.questions();
  const runs = new Map(s.store.runningRuns().map((r) => [r.id, r]));
  const links = requirementLinks(s.store);

  return {
    awaitingReply: questions
      .filter((q) => !q.answered)
      .map((q) => ({
        threadId: q.threadId,
        title: q.title,
        origin: q.origin,
        target: q.target,
        createdAt: q.createdAt,
        excerpt: firstLine(q.body).slice(0, EXCERPT),
        url: s.threadUrl(q.threadId) ?? null,
      })),
    awaitingMerge: awaitingMerge(m).map((pr) => ({
      number: pr.number,
      title: pr.title,
      stage: pr.stage,
      url: pr.url,
      updatedAt: pr.updatedAt,
    })),
    notices: notices(m, e),
    agents: e.agents.map((a) => {
      const run = runs.get(a.runId);
      return {
        runId: a.runId,
        role: a.role,
        target: a.target,
        targetTitle: titleOf(a.target, m),
        startedAt: run?.startedAt ?? s.clock.now().toISOString(),
        instruction: run?.instruction ?? "",
        worktree: a.cwd === null ? null : basename(a.cwd),
      };
    }),
    requirements: s.store.requirements("open").map((r) => {
      const key = targetKey({ kind: "requirement", id: r.id });
      const l = links.get(r.id);
      return {
        id: r.id,
        content: r.content,
        author: r.author,
        createdAt: r.createdAt,
        questions: questions.filter(
          (q) => q.target !== null && targetKey(q.target) === key,
        ).length,
        issues: l?.issues.size ?? 0,
        pullRequests: l?.pullRequests.size ?? 0,
      };
    }),
    decisions: s.store
      .recentDecisions(RECENT_DECISIONS)
      .reverse()
      .map(summarizeDecision),
  };
}
