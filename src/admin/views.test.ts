import { describe, expect, it } from "vitest";
import type { SituationPullRequest } from "../dispatcher/dispatcher.js";
import { reviewState } from "../domain/review.js";
import { emptyKnowledge } from "../knowledge/knowledge.js";
import { SqliteStore } from "../store/store.js";
import { testConfig } from "../testing/fixtures.js";
import type { MonitorSnapshot } from "./dashboard.js";
import { adminRoutes } from "./routes.js";
import { NOT_FOUND } from "./server.js";
import type {
  ActivityData,
  ProductData,
  PullRequestDetail,
  PullRequestList,
  QuestionItem,
  SystemData,
} from "./types.js";
import { mergeBlockers, type ViewSources } from "./views.js";

function openPr(
  store: SqliteStore,
  extra: Partial<SituationPullRequest> = {},
): SituationPullRequest {
  const number = extra.number ?? 21;
  const headSha = extra.headSha ?? "head2";
  return {
    number,
    title: "feat: カードモードを追加する",
    body: "Closes #20",
    author: "bot",
    branch: "tasuki/issue-20-flashcards",
    base: "main",
    state: "open",
    draft: false,
    headSha,
    updatedAt: "2026-11-23T08:50:00Z",
    ci: "pending",
    failedChecks: [],
    mergeable: "mergeable",
    files: ["src/app/flashcards/page.tsx"],
    url: `https://github.com/owner/name/pull/${String(number)}`,
    stage: "implementation",
    merge: "human",
    review: reviewState(headSha, store.reviews(number), store.findings(number)),
    ...extra,
  };
}

function setup(extraYaml = "") {
  let t = Date.parse("2026-11-23T08:00:00Z");
  const store = new SqliteStore(":memory:", {
    now: () => new Date((t += 60_000)),
  });
  const state: { github: MonitorSnapshot["github"] } = { github: null };
  const knowledge = emptyKnowledge();
  const sources: ViewSources = {
    repo: "owner/name",
    version: "0.1.0",
    store,
    monitor: () => ({
      lastCheckAt: null,
      nextCheckAt: null,
      dispatching: false,
      stopped: false,
      dispatcherFailures: 0,
      lastDispatchError: null,
      github: state.github,
    }),
    executor: () => ({
      agents: [],
      limitUntil: "2026-11-23T09:30:00.000Z",
      dirtyWorktrees: [],
    }),
    threadUrl: (id) => `https://discord.test/${id}`,
    clock: { now: () => new Date("2026-11-23T09:00:00Z") },
    config: testConfig(extraYaml),
    knowledge: () => ({
      commit: "a41c9e2",
      loadedAt: "2026-11-23T08:52:00.000Z",
      knowledge,
    }),
    worktrees: () =>
      Promise.resolve([
        {
          name: "issue-20",
          cwd: "/w/issue-20",
          branch: "tasuki/issue-20",
          dirty: true,
        },
        { name: "read-repo", cwd: "/w/read-repo", branch: null, dirty: false },
        { name: "memo", cwd: "/w/memo", branch: null, dirty: false },
      ]),
    system: {
      startedAt: "2026-11-23T00:00:12.000Z",
      pid: 48213,
      paths: {
        state: "/s/o__n.db",
        worktrees: "/no/such/worktrees",
        repo: "/repo",
      },
      shell: { name: "bash", path: "C:\\Git\\bin\\bash.exe", warning: null },
      adminUrl: () => "http://127.0.0.1:4680/",
      logs: () => ["[09:00:00] 監視を始めます"],
    },
  };
  const get = <T>(path: string) => adminRoutes(sources)(path) as T;
  return { store, sources, state, knowledge, get };
}

/** レビュー 1 回（指摘 3 件）と、その後の修正・コメントのある PR #21 を用意する */
function prWithReview(s: ReturnType<typeof setup>) {
  const { store } = s;
  const reviewRun = store.startRun({
    role: "reviewer",
    target: { kind: "pr", number: 21 },
    instruction: "PR #21 をレビューする",
  });
  store.finishRun(reviewRun, "done", "1 点、直す必要がある");
  store.addReview({
    pr: 21,
    sha: "head1",
    verdict: "request_changes",
    runId: reviewRun,
    findings: [
      {
        severity: "major",
        file: "e2e/flashcards.spec.ts",
        line: 40,
        problem: "テストが不安定",
        suggestion: "先にカードを消す",
      },
      {
        severity: "minor",
        file: null,
        line: null,
        problem: "名前が短い",
        suggestion: "直す",
      },
      {
        severity: "nit",
        file: null,
        line: null,
        problem: "空行が多い",
        suggestion: "消す",
      },
    ],
    resolutions: [],
  });
  store.applyResponses(21, [
    { number: 2, action: "declined", note: "/quiz に合わせている" },
  ]);
  store.addEvent("pr:21:opened", {
    type: "pr_changed",
    number: 21,
    title: "feat: カードモードを追加する",
    change: "opened",
    stage: "implementation",
    branch: "tasuki/issue-20-flashcards",
  });
  store.addEvent("ci:21:head1:pass", {
    type: "ci_changed",
    number: 21,
    status: "pass",
  });
  store.addEvent("ci:19:x:pass", {
    type: "ci_changed",
    number: 19,
    status: "pass",
  });
  store.addEvent("comment:21:1", {
    type: "pr_comment",
    number: 21,
    author: "human",
    body: "文言を直して",
    path: null,
  });
  store.addDecision({
    events: ["PR #21 のレビューが終わった\n詳細"],
    reasoning: "直す必要がある",
    actions: [
      {
        type: "run_agent",
        role: "programmer",
        target: { kind: "pr", number: 21 },
        instruction: "指摘を直す",
        result: "起動した（実行 2）",
      },
    ],
  });
  store.addDecision({
    events: ["PR #19 の CI が合格した"],
    reasoning: "待つ",
    actions: [{ type: "wait", reason: "人のマージ待ち" }],
  });
  s.state.github = { issues: [], pullRequests: [openPr(store)] };
}

