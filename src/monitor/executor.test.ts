import { describe, expect, it } from "vitest";
import type { AgentOutcome } from "../agents/agent.js";
import type { LoadedConfig } from "../config/config.js";
import type { Action } from "../dispatcher/dispatcher.js";
import { Executor } from "./executor.js";
import {
  FakeChat,
  FakeGitHub,
  FakeKnowledge,
  FakeWorkspace,
  ok,
  output,
  ScriptedAgents,
} from "../testing/fakes.js";
import type { WorkerOutput } from "../agents/roles.js";
import { SqliteStore } from "../store/store.js";
import { testConfig } from "../testing/fixtures.js";
import type { EventPayload } from "../domain/types.js";

function setup(extraYaml = "") {
  const chat = new FakeChat();
  const github = new FakeGitHub();
  const store = new SqliteStore(":memory:");
  const agents = new ScriptedAgents();
  const workspace = new FakeWorkspace();
  const logs: string[] = [];
  let now = Date.parse("2026-11-23T00:00:00Z");
  let finished = 0;
  const loaded: LoadedConfig = {
    dir: "/repo",
    config: testConfig(extraYaml),
  };
  const knowledge = new FakeKnowledge();
  knowledge.knowledge.implementation_rules.push({
    path: "docs/rules/implementation.md",
    content: "テストを先に書く",
  });
  const executor = new Executor({
    loaded,
    defaultBranch: "main",
    store,
    chat,
    github,
    runAgent: agents.runAgent,
    workspace,
    knowledge,
    log: (t) => logs.push(t),
    clock: { now: () => new Date(now) },
    onFinish: () => finished++,
  });
  const events = (): EventPayload[] => {
    const pending = store.pendingEvents();
    store.markHandled(pending.map((e) => e.id));
    return pending.map((e) => e.payload);
  };
  return {
    chat,
    github,
    store,
    agents,
    workspace,
    executor,
    logs,
    events,
    advance: (ms: number) => (now += ms),
    finished: () => finished,
  };
}

const runProgrammer = (number: number): Action => ({
  type: "run_agent",
  role: "programmer",
  target: { kind: "issue", number },
  instruction: `Issue #${String(number)} を実装する`,
});

/** 外から終わらせられる実行 */
function deferred() {
  let resolve!: (o: AgentOutcome<WorkerOutput>) => void;
  const promise = new Promise<AgentOutcome<WorkerOutput>>((r) => (resolve = r));
  return { promise, resolve };
}

