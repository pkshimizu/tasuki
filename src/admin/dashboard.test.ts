import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SituationPullRequest } from "../dispatcher/dispatcher.js";
import { SqliteStore } from "../store/store.js";
import {
  type AdminSources,
  buildApp,
  buildDashboard,
  type ExecutorSnapshot,
  type MonitorSnapshot,
  summarizeDecision,
  toDirective,
} from "./dashboard.js";

const NOW = "2026-11-23T09:00:00.000Z";

function pr(extra: Partial<SituationPullRequest> = {}): SituationPullRequest {
  return {
    number: 19,
    title: "docs: カードモードの仕様を追加する",
    body: "",
    author: "bot",
    branch: "tasuki/spec-flashcards",
    base: "main",
    state: "open",
    draft: false,
    headSha: "sha1",
    updatedAt: "2026-11-23T08:52:00Z",
    ci: "pass",
    failedChecks: [],
    mergeable: "mergeable",
    files: ["docs/specs/flashcards.md"],
    url: "https://github.com/owner/name/pull/19",
    stage: "spec",
    merge: "human",
    review: {
      rounds: 2,
      lastVerdict: "approve",
      reviewedHead: true,
      open: { blocker: 0, major: 0, minor: 0, nit: 0 },
    },
    ...extra,
  };
}

function setup(
  monitor: Partial<MonitorSnapshot> = {},
  executor: Partial<ExecutorSnapshot> = {},
) {
  let t = Date.parse("2026-11-23T08:00:00Z");
  const store = new SqliteStore(":memory:", {
    now: () => new Date((t += 60_000)),
  });
  const sources: AdminSources = {
    repo: "owner/name",
    version: "0.1.0",
    store,
    monitor: () => ({
      lastCheckAt: "2026-11-23T08:59:00.000Z",
      nextCheckAt: "2026-11-23T09:00:00.000Z",
      dispatching: false,
      stopped: false,
      dispatcherFailures: 0,
      lastDispatchError: null,
      github: null,
      ...monitor,
    }),
    executor: () => ({
      agents: [],
      limitUntil: null,
      dirtyWorktrees: [],
      ...executor,
    }),
    threadUrl: (id) => (id === "t1" ? "https://discord.test/t1" : undefined),
    clock: { now: () => new Date(NOW) },
  };
  return { store, sources };
}

describe("buildApp", () => {
  it("待っているだけなら待機中", () => {
    const { sources } = setup();
    expect(buildApp(sources)).toEqual({
      repo: "owner/name",
      version: "0.1.0",
      status: "idle",
      limitUntil: null,
      lastCheckAt: "2026-11-23T08:59:00.000Z",
      nextCheckAt: "2026-11-23T09:00:00.000Z",
      needsAction: { questions: 0, pullRequests: 0, notices: 0 },
    });
  });

  it("エージェントか司令塔が動いていれば動作中", () => {
    expect(buildApp(setup({ dispatching: true }).sources).status).toBe(
      "running",
    );
    expect(
      buildApp(
        setup(
          {},
          {
            agents: [
              {
                runId: 1,
                role: "programmer",
                target: { kind: "issue", number: 20 },
                cwd: null,
              },
            ],
          },
        ).sources,
      ).status,
    ).toBe("running");
  });

  it("利用上限のときは、再開の時刻を添えて待機中にする", () => {
    const app = buildApp(
      setup({}, { limitUntil: "2026-11-23T09:30:00.000Z" }).sources,
    );
    expect(app.status).toBe("limited");
    expect(app.limitUntil).toBe("2026-11-23T09:30:00.000Z");
  });

  it("止めたあとは停止中で、次の確認は無い", () => {
    const app = buildApp(setup({ stopped: true }).sources);
    expect(app.status).toBe("stopped");
    expect(app.nextCheckAt).toBeNull();
  });

  it("人の番のものを数える", () => {
    const { store, sources } = setup(
      {
        dispatcherFailures: 3,
        lastDispatchError: "落ちた",
        github: {
          issues: [],
          pullRequests: [pr(), pr({ number: 21, ci: "pending" })],
        },
      },
      { dirtyWorktrees: ["issue-9"] },
    );
    store.addQuestion({
      threadId: "t1",
      title: "q",
      body: "b",
      target: null,
      origin: "dispatcher",
    });
    store.addQuestion({
      threadId: "t2",
      title: "q",
      body: "b",
      target: null,
      origin: null,
    });
    store.setQuestionRead("t2", "9", true);
    expect(buildApp(sources).needsAction).toEqual({
      questions: 1,
      pullRequests: 1,
      notices: 2,
    });
  });
});