describe("PR とレビュー", () => {
  it("開いている PR と、閉じた PR を分けて返す", () => {
    const s = setup("merge:\n  spec: auto\n");
    prWithReview(s);
    s.store.savePullRequest({
      number: 19,
      title: "docs: 仕様",
      branch: "tasuki/spec",
      stage: "spec",
      state: "merged",
      url: "u19",
      updatedAt: "2026-11-23T08:30:00Z",
    });
    // 記録では開いたままだが、今の一覧に無い PR は出さない
    s.store.savePullRequest({
      number: 18,
      title: "確かめ中",
      branch: "b",
      stage: "implementation",
      state: "open",
      url: "u18",
      updatedAt: "",
    });
    const list = s.get<PullRequestList>("/api/prs");
    expect(list.open).toMatchObject([
      {
        number: 21,
        state: "open",
        ci: "pending",
        conflicting: false,
        merge: "human",
        review: {
          rounds: 1,
          lastVerdict: "request_changes",
          reviewedHead: false,
          open: { blocker: 0, major: 1, minor: 0, nit: 1 },
        },
      },
    ]);
    expect(list.closed).toMatchObject([
      {
        number: 19,
        state: "merged",
        ci: null,
        conflicting: null,
        merge: "auto",
        review: null,
      },
    ]);
  });

  it("詳細: マージできない理由・レビューの回・指摘・経過を返す", () => {
    const s = setup();
    prWithReview(s);
    const d = s.get<PullRequestDetail>("/api/prs/21");
    expect(d.blockers).toEqual([
      { kind: "ci_pending" },
      { kind: "review_changes", round: 1 },
      { kind: "review_stale", sha: "head1" },
    ]);
    expect(d.reviews).toEqual([
      {
        round: 1,
        sha: "head1",
        verdict: "request_changes",
        at: expect.any(String) as string,
        summary: "1 点、直す必要がある",
        findings: { blocker: 0, major: 1, minor: 1, nit: 1 },
      },
    ]);
    expect(d.findings.map((f) => [f.number, f.severity, f.status])).toEqual([
      [1, "major", "open"],
      [2, "minor", "declined"],
      [3, "nit", "open"],
    ]);
    // この PR についてのものだけを、新しい順に並べる（PR #19 のものは入らない）
    expect(d.timeline.map((x) => x.kind)).toEqual([
      "decision",
      "event",
      "event",
      "event",
      "run",
    ]);
    expect(d.timeline[0]).toMatchObject({
      kind: "decision",
      events: ["PR #21 のレビューが終わった"],
      directives: [{ type: "run_agent", role: "programmer", outcome: "done" }],
    });
    expect(d.timeline[1]).toMatchObject({ type: "pr_comment", handled: false });
    expect(d.timeline.at(-1)).toMatchObject({
      kind: "run",
      role: "reviewer",
      status: "done",
      instruction: "PR #21 をレビューする",
    });
  });

  it("閉じた PR の詳細は記録から返し、知らない PR は無い", () => {
    const s = setup();
    s.store.savePullRequest({
      number: 19,
      title: "docs: 仕様",
      branch: "tasuki/spec",
      stage: "spec",
      state: "merged",
      url: "u19",
      updatedAt: "",
    });
    const d = s.get<PullRequestDetail>("/api/prs/19");
    expect(d.pr).toMatchObject({ number: 19, state: "merged" });
    expect(d.blockers).toEqual([]);
    expect(s.get("/api/prs/999")).toBe(NOT_FOUND);
    expect(s.get("/api/prs/abc")).toBe(NOT_FOUND);
    expect(s.get("/api/unknown")).toBe(NOT_FOUND);
  });
});

