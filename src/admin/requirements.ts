/**
 * 管理画面の、要件の画面の内容を組み立てる。
 *
 * 要件と、Issue・PR・質問との結びつきは、エージェントの実行の記録から引く
 * （司令塔が、エージェントを起動するときに、どの要件のためかを添える）。
 */
import { type Target, targetKey } from "../domain/types.js";
import type { Question, Requirement, Run, Store } from "../store/store.js";
import type {
  Directive,
  RelatedItem,
  RequirementDetail,
  RequirementRow,
  TimelineItem,
} from "./types.js";
import {
  byTimeDesc,
  decisionItem,
  directiveIsAboutPr,
  eventIsAboutPr,
  eventItem,
  runItem,
  type ViewSources,
} from "./views.js";

/** 結びつきを引くときに、さかのぼる件数 */
const LINK_RUNS = 2000;
const LINK_EVENTS = 5000;
const LINK_DECISIONS = 2000;

/** 要件に結びつくもの */
export interface RequirementLinks {
  runs: Run[];
  issues: Set<number>;
  pullRequests: Set<number>;
  questions: Question[];
}

/** 実行が、どの要件のためのものか。対象が要件そのものなら、その要件 */
export function requirementOfRun(run: Run): string | null {
  return (
    run.requirement ??
    (run.target.kind === "requirement" ? run.target.id : null)
  );
}

type StoredEvent = ReturnType<Store["recentEvents"]>[number];

/** すべての要件について、結びつくものを引く */
export function requirementLinks(
  store: Store,
  events: StoredEvent[] = store.recentEvents(LINK_EVENTS),
): Map<string, RequirementLinks> {
  const links = new Map<string, RequirementLinks>();
  const of = (id: string): RequirementLinks => {
    let l = links.get(id);
    if (!l) {
      l = {
        runs: [],
        issues: new Set(),
        pullRequests: new Set(),
        questions: [],
      };
      links.set(id, l);
    }
    return l;
  };
  for (const r of store.requirements()) of(r.id);

  const requirementByRun = new Map<number, string>();
  // 古い順に並べる
  for (const run of store.recentRuns(LINK_RUNS).reverse()) {
    const id = requirementOfRun(run);
    if (id === null) continue;
    const l = of(id);
    l.runs.push(run);
    requirementByRun.set(run.id, id);
    if (run.target.kind === "issue") l.issues.add(run.target.number);
    if (run.target.kind === "pr") l.pullRequests.add(run.target.number);
  }
  // エージェントが作った PR
  for (const e of events) {
    const p = e.payload;
    if (p.type !== "agent_finished" || p.pr === null) continue;
    const id = requirementByRun.get(p.runId);
    if (id !== undefined) of(id).pullRequests.add(p.pr);
  }
  // 要件そのもの・結びつく Issue・PR についての質問
  const byTarget = new Map<string, string>();
  for (const [id, l] of links) {
    byTarget.set(targetKey({ kind: "requirement", id }), id);
    for (const n of l.issues) {
      byTarget.set(targetKey({ kind: "issue", number: n }), id);
    }
    for (const n of l.pullRequests) {
      byTarget.set(targetKey({ kind: "pr", number: n }), id);
    }
  }
  for (const q of store.questions()) {
    if (q.target === null) continue;
    const id = byTarget.get(targetKey(q.target));
    if (id !== undefined) of(id).questions.push(q);
  }
  return links;
}

function row(
  r: Requirement,
  l: RequirementLinks | undefined,
  s: ViewSources,
): RequirementRow {
  return {
    id: r.id,
    content: r.content,
    author: r.author,
    status: r.status,
    createdAt: r.createdAt,
    url: s.requirementUrl(r.id) ?? null,
    counts: {
      questions: l?.questions.length ?? 0,
      waiting: l?.questions.filter((q) => !q.answered).length ?? 0,
      issues: l?.issues.size ?? 0,
      pullRequests: l?.pullRequests.size ?? 0,
    },
  };
}

/** 要件の一覧。新しい順 */
export function buildRequirements(s: ViewSources): RequirementRow[] {
  const links = requirementLinks(s.store);
  return s.store
    .requirements()
    .map((r) => row(r, links.get(r.id), s))
    .reverse();
}

