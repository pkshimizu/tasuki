/**
 * 管理画面の、詳しく確かめる画面の内容を組み立てる
 * （PR とレビュー・活動の履歴・質問・プロダクトの情報・システム）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseEntryName, type WorkspaceEntry } from "../agents/workspace.js";
import { type Config, ROLES } from "../config/config.js";
import {
  describeEvent,
  type SituationPullRequest,
} from "../dispatcher/dispatcher.js";
import {
  countOpen,
  reviewState,
  SEVERITIES,
  type Severity,
} from "../domain/review.js";
import { type EventPayload, type Target, targetKey } from "../domain/types.js";
import {
  KNOWLEDGE_KINDS,
  type LoadedKnowledge,
  ROLE_KINDS,
} from "../knowledge/knowledge.js";
import type {
  Decision,
  Run,
  Store,
  StoredPullRequest,
} from "../store/store.js";
import {
  type AdminSources,
  type MonitorSnapshot,
  toDirective,
} from "./dashboard.js";
import type { SettingsSources } from "./settings.js";
import type {
  ActivityData,
  Directive,
  MergeBlocker,
  ProductData,
  PullRequestDetail,
  PullRequestList,
  PullRequestRow,
  QuestionItem,
  ReviewRound,
  SystemData,
  TimelineItem,
} from "./types.js";

/** 詳しい画面のための、追加の取り出し口 */
export interface ViewSources extends AdminSources {
  config: Config;
  knowledge: () => LoadedKnowledge | undefined;
  worktrees: () => Promise<WorkspaceEntry[]>;
  /** 設定の画面のための取り出し口 */
  settings: SettingsSources;
  system: {
    startedAt: string;
    pid: number;
    paths: SystemData["paths"];
    shell: SystemData["shell"];
    adminUrl: () => string | null;
    logs: () => string[];
  };
}

const CLOSED_LIMIT = 50;
const ACTIVITY_LIMIT = 100;
const TIMELINE_EVENTS = 500;
const TIMELINE_RUNS = 200;

// ---------- PR とレビュー

function openRow(pr: SituationPullRequest): PullRequestRow {
  return {
    number: pr.number,
    title: pr.title,
    stage: pr.stage,
    branch: pr.branch,
    state: "open",
    url: pr.url,
    updatedAt: pr.updatedAt,
    ci: pr.ci,
    failedChecks: pr.failedChecks,
    conflicting:
      pr.mergeable === "unknown" ? null : pr.mergeable === "conflicting",
    merge: pr.merge,
    review: pr.review,
  };
}

function storedRow(pr: StoredPullRequest, s: ViewSources): PullRequestRow {
  return {
    number: pr.number,
    title: pr.title,
    stage: pr.stage,
    branch: pr.branch,
    state: pr.state,
    url: pr.url,
    updatedAt: pr.updatedAt,
    ci: null,
    failedChecks: [],
    conflicting: null,
    merge: s.config.merge[pr.stage],
    // 閉じた PR では、今の先頭が分からないので、最後にレビューしたコミットを先頭として扱う
    review: reviewState(
      s.store.reviews(pr.number).at(-1)?.sha ?? "",
      s.store.reviews(pr.number),
      s.store.findings(pr.number),
    ),
  };
}

export function buildPullRequests(s: ViewSources): PullRequestList {
  const open = s.monitor().github?.pullRequests ?? [];
  const openNumbers = new Set(open.map((p) => p.number));
  return {
    open: open.map(openRow).sort((a, b) => b.number - a.number),
    closed: s.store
      .pullRequests()
      // 記録では開いたままでも、今の一覧に無ければ出さない（閉じたことをまだ確かめていない）
      .filter((p) => p.state !== "open" && !openNumbers.has(p.number))
      .slice(0, CLOSED_LIMIT)
      .map((p) => storedRow(p, s)),
  };
}

/** マージできない理由をすべて挙げる */
export function mergeBlockers(
  pr: SituationPullRequest,
  store: Store,
  requireCi: boolean,
): MergeBlocker[] {
  const blockers: MergeBlocker[] = [];
  if (pr.draft) blockers.push({ kind: "draft" });
  if (pr.mergeable === "conflicting") blockers.push({ kind: "conflict" });
  if (pr.ci === "pending") blockers.push({ kind: "ci_pending" });
  if (pr.ci === "fail") {
    blockers.push({ kind: "ci_fail", checks: pr.failedChecks });
  }
  if (pr.ci === "none" && requireCi) blockers.push({ kind: "ci_none" });
  const last = store.reviews(pr.number).at(-1);
  if (last) {
    if (last.verdict !== "approve") {
      blockers.push({ kind: "review_changes", round: last.round });
    }
    if (last.sha !== pr.headSha) {
      blockers.push({ kind: "review_stale", sha: last.sha });
    }
  }
  return blockers;
}

function reviewRounds(number: number, store: Store): ReviewRound[] {
  const findings = store.findings(number);
  return store.reviews(number).map((r) => {
    const counts: Record<Severity, number> = {
      blocker: 0,
      major: 0,
      minor: 0,
      nit: 0,
    };
    for (const f of findings) {
      if (f.round === r.round) counts[f.severity]++;
    }
    return {
      round: r.round,
      sha: r.sha,
      verdict: r.verdict,
      at: r.createdAt,
      summary: store.run(r.runId)?.summary ?? "",
      findings: counts,
    };
  });
}

// ---------- 経過（出来事・判断・実行）

export function runItem(run: Run): Extract<TimelineItem, { kind: "run" }> {
  return {
    kind: "run",
    id: `run:${String(run.id)}`,
    runId: run.id,
    at: run.startedAt,
    role: run.role,
    target: run.target,
    status: run.status,
    finishedAt: run.finishedAt,
    instruction: run.instruction,
    summary: run.summary ?? "",
  };
}