describe("mergeBlockers", () => {
  it("理由が無ければ空。CI・衝突・下書きは、当たるものをすべて挙げる", () => {
    const { store } = setup();
    expect(mergeBlockers(openPr(store, { ci: "pass" }), store, true)).toEqual(
      [],
    );
    expect(
      mergeBlockers(
        openPr(store, {
          ci: "fail",
          failedChecks: ["e2e"],
          mergeable: "conflicting",
          draft: true,
        }),
        store,
        true,
      ),
    ).toEqual([
      { kind: "draft" },
      { kind: "conflict" },
      { kind: "ci_fail", checks: ["e2e"] },
    ]);
    expect(mergeBlockers(openPr(store, { ci: "none" }), store, true)).toEqual([
      { kind: "ci_none" },
    ]);
    expect(mergeBlockers(openPr(store, { ci: "none" }), store, false)).toEqual(
      [],
    );
  });
});

describe("活動の履歴", () => {
  it("判断・実行・出来事を、新しい順に返す", () => {
    const s = setup();
    prWithReview(s);
    const a = s.get<ActivityData>("/api/activity");
    expect(a.decisions.map((d) => d.reasoning)).toEqual([
      "待つ",
      "直す必要がある",
    ]);
    expect(a.decisions[0]!.directives[0]).toMatchObject({
      type: "wait",
      detail: "人のマージ待ち",
    });
    expect(a.runs).toMatchObject([
      { runId: 1, role: "reviewer", status: "done" },
    ]);
    expect(a.events.map((e) => e.type)).toEqual([
      "pr_comment",
      "ci_changed",
      "ci_changed",
      "pr_changed",
    ]);
    expect(a.events[0]!.text).toContain("文言を直して");
  });
});

describe("質問", () => {
  it("返信待ちを上に、その中では新しい順に返す", () => {
    const s = setup();
    for (const [id, origin] of [
      ["t1", "spec-master"],
      ["t2", "dispatcher"],
      ["t3", "programmer"],
    ] as const) {
      s.store.addQuestion({
        threadId: id,
        title: `質問 ${id}`,
        body: "1. どちらにしますか",
        target: null,
        origin,
      });
    }
    s.store.setQuestionRead("t3", "9", true);
    const list = s.get<QuestionItem[]>("/api/questions");
    expect(list.map((q) => [q.threadId, q.answered])).toEqual([
      ["t2", false],
      ["t1", false],
      ["t3", true],
    ]);
    expect(list[0]).toMatchObject({
      origin: "dispatcher",
      body: "1. どちらにしますか",
      url: "https://discord.test/t2",
    });
  });
});

describe("プロダクトの情報", () => {
  it("種類ごとに、置き場・渡す先の役・読み込んだ文書を返す", () => {
    const s = setup();
    s.knowledge.merge_rules.push({
      path: "docs/rules/merge.md",
      content: "CI 合格",
    });
    const p = s.get<ProductData>("/api/product");
    expect(p.commit).toBe("a41c9e2");
    expect(p.kinds).toHaveLength(9);
    expect(p.kinds[0]).toEqual({
      kind: "context",
      paths: ["docs/CONTEXT.md"],
      roles: [
        "dispatcher",
        "spec-master",
        "planner",
        "designer",
        "programmer",
        "reviewer",
      ],
      docs: [],
    });
    expect(p.kinds.find((k) => k.kind === "merge_rules")).toEqual({
      kind: "merge_rules",
      paths: ["docs/rules/merge.md"],
      roles: ["dispatcher"],
      docs: [{ path: "docs/rules/merge.md", content: "CI 合格" }],
    });
    expect(p.kinds.find((k) => k.kind === "commit_rules")!.roles).toEqual([
      "spec-master",
      "designer",
      "programmer",
    ]);
  });

  it("まだ読み込んでいなければ、コミットは無く、文書は空", () => {
    const s = setup();
    s.sources.knowledge = () => undefined;
    const p = s.get<ProductData>("/api/product");
    expect(p).toMatchObject({ commit: null, loadedAt: null });
    expect(p.kinds.every((k) => k.docs.length === 0)).toBe(true);
  });
});

describe("システム", () => {
  it("版・置き場・シェル・利用上限・作業フォルダ・ログを返す", async () => {
    const s = setup();
    const sys = await s.get<Promise<SystemData>>("/api/system");
    expect(sys).toMatchObject({
      version: "0.1.0",
      pid: 48213,
      shell: { name: "bash" },
      limitUntil: "2026-11-23T09:30:00.000Z",
      adminUrl: "http://127.0.0.1:4680/",
      logs: ["[09:00:00] 監視を始めます"],
    });
    expect(sys.worktrees).toEqual([
      {
        name: "issue-20",
        target: { kind: "issue", number: 20 },
        branch: "tasuki/issue-20",
        dirty: true,
        setupDone: null,
      },
      {
        name: "read-repo",
        target: { kind: "repo" },
        branch: null,
        dirty: false,
        setupDone: null,
      },
      {
        name: "memo",
        target: null,
        branch: null,
        dirty: false,
        setupDone: null,
      },
    ]);
  });

  it("準備コマンドの設定があれば、実行済みかどうかを返す", async () => {
    const s = setup("workspace:\n  setup:\n    - npm ci\n");
    const sys = await s.get<Promise<SystemData>>("/api/system");
    expect(sys.worktrees[0]!.setupDone).toBe(false);
  });
});