describe("buildDashboard", () => {
  it("返信待ちの質問を、出どころ・対象・冒頭・スレッドの URL つきで返す", () => {
    const { store, sources } = setup();
    store.addQuestion({
      threadId: "t1",
      title: "仕様マスターからの質問（要件 10）",
      body: "1. 次のカードへ進むきっかけは？\n\n---\n要約",
      target: { kind: "requirement", id: "10" },
      origin: "spec-master",
    });
    store.addQuestion({
      threadId: "t2",
      title: "答えた質問",
      body: "b",
      target: null,
      origin: null,
    });
    store.setQuestionRead("t2", "9", true);
    expect(buildDashboard(sources).awaitingReply).toEqual([
      {
        threadId: "t1",
        title: "仕様マスターからの質問（要件 10）",
        origin: "spec-master",
        target: { kind: "requirement", id: "10" },
        createdAt: "2026-11-23T08:01:00.000Z",
        excerpt: "1. 次のカードへ進むきっかけは？",
        url: "https://discord.test/t1",
      },
    ]);
  });

  it("マージ待ちは、人がマージする設定で approve 済み・CI 合格・今の先頭をレビュー済みの PR だけ", () => {
    const { sources } = setup({
      github: {
        issues: [],
        pullRequests: [
          pr(),
          pr({ number: 20, merge: "auto" }),
          pr({ number: 21, ci: "pending" }),
          pr({ number: 22, review: null }),
          pr({
            number: 23,
            review: {
              rounds: 1,
              lastVerdict: "request_changes",
              reviewedHead: true,
              open: { blocker: 0, major: 1, minor: 0, nit: 0 },
            },
          }),
          pr({
            number: 24,
            review: {
              rounds: 1,
              lastVerdict: "approve",
              reviewedHead: false,
              open: { blocker: 0, major: 0, minor: 0, nit: 0 },
            },
          }),
          pr({ number: 25, mergeable: "conflicting" }),
          pr({ number: 26, draft: true }),
        ],
      },
    });
    expect(buildDashboard(sources).awaitingMerge).toEqual([
      {
        number: 19,
        title: "docs: カードモードの仕様を追加する",
        stage: "spec",
        url: "https://github.com/owner/name/pull/19",
        updatedAt: "2026-11-23T08:52:00Z",
      },
    ]);
  });

  it("動いているエージェントに、対象のタイトル・指示書・作業フォルダを添える", () => {
    const { store, sources } = setup(
      {
        github: {
          issues: [
            {
              number: 20,
              title: "カードモードを追加する",
              body: "",
              state: "open",
              labels: [],
              updatedAt: "",
              url: "",
            },
          ],
          pullRequests: [pr()],
        },
      },
      {
        agents: [
          {
            runId: 1,
            role: "programmer",
            target: { kind: "issue", number: 20 },
            cwd: "C:\\Users\\u\\.tasuki\\worktrees\\o__n\\issue-20",
          },
          {
            runId: 2,
            role: "reviewer",
            target: { kind: "pr", number: 19 },
            cwd: null,
          },
          {
            runId: 3,
            role: "planner",
            target: { kind: "repo" },
            cwd: "/w/read-repo/",
          },
        ],
      },
    );
    for (const [role, target] of [
      ["programmer", { kind: "issue", number: 20 }],
      ["reviewer", { kind: "pr", number: 19 }],
    ] as const) {
      store.startRun({ role, target, instruction: `${role} の指示書` });
    }
    const agents = buildDashboard(sources).agents;
    expect(agents[0]).toEqual({
      runId: 1,
      role: "programmer",
      target: { kind: "issue", number: 20 },
      targetTitle: "カードモードを追加する",
      startedAt: "2026-11-23T08:01:00.000Z",
      instruction: "programmer の指示書",
      worktree: "issue-20",
    });
    expect(agents[1]).toMatchObject({
      targetTitle: "docs: カードモードの仕様を追加する",
      worktree: null,
    });
    // 記録がまだ無い実行も、今の時刻で出す
    expect(agents[2]).toMatchObject({
      targetTitle: null,
      startedAt: NOW,
      instruction: "",
      worktree: "read-repo",
    });
  });

  it("進行中の要件に、その要件についての質問の数を添える", () => {
    const { store, sources } = setup();
    store.addRequirement({ id: "10", author: "清水", content: "カードモード" });
    store.addRequirement({ id: "11", author: "清水", content: "完了した要件" });
    store.completeRequirement("11");
    store.addQuestion({
      threadId: "t1",
      title: "q",
      body: "b",
      target: { kind: "requirement", id: "10" },
      origin: "spec-master",
    });
    store.addQuestion({
      threadId: "t2",
      title: "q",
      body: "b",
      target: { kind: "issue", number: 10 },
      origin: "programmer",
    });
    expect(buildDashboard(sources).requirements).toEqual([
      {
        id: "10",
        content: "カードモード",
        author: "清水",
        createdAt: "2026-11-23T08:01:00.000Z",
        questions: 1,
      },
    ]);
  });

  it("最近の司令塔の判断を、新しい順に 5 件返す", () => {
    const { store, sources } = setup();
    for (let n = 1; n <= 7; n++) {
      store.addDecision({
        events: [`出来事${String(n)}\n2 行目`, "もう 1 件"],
        reasoning: "理由",
        actions: [{ type: "wait", reason: "CI を待つ" }],
      });
    }
    const decisions = buildDashboard(sources).decisions;
    expect(decisions.map((d) => d.event)).toEqual([
      "出来事7",
      "出来事6",
      "出来事5",
      "出来事4",
      "出来事3",
    ]);
    expect(decisions[0]).toMatchObject({
      moreEvents: 1,
      directives: [{ type: "wait", outcome: "none", detail: "CI を待つ" }],
    });
  });

  it("そのほかの知らせ: 司令塔の失敗が続いている、消せない作業フォルダがある", () => {
    const quiet = buildDashboard(
      setup({ dispatcherFailures: 2, lastDispatchError: "x" }).sources,
    );
    expect(quiet.notices).toEqual([]);
    const loud = buildDashboard(
      setup(
        { dispatcherFailures: 3, lastDispatchError: "応答が読めません" },
        { dirtyWorktrees: ["read-pr-17"] },
      ).sources,
    );
    expect(loud.notices).toEqual([
      { kind: "dispatcher_failing", failures: 3, error: "応答が読めません" },
      { kind: "dirty_worktree", name: "read-pr-17" },
    ]);
  });
});