export function decisionItem(
  d: Decision,
): Extract<TimelineItem, { kind: "decision" }> {
  return {
    kind: "decision",
    id: `decision:${String(d.id)}`,
    at: d.createdAt,
    events: d.events.map((e) => e.split("\n")[0] ?? ""),
    reasoning: d.reasoning,
    directives: d.actions
      .map(toDirective)
      .filter((x): x is Directive => x !== undefined),
  };
}

export function eventItem(e: {
  id: number;
  payload: EventPayload;
  createdAt: string;
  handled: boolean;
}): Extract<TimelineItem, { kind: "event" }> {
  return {
    kind: "event",
    id: `event:${String(e.id)}`,
    at: e.createdAt,
    type: e.payload.type,
    text: describeEvent(e.payload),
    handled: e.handled,
  };
}

/** 出来事が、その PR についてのものか */
export function eventIsAboutPr(p: EventPayload, number: number): boolean {
  switch (p.type) {
    case "pr_changed":
    case "ci_changed":
    case "pr_comment":
    case "merge_refused":
      return p.number === number;
    default:
      return false;
  }
}

export function directiveIsAboutPr(d: Directive, number: number): boolean {
  return (
    (d.type === "merge_pr" && d.number === number) ||
    (d.target?.kind === "pr" && d.target.number === number)
  );
}

export function byTimeDesc(a: TimelineItem, b: TimelineItem): number {
  return b.at.localeCompare(a.at) || b.id.localeCompare(a.id);
}

/** PR についての出来事・判断・実行を、新しい順に並べる */
function prTimeline(number: number, store: Store): TimelineItem[] {
  const key = targetKey({ kind: "pr", number });
  const items: TimelineItem[] = [
    ...store
      .recentEvents(TIMELINE_EVENTS)
      .filter((e) => eventIsAboutPr(e.payload, number))
      .map(eventItem),
    ...store
      .recentRuns(TIMELINE_RUNS)
      .filter((r) => targetKey(r.target) === key)
      .map(runItem),
    ...store
      .recentDecisions(TIMELINE_RUNS)
      .map(decisionItem)
      .filter((d) => d.directives.some((x) => directiveIsAboutPr(x, number))),
  ];
  return items.sort(byTimeDesc);
}

export function buildPullRequest(
  s: ViewSources,
  number: number,
): PullRequestDetail | undefined {
  const open = s
    .monitor()
    .github?.pullRequests.find((p) => p.number === number);
  const stored = s.store.pullRequests().find((p) => p.number === number);
  if (!open && !stored) return undefined;
  return {
    pr: open ? openRow(open) : storedRow(stored!, s),
    blockers: open
      ? mergeBlockers(open, s.store, s.config.merge.require_ci)
      : [],
    reviews: reviewRounds(number, s.store),
    findings: s.store.findings(number),
    timeline: prTimeline(number, s.store),
  };
}

// ---------- 活動の履歴

export function buildActivity(s: ViewSources): ActivityData {
  return {
    decisions: s.store
      .recentDecisions(ACTIVITY_LIMIT)
      .reverse()
      .map(decisionItem),
    runs: s.store.recentRuns(ACTIVITY_LIMIT).reverse().map(runItem),
    events: s.store.recentEvents(ACTIVITY_LIMIT).map(eventItem),
  };
}

// ---------- 質問

export function buildQuestions(s: ViewSources): QuestionItem[] {
  return s.store
    .questions()
    .map((q) => ({
      threadId: q.threadId,
      title: q.title,
      body: q.body,
      origin: q.origin,
      target: q.target,
      answered: q.answered,
      createdAt: q.createdAt,
      url: s.threadUrl(q.threadId) ?? null,
    }))
    .sort(
      (a, b) =>
        // 返信待ちを上に、その中では新しい順
        Number(a.answered) - Number(b.answered) ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

// ---------- プロダクトの情報

export function buildProduct(s: ViewSources): ProductData {
  const loaded = s.knowledge();
  return {
    commit: loaded?.commit ?? null,
    loadedAt: loaded?.loadedAt ?? null,
    kinds: KNOWLEDGE_KINDS.map((kind) => ({
      kind,
      paths: s.config.knowledge[kind],
      roles: ROLES.filter((role) => ROLE_KINDS[role].includes(kind)),
      docs: loaded?.knowledge[kind] ?? [],
    })),
  };
}

// ---------- システム

function targetOf(name: string): Target | null {
  return parseEntryName(name)?.target ?? null;
}

export async function buildSystem(s: ViewSources): Promise<SystemData> {
  const hasSetup = s.config.workspace.setup.length > 0;
  const entries = await s.worktrees();
  return {
    version: s.version,
    startedAt: s.system.startedAt,
    pid: s.system.pid,
    paths: s.system.paths,
    shell: s.system.shell,
    limitUntil: s.executor().limitUntil,
    adminUrl: s.system.adminUrl(),
    worktrees: entries.map((e) => ({
      name: e.name,
      target: targetOf(e.name),
      branch: e.branch,
      dirty: e.dirty,
      setupDone: hasSetup
        ? existsSync(join(s.system.paths.worktrees, ".setup", `${e.name}.txt`))
        : null,
    })),
    logs: s.system.logs(),
  };
}

/** 片付いていない指摘の数（一覧で使う）。重要度の順に、0 でないものだけ */
export function openFindingCounts(
  number: number,
  store: Store,
): { severity: Severity; count: number }[] {
  const counts = countOpen(store.findings(number));
  return SEVERITIES.filter((sev) => counts[sev] > 0).map((sev) => ({
    severity: sev,
    count: counts[sev],
  }));
}

export type { MonitorSnapshot };