describe("エージェントの起動", () => {
  it("作業フォルダと決まりを用意して起動し、終わったら出来事にする", async () => {
    const { executor, agents, store, events, finished } = setup();
    agents.worker = () => ok(output({ summary: "PR #5 を作った", pr: 5 }));
    expect(await executor.execute([runProgrammer(3)])).toEqual([
      "起動した（実行 1）",
    ]);
    await executor.idle();

    const run = agents.runs[0]!;
    expect(run.name).toBe("programmer");
    expect(run.guard).toEqual({
      cwd: "/worktrees/issue:3",
      defaultBranch: "main",
      access: "write",
    });
    expect(run.prompt).toContain("Issue #3 を実装する");
    expect(run.prompt).toContain("対象: Issue #3");
    expect(run.prompt).toContain("作業フォルダは /worktrees/issue:3 です");
    expect(run.systemPrompt).toContain("テストを先に書く");

    expect(events()).toEqual([
      {
        type: "agent_finished",
        runId: 1,
        role: "programmer",
        target: { kind: "issue", number: 3 },
        status: "done",
        summary: "PR #5 を作った",
        questions: [],
        pr: 5,
      },
    ]);
    expect(store.runningRuns()).toEqual([]);
    expect(store.recentRuns(1)[0]).toMatchObject({ status: "done" });
    expect(finished()).toBe(1);
  });

  it("PR が対象なら、その PR のブランチの作業フォルダを使う", async () => {
    const { executor, github, workspace } = setup();
    const pr = github.addPr("検索", ["src/a.ts"], { branch: "tasuki/issue-3" });
    await executor.execute([
      {
        type: "run_agent",
        role: "reviewer",
        target: { kind: "pr", number: pr.number },
        instruction: "レビューする",
      },
    ]);
    await executor.idle();
    expect(workspace.prepared).toEqual([
      {
        key: `pr:${String(pr.number)}`,
        access: "read",
        prBranch: "tasuki/issue-3",
      },
    ]);
  });

  it("レビュアーの判定を要約の先頭に入れる", async () => {
    const { executor, agents, github, events } = setup();
    const pr = github.addPr("検索", ["src/a.ts"]);
    agents.worker = () =>
      ok(
        output({
          summary: "null の扱いが漏れている",
          verdict: "request_changes",
          pr: pr.number,
        }),
      );
    await executor.execute([
      {
        type: "run_agent",
        role: "reviewer",
        target: { kind: "pr", number: pr.number },
        instruction: "レビューする",
      },
    ]);
    await executor.idle();
    expect(events()[0]).toMatchObject({
      summary:
        "判定: request_changes（直す必要がある）\nnull の扱いが漏れている",
    });
  });

  it("同時に動かせる数を超えたら見送り、終われば起動できる", async () => {
    const { executor, agents } = setup();
    const holds = [deferred(), deferred()];
    let i = 0;
    agents.worker = () => holds[i++]?.promise ?? ok(output());
    const results = await executor.execute([
      runProgrammer(1),
      runProgrammer(2),
      runProgrammer(3),
    ]);
    expect(results[0]).toContain("起動した");
    expect(results[1]).toContain("起動した");
    expect(results[2]).toBe("見送り: 同時に動かせる数（2）に達しています");
    expect(executor.runningCount).toBe(2);

    holds[0]!.resolve(ok(output()));
    await new Promise((r) => setTimeout(r, 0));
    expect(await executor.execute([runProgrammer(3)])).toEqual([
      "起動した（実行 3）",
    ]);
    holds[1]!.resolve(ok(output()));
    await executor.idle();
    expect(executor.runningCount).toBe(0);
  });

  it("同じ対象で動いている間は見送る", async () => {
    const { executor, agents } = setup();
    const hold = deferred();
    agents.worker = () => hold.promise;
    await executor.execute([runProgrammer(1)]);
    expect(await executor.execute([runProgrammer(1)])).toEqual([
      "見送り: 同じ対象でプログラマーが動いています",
    ]);
    hold.resolve(ok(output()));
    await executor.idle();
  });

  it("同じ作業フォルダで書く役が動いていたら、起動せずに伝える", async () => {
    const { executor, agents, github, workspace, events } = setup();
    const pr = github.addPr("検索", ["src/a.ts"], { branch: "tasuki/issue-1" });
    workspace.shared.set("tasuki/issue-1", "/worktrees/issue:1");
    const hold = deferred();
    agents.worker = () => hold.promise;
    await executor.execute([runProgrammer(1)]);
    await new Promise((r) => setTimeout(r, 0));
    await executor.execute([
      {
        type: "run_agent",
        role: "programmer",
        target: { kind: "pr", number: pr.number },
        instruction: "指摘を直す",
      },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(events()).toMatchObject([
      { type: "agent_finished", status: "error", target: { kind: "pr" } },
    ]);
    expect(agents.count("programmer")).toBe(1);
    hold.resolve(ok(output()));
    await executor.idle();
  });
});

describe("質問", () => {
  it("エージェントが返した質問を、質問チャンネルのスレッドに書いて記録する", async () => {
    const { executor, agents, chat, store, events } = setup();
    agents.worker = () =>
      ok(
        output({
          status: "question",
          summary: "検索の対象が決まっていない",
          questions: ["1. 対象はタイトルだけですか（おすすめ: はい）"],
        }),
      );
    await executor.execute([
      {
        type: "run_agent",
        role: "spec-master",
        target: { kind: "requirement", id: "10" },
        instruction: "仕様を作る",
      },
    ]);
    await executor.idle();
    const [thread] = [...chat.threads.values()];
    expect(thread!.title).toBe("仕様マスターからの質問（要件 10）");
    expect(thread!.body).toContain("1. 対象はタイトルだけですか");
    expect(store.questions()[0]).toMatchObject({
      target: { kind: "requirement", id: "10" },
      answered: false,
    });
    expect(events()[0]).toMatchObject({
      status: "question",
      questions: ["1. 対象はタイトルだけですか（おすすめ: はい）"],
    });
  });

  it("ask_human で質問スレッドを作る", async () => {
    const { executor, chat, store } = setup();
    expect(
      await executor.execute([
        {
          type: "ask_human",
          title: "進め方の確認",
          question: "1. どちらにしますか",
          target: { kind: "issue", number: 3 },
        },
      ]),
    ).toEqual(["質問チャンネルに投稿した"]);
    expect([...chat.threads.values()][0]).toMatchObject({
      title: "進め方の確認",
      body: "1. どちらにしますか",
    });
    expect(store.questions()).toHaveLength(1);
  });
});

describe("マージの門番", () => {
  it("設定が auto で CI が合格していればマージする", async () => {
    const { executor, github, events } = setup(
      "merge:\n  implementation: auto\n",
    );
    const pr = github.addPr("検索", ["src/a.ts"], { ci: "pass" });
    expect(
      await executor.execute([{ type: "merge_pr", number: pr.number }]),
    ).toEqual(["マージした"]);
    expect(github.merged).toEqual([pr.number]);
    expect(events()).toEqual([]);
  });

  it("設定が human ならマージせず、理由を出来事にする", async () => {
    const { executor, github, events } = setup();
    const pr = github.addPr("検索", ["src/a.ts"], { ci: "pass" });
    const [result] = await executor.execute([
      { type: "merge_pr", number: pr.number },
    ]);
    expect(result).toContain("見送り: この工程のマージの設定は human です");
    expect(github.merged).toEqual([]);
    expect(events()).toMatchObject([
      { type: "merge_refused", number: pr.number },
    ]);
  });

  it("工程ごとの設定に従う（仕様は auto、実装は human）", async () => {
    const { executor, github } = setup("merge:\n  spec: auto\n");
    const spec = github.addPr("仕様", ["docs/specs/a.md"], { ci: "pass" });
    const impl = github.addPr("実装", ["src/a.ts"], { ci: "pass" });
    const results = await executor.execute([
      { type: "merge_pr", number: spec.number },
      { type: "merge_pr", number: impl.number },
    ]);
    expect(results[0]).toBe("マージした");
    expect(results[1]).toContain("見送り");
    expect(github.merged).toEqual([spec.number]);
  });

  it("CI が合格していなければ、auto でもマージしない", async () => {
    const { executor, github, events } = setup(
      "merge:\n  implementation: auto\n",
    );
    for (const ci of ["fail", "pending", "none"] as const) {
      const pr = github.addPr(`検索 ${ci}`, ["src/a.ts"], {
        ci,
        failedChecks: ci === "fail" ? ["check"] : [],
      });
      const [result] = await executor.execute([
        { type: "merge_pr", number: pr.number },
      ]);
      expect(result).toContain("見送り: CI");
    }
    expect(github.merged).toEqual([]);
    expect(events()).toHaveLength(3);
  });
});

describe("そのほかの指示", () => {
  it("お知らせ・要件の完了・待ち", async () => {
    const { executor, chat, store } = setup();
    store.addRequirement({ id: "10", author: "清水", content: "検索" });
    const results = await executor.execute([
      { type: "notify", message: "着手しました" },
      {
        type: "complete_requirement",
        requirementId: "10",
        message: "検索が完成しました",
      },
      { type: "complete_requirement", requirementId: "99", message: "x" },
      { type: "wait", reason: "CI を待つ" },
    ]);
    expect(results).toEqual([
      "お知らせチャンネルに書いた",
      "要件を完了にして、お知らせチャンネルに書いた",
      "見送り: 要件 99 がありません",
      "何もしない",
    ]);
    expect(chat.notices).toEqual(["着手しました", "検索が完成しました"]);
    expect(store.requirements("open")).toEqual([]);
  });

  it("1 つの指示が失敗しても、残りを実行する", async () => {
    const { executor, chat } = setup();
    chat.failNext = true;
    const results = await executor.execute([
      { type: "ask_human", title: "t", question: "q", target: null },
      { type: "notify", message: "x" },
    ]);
    expect(results[0]).toContain("失敗: Discord に接続できません");
    expect(results[1]).toBe("お知らせチャンネルに書いた");
  });
});

describe("利用上限", () => {
  it("上限で終わったら回復時刻まで起動を見送り、過ぎたら出来事にして再開する", async () => {
    const { executor, agents, events, advance } = setup();
    agents.worker = () => ({
      kind: "limit",
      resetsAt: new Date("2026-11-23T01:00:00Z"),
      message: "limit",
    });
    await executor.execute([runProgrammer(1)]);
    await executor.idle();
    expect(events()).toMatchObject([
      { type: "agent_finished", status: "limit" },
    ]);
    expect(executor.limit).toEqual(new Date("2026-11-23T01:01:00Z"));

    agents.worker = () => ok(output());
    expect((await executor.execute([runProgrammer(1)]))[0]).toContain(
      "見送り: 利用上限のため",
    );

    advance(62 * 60 * 1000);
    executor.checkLimit();
    expect(executor.limit).toBeNull();
    expect(events()).toEqual([{ type: "limit_recovered" }]);
    expect((await executor.execute([runProgrammer(1)]))[0]).toContain(
      "起動した",
    );
    await executor.idle();
  });

  it("回復時刻が分からなければ 15 分ほど待つ", () => {
    const { executor } = setup();
    executor.setLimit(undefined);
    expect(executor.limit).toEqual(new Date("2026-11-23T00:16:00Z"));
  });
});

describe("失敗と再起動", () => {
  it("実行そのものの失敗も出来事にする", async () => {
    const { executor, agents, events } = setup();
    agents.worker = () => ({ kind: "error", message: "programmer: 落ちた" });
    await executor.execute([runProgrammer(1)]);
    await executor.idle();
    expect(events()).toMatchObject([
      {
        type: "agent_finished",
        status: "error",
        summary: "programmer: 落ちた",
      },
    ]);
  });

  it("前回動いていた実行を、途中で終わったものとして伝える", () => {
    const { executor, store, events } = setup();
    store.startRun({
      role: "programmer",
      target: { kind: "issue", number: 1 },
      instruction: "x",
    });
    executor.recoverInterrupted();
    expect(store.runningRuns()).toEqual([]);
    expect(events()).toMatchObject([
      { type: "agent_finished", runId: 1, status: "interrupted" },
    ]);
  });

  it("止めたあとは新しく起動しない", async () => {
    const { executor } = setup();
    executor.stopNow();
    expect(await executor.execute([runProgrammer(1)])).toEqual([
      "見送り: Tasuki を止めています",
    ]);
  });
});