describe("toDirective", () => {
  it("記録に残した指示と結果を読む", () => {
    expect(
      toDirective({
        type: "run_agent",
        role: "reviewer",
        target: { kind: "pr", number: 19 },
        instruction: "…",
        result: "起動した（実行 2）",
      }),
    ).toEqual({
      type: "run_agent",
      role: "reviewer",
      target: { kind: "pr", number: 19 },
      number: null,
      outcome: "done",
      detail: "起動した（実行 2）",
    });
    expect(
      toDirective({
        type: "merge_pr",
        number: 21,
        result: "見送り: この工程のマージの設定は human です",
      }),
    ).toMatchObject({
      number: 21,
      outcome: "skipped",
      detail: "この工程のマージの設定は human です",
    });
    expect(
      toDirective({ type: "notify", result: "失敗: Discord に接続できません" }),
    ).toMatchObject({ outcome: "failed", detail: "Discord に接続できません" });
  });

  it("読めないものは捨てる", () => {
    expect(toDirective({ type: "unknown" })).toBeUndefined();
    expect(toDirective(null)).toBeUndefined();
    expect(
      summarizeDecision({
        id: 1,
        createdAt: NOW,
        events: [],
        actions: ["x", { type: "wait" }],
      }),
    ).toMatchObject({
      event: "",
      moreEvents: 0,
      directives: [{ type: "wait" }],
    });
  });
});

describe("前の版の記録", () => {
  it("質問の出どころの列が無い記録を開くと、列を足して読める", () => {
    const file = join(mkdtempSync(join(tmpdir(), "tasuki-old-")), "old.db");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE questions (
      thread_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      target TEXT,
      last_read_id TEXT,
      answered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`);
    old
      .prepare(
        "INSERT INTO questions (thread_id, title, body, created_at) VALUES ('t1', '古い質問', 'b', '2026-11-22T00:00:00Z')",
      )
      .run();
    old.close();

    const store = new SqliteStore(file);
    expect(store.questions()).toMatchObject([
      { threadId: "t1", title: "古い質問", origin: null },
    ]);
    store.addQuestion({
      threadId: "t2",
      title: "新しい質問",
      body: "b",
      target: null,
      origin: "planner",
    });
    expect(store.questions()[1]).toMatchObject({ origin: "planner" });
    store.close();
    // もう一度開いても、列を二重に足そうとしない
    new SqliteStore(file).close();
  });
});
