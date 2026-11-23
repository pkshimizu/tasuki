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

describe("レビューの記録と受け渡し", () => {
  const review = (number: number): Action => ({
    type: "run_agent",
    role: "reviewer",
    target: { kind: "pr", number },
    instruction: "レビューする",
  });
  const fix = (number: number): Action => ({
    type: "run_agent",
    role: "programmer",
    target: { kind: "pr", number },
    instruction: "指摘を直す",
  });
  const major = {
    severity: "major" as const,
    file: "src/search.ts",
    line: 12,
    problem: "空の検索語の扱いが漏れている",
    suggestion: "空なら全件を返す",
  };

  it("指摘に番号を振って記録し、判定と指摘の数を司令塔への要約に入れる", async () => {
    const { executor, agents, github, store, events } = setup();
    const pr = github.addPr("検索", ["src/search.ts"]);
    agents.worker = () =>
      ok(
        output({
          summary: "1 点、直す必要がある",
          verdict: "request_changes",
          pr: pr.number,
          findings: [
            major,
            { ...major, severity: "nit", problem: "空行が多い" },
          ],
          rule_proposals: ["入力が空のときの扱いを仕様に必ず書く"],
        }),
      );
    await executor.execute([review(pr.number)]);
    await executor.idle();

    expect(agents.runs[0]!.prompt).toContain("1 回目のレビューです");
    expect(store.reviews(pr.number)).toMatchObject([
      { round: 1, sha: pr.headSha, verdict: "request_changes" },
    ]);
    expect(
      store.findings(pr.number).map((x) => [x.number, x.severity]),
    ).toEqual([
      [1, "major"],
      [2, "nit"],
    ]);
    expect(events()[0]).toMatchObject({
      summary: [
        "判定: request_changes（直す必要がある）",
        "新しい指摘: major 1・nit 1（#1〜#2）",
        "1 点、直す必要がある",
        "",
        "ルールの文書に足す提案:",
        "- 入力が空のときの扱いを仕様に必ず書く",
      ].join("\n"),
    });
  });

  it("直す役には番号つきの指摘を添え、対応の報告を記録する", async () => {
    const { executor, agents, github, store, events } = setup();
    const pr = github.addPr("検索", ["src/search.ts"]);
    store.addReview({
      pr: pr.number,
      sha: pr.headSha,
      verdict: "request_changes",
      runId: 1,
      findings: [
        major,
        { ...major, severity: "minor", problem: "名前が分かりにくい" },
      ],
      resolutions: [],
    });
    agents.worker = () =>
      ok(
        output({
          summary: "直して push した",
          pr: pr.number,
          responses: [
            { number: 1, action: "fixed", note: "空なら全件を返すようにした" },
            { number: 2, action: "declined", note: "既存の命名に合わせている" },
          ],
        }),
      );
    await executor.execute([fix(pr.number)]);
    await executor.idle();

    const prompt = agents.runs[0]!.prompt;
    expect(prompt).toContain("## レビューの指摘（番号つき）");
    expect(prompt).toContain(
      "- #1 [major] src/search.ts:12 空の検索語の扱いが漏れている",
    );
    expect(prompt).toContain("- #2 [minor]");
    expect(store.findings(pr.number).map((x) => x.status)).toEqual([
      "fixed",
      "declined",
    ]);
    expect(events()[0]).toMatchObject({
      summary:
        "指摘への対応: 直した 1・直さない 1・持ち越す 0\n直して push した",
    });
  });

  it("2 回目のレビューには、前回のコミットと指摘への対応を添え、解消判定を記録する", async () => {
    const { executor, agents, github, store } = setup();
    const pr = github.addPr("検索", ["src/search.ts"]);
    // addPr が返す PR は、あとの更新で書き換わるので、最初のコミットを控える
    const firstSha = pr.headSha;
    store.addReview({
      pr: pr.number,
      sha: firstSha,
      verdict: "request_changes",
      runId: 1,
      findings: [major],
      resolutions: [],
    });
    store.applyResponses(pr.number, [
      { number: 1, action: "fixed", note: "空なら全件を返すようにした" },
    ]);
    github.updatePr(pr.number, { headSha: "fixed-sha" });
    agents.worker = () =>
      ok(
        output({
          summary: "直っている",
          verdict: "approve",
          pr: pr.number,
          resolutions: [{ number: 1, status: "resolved", note: "確かめた" }],
        }),
      );
    await executor.execute([review(pr.number)]);
    await executor.idle();

    const prompt = agents.runs[0]!.prompt;
    expect(prompt).toContain("2 回目のレビューです");
    expect(prompt).toContain(`git diff ${firstSha}..HEAD`);
    expect(prompt).toContain(
      "状態: 直したと報告（空なら全件を返すようにした）",
    );
    expect(prompt).toContain("#2 から順に番号を振ります");
    expect(store.reviews(pr.number).at(-1)).toMatchObject({
      round: 2,
      sha: "fixed-sha",
      verdict: "approve",
    });
    expect(store.findings(pr.number)[0]!.status).toBe("resolved");
  });

  it("指摘が無い PR を直す役には、何も添えない", async () => {
    const { executor, agents, github } = setup();
    const pr = github.addPr("検索", ["src/search.ts"]);
    await executor.execute([fix(pr.number)]);
    await executor.idle();
    expect(agents.runs[0]!.prompt).not.toContain("レビューの指摘");
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

  it("レビューした PR は、approve されたコミットが今の先頭と同じときだけマージする", async () => {
    const { executor, github, store, events } = setup(
      "merge:\n  implementation: auto\n",
    );
    const pr = github.addPr("検索", ["src/a.ts"], { ci: "pass" });
    const record = (verdict: "approve" | "request_changes", sha: string) =>
      store.addReview({
        pr: pr.number,
        sha,
        verdict,
        runId: 1,
        findings: [],
        resolutions: [],
      });
    const merge = async () =>
      (await executor.execute([{ type: "merge_pr", number: pr.number }]))[0];

    record("request_changes", pr.headSha);
    expect(await merge()).toContain("判定が request_changes です");

    record("approve", pr.headSha);
    github.updatePr(pr.number, { headSha: "after-approve", ci: "pass" });
    expect(await merge()).toContain("コミットが足されています");
    expect(github.merged).toEqual([]);
    expect(events()).toHaveLength(2);

    record("approve", "after-approve");
    expect(await merge()).toBe("マージした");
    expect(github.merged).toEqual([pr.number]);
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

describe("作業フォルダの片付け", () => {
  const entry = (
    name: string,
    extra: { branch?: string; dirty?: boolean } = {},
  ) => ({
    name,
    cwd: `/worktrees/${name}`,
    branch: extra.branch ?? null,
    dirty: extra.dirty ?? false,
  });

  it("閉じた Issue・開いていない PR・完了した要件の作業フォルダを消す", async () => {
    const { executor, workspace, github, store, logs } = setup();
    const openIssue = github.addIssue("まだ開いている");
    const closedIssue = github.addIssue("閉じた");
    github.updateIssue(closedIssue.number, { state: "closed" });
    const openPr = github.addPr("開いている PR", ["src/a.ts"]);
    const mergedPr = github.addPr("マージした PR", ["src/b.ts"]);
    github.updatePr(mergedPr.number, { state: "merged" });
    store.addRequirement({ id: "100", author: "清水", content: "進行中" });
    store.addRequirement({ id: "200", author: "清水", content: "完了" });
    store.completeRequirement("200");
    workspace.existing = [
      entry(`issue-${String(openIssue.number)}`),
      entry(`issue-${String(closedIssue.number)}`),
      entry(`pr-${String(openPr.number)}`),
      entry(`read-pr-${String(openPr.number)}`),
      entry(`read-pr-${String(mergedPr.number)}`),
      entry("requirement-100"),
      entry("requirement-200"),
      entry("read-repo"),
      entry("memo"),
    ];
    await executor.cleanup({
      issues: await github.openIssues(),
      pullRequests: await github.openPullRequests(),
    });
    expect(workspace.removed).toEqual([
      `issue-${String(closedIssue.number)}`,
      `read-pr-${String(mergedPr.number)}`,
      "requirement-200",
    ]);
    expect(logs.filter((l) => l.includes("消しました"))).toHaveLength(3);
  });

  it("開いている PR のブランチを取り出している作業フォルダは消さない", async () => {
    const { executor, workspace, github } = setup();
    const pr = github.addPr("修正中", ["src/a.ts"], {
      branch: "tasuki/issue-9",
    });
    workspace.existing = [entry("issue-9", { branch: "tasuki/issue-9" })];
    await executor.cleanup({
      issues: [],
      pullRequests: await github.openPullRequests(),
    });
    expect(workspace.removed).toEqual([]);

    github.updatePr(pr.number, { state: "merged" });
    await executor.cleanup({ issues: [], pullRequests: [] });
    expect(workspace.removed).toEqual(["issue-9"]);
  });

  it("コミットしていない変更があれば消さず、1 回だけ知らせる。読むだけの役のフォルダは消す", async () => {
    const { executor, workspace, logs } = setup();
    workspace.existing = [
      entry("issue-9", { dirty: true }),
      entry("read-pr-8", { dirty: true }),
    ];
    await executor.cleanup({ issues: [], pullRequests: [] });
    await executor.cleanup({ issues: [], pullRequests: [] });
    expect(workspace.removed).toEqual(["read-pr-8"]);
    expect(logs.filter((l) => l.includes("残します"))).toHaveLength(1);
  });

  it("エージェントが動いている作業フォルダは消さない", async () => {
    const { executor, agents, workspace } = setup();
    const hold = deferred();
    agents.worker = () => hold.promise;
    await executor.execute([runProgrammer(5)]);
    await new Promise((r) => setTimeout(r, 0));
    // FakeWorkspace は対象のキー（issue:5）を作業フォルダの場所に使う
    workspace.existing = [
      {
        name: "issue-5",
        cwd: "/worktrees/issue:5",
        branch: null,
        dirty: false,
      },
    ];
    await executor.cleanup({ issues: [], pullRequests: [] });
    expect(workspace.removed).toEqual([]);

    hold.resolve(ok(output()));
    await executor.idle();
    await executor.cleanup({ issues: [], pullRequests: [] });
    expect(workspace.removed).toEqual(["issue-5"]);
  });

  it("消せなくても、ほかの作業フォルダの片付けを続ける", async () => {
    const { executor, workspace, logs } = setup();
    workspace.existing = [entry("issue-1"), entry("issue-2")];
    const remove = workspace.remove.bind(workspace);
    workspace.remove = (e) =>
      e.name === "issue-1" ? Promise.reject(new Error("使用中")) : remove(e);
    await executor.cleanup({ issues: [], pullRequests: [] });
    expect(workspace.removed).toEqual(["issue-2"]);
    expect(
      logs.some((l) => l.includes("issue-1 を消せませんでした: 使用中")),
    ).toBe(true);
  });
});