function related(
  l: RequirementLinks,
  events: StoredEvent[],
  s: ViewSources,
): RelatedItem[] {
  const github = s.monitor().github;
  const items: RelatedItem[] = [];

  for (const q of l.questions) {
    items.push({
      kind: "question",
      id: `question:${q.threadId}`,
      title: q.title,
      origin: q.origin,
      done: q.answered,
      at: q.createdAt,
      url: s.threadUrl(q.threadId) ?? null,
    });
  }

  for (const number of l.issues) {
    const open = github?.issues.find((i) => i.number === number);
    // 新しい順に並んでいるので、最初に見つかったものが最後の様子
    const last = events.find(
      (e) => e.payload.type === "issue_changed" && e.payload.number === number,
    );
    const p = last?.payload.type === "issue_changed" ? last.payload : undefined;
    const state = open
      ? "open"
      : p?.change === "closed"
        ? "closed"
        : // 開いている Issue の一覧に無ければ、閉じている
          github
          ? "closed"
          : null;
    items.push({
      kind: "issue",
      id: `issue:${String(number)}`,
      number,
      title: open?.title ?? p?.title ?? null,
      state,
      done: state === "closed",
      at: open?.updatedAt ?? last?.createdAt ?? null,
      url: `https://github.com/${s.repo}/issues/${String(number)}`,
    });
  }

  const stored = new Map(s.store.pullRequests().map((p) => [p.number, p]));
  for (const number of l.pullRequests) {
    const open = github?.pullRequests.find((p) => p.number === number);
    const pr = open ?? stored.get(number);
    const state = open ? "open" : (stored.get(number)?.state ?? null);
    items.push({
      kind: "pr",
      id: `pr:${String(number)}`,
      number,
      title: pr?.title ?? null,
      stage: pr?.stage ?? null,
      state,
      done: state === "merged" || state === "closed",
      at: pr?.updatedAt ?? null,
      url: `https://github.com/${s.repo}/pull/${String(number)}`,
    });
  }

  // 新しい順。時刻の分からないものは最後
  // GitHub の時刻と記録の時刻は書き方が違うので、時刻にして比べる
  const time = (x: RelatedItem) => (x.at === null ? 0 : Date.parse(x.at));
  return items.sort((a, b) => time(b) - time(a));
}

function timeline(
  id: string,
  l: RequirementLinks,
  events: StoredEvent[],
  store: Store,
): TimelineItem[] {
  const threads = new Set(l.questions.map((q) => q.threadId));
  const aboutTarget = (t: Target | null): boolean =>
    t !== null &&
    ((t.kind === "requirement" && t.id === id) ||
      (t.kind === "issue" && l.issues.has(t.number)) ||
      (t.kind === "pr" && l.pullRequests.has(t.number)));
  const aboutDirective = (d: Directive): boolean =>
    d.requirement === id ||
    aboutTarget(d.target) ||
    [...l.pullRequests].some((n) => directiveIsAboutPr(d, n));

  const items: TimelineItem[] = [
    ...events
      .filter((e) => {
        const p = e.payload;
        switch (p.type) {
          case "requirement_posted":
            return p.requirementId === id;
          case "question_answered":
            return threads.has(p.threadId);
          case "agent_finished":
            // 実行の項目に、結果の要約がある
            return false;
          case "issue_changed":
            return l.issues.has(p.number);
          default:
            return [...l.pullRequests].some((n) => eventIsAboutPr(p, n));
        }
      })
      .map(eventItem),
    ...l.runs.map(runItem),
    ...store
      .recentDecisions(LINK_DECISIONS)
      .map(decisionItem)
      .filter((d) => d.directives.some(aboutDirective)),
  ];
  return items.sort(byTimeDesc);
}

export function buildRequirement(
  s: ViewSources,
  id: string,
): RequirementDetail | undefined {
  const requirement = s.store.requirements().find((r) => r.id === id);
  if (!requirement) return undefined;
  const events = s.store.recentEvents(LINK_EVENTS);
  const l = requirementLinks(s.store, events).get(id);
  if (!l) return undefined;
  return {
    requirement: row(requirement, l, s),
    related: related(l, events, s),
    timeline: timeline(id, l, events, s.store),
  };
}
