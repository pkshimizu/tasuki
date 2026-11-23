import { describe, expect, it } from "vitest";
import { Collector } from "./collector.js";
import { FakeChat, FakeGitHub } from "../testing/fakes.js";
import { SqliteStore } from "../store/store.js";
import { testConfig } from "../testing/fixtures.js";
import type { EventPayload } from "../domain/types.js";

function setup() {
  const chat = new FakeChat();
  const github = new FakeGitHub();
  const store = new SqliteStore(":memory:");
  const logs: string[] = [];
  const collector = new Collector({
    chat,
    github,
    store,
    config: testConfig(),
    log: (t) => logs.push(t),
  });
  /** 新しい出来事を取り出して、処理済みにする */
  const take = (): EventPayload[] => {
    const events = store.pendingEvents();
    store.markHandled(events.map((e) => e.id));
    return events.map((e) => e.payload);
  };
  return { chat, github, store, collector, logs, take };
}

describe("要件", () => {
  it("初めての確認では今ある投稿を要件にせず、その後の投稿だけを出来事にする", async () => {
    const { chat, collector, store, take } = setup();
    chat.postRequirement("前からある投稿");
    await collector.collect();
    expect(take()).toEqual([]);

    const id = chat.postRequirement("検索機能がほしい");
    await collector.collect();
    expect(take()).toEqual([
      {
        type: "requirement_posted",
        requirementId: id,
        author: "清水",
        content: "検索機能がほしい",
      },
    ]);
    expect(store.requirements("open").map((r) => r.id)).toEqual([id]);

    await collector.collect();
    expect(take()).toEqual([]);
  });
});

describe("質問への返信", () => {
  it("新しい返信をまとめて 1 つの出来事にし、同じ返信を二度伝えない", async () => {
    const { chat, collector, store, take } = setup();
    const threadId = await chat.createQuestionThread("検索の対象", "1. ...");
    store.addQuestion({
      threadId,
      title: "検索の対象",
      body: "1. ...",
      target: { kind: "requirement", id: "10" },
      origin: "spec-master",
    });
    await collector.collect();
    expect(take()).toEqual([]);

    chat.reply(threadId, "1 はタイトルだけ");
    chat.reply(threadId, "あとはおすすめでよい");
    await collector.collect();
    expect(take()).toEqual([
      {
        type: "question_answered",
        threadId,
        title: "検索の対象",
        target: { kind: "requirement", id: "10" },
        replies: [
          { author: "清水", content: "1 はタイトルだけ" },
          { author: "清水", content: "あとはおすすめでよい" },
        ],
      },
    ]);
    await collector.collect();
    expect(take()).toEqual([]);

    chat.reply(threadId, "やはり本文も対象に");
    await collector.collect();
    expect(take()).toMatchObject([
      { replies: [{ content: "やはり本文も対象に" }] },
    ]);
  });

  it("アーカイブされたスレッドは読まない", async () => {
    const { chat, collector, store, take } = setup();
    const threadId = await chat.createQuestionThread("t", "b");
    store.addQuestion({
      threadId,
      title: "t",
      body: "b",
      target: null,
      origin: null,
    });
    chat.reply(threadId, "返信");
    chat.threads.get(threadId)!.archived = true;
    await collector.collect();
    expect(take()).toEqual([]);
  });
});

describe("仕様・デザインの変更", () => {
  it("既定のブランチで置き場のファイルが変わったら、工程ごとに出来事にする", async () => {
    const { github, collector, take } = setup();
    await collector.collect();
    github.commit(["docs/specs/search.md", "src/a.ts"]);
    const head = github.commit([
      "docs/design/search.html",
      "docs/design-system/tokens.md",
    ]);
    await collector.collect();
    expect(take()).toEqual([
      {
        type: "docs_changed",
        stage: "spec",
        commit: head,
        files: ["docs/specs/search.md"],
      },
      {
        type: "docs_changed",
        stage: "design",
        commit: head,
        files: ["docs/design/search.html", "docs/design-system/tokens.md"],
      },
    ]);
  });

  it("置き場の外だけが変わったら出来事にしない", async () => {
    const { github, collector, take } = setup();
    await collector.collect();
    github.commit(["src/a.ts"]);
    await collector.collect();
    expect(take()).toEqual([]);
  });
});

describe("PR", () => {
  it("初めての確認では今ある PR を出来事にしない", async () => {
    const { github, collector, chat, take } = setup();
    github.addPr("前からある PR", ["src/a.ts"]);
    await collector.collect();
    expect(take()).toEqual([]);
    expect(chat.notices).toEqual([]);
  });

  it("作成・更新・CI・マージを出来事にし、作成とマージをお知らせに書く", async () => {
    const { github, collector, chat, take } = setup();
    await collector.collect();

    const pr = github.addPr("検索の仕様", ["docs/specs/search.md"]);
    await collector.collect();
    expect(take()).toEqual([
      {
        type: "pr_changed",
        number: pr.number,
        title: "検索の仕様",
        stage: "spec",
        branch: pr.branch,
        change: "opened",
      },
    ]);
    expect(chat.notices).toHaveLength(1);
    expect(chat.notices[0]).toContain("PR を作成しました: #1 検索の仕様");

    github.updatePr(pr.number, { ci: "fail", failedChecks: ["check"] });
    await collector.collect();
    expect(take()).toEqual([
      { type: "ci_changed", number: pr.number, status: "fail" },
    ]);

    github.updatePr(pr.number, { headSha: "h1-2", ci: "pending" });
    await collector.collect();
    expect(take()).toMatchObject([{ type: "pr_changed", change: "updated" }]);

    github.updatePr(pr.number, { ci: "pass" });
    await collector.collect();
    expect(take()).toEqual([
      { type: "ci_changed", number: pr.number, status: "pass" },
    ]);

    await github.mergePullRequest(pr.number, true);
    await collector.collect();
    const events = take();
    expect(events).toContainEqual({
      type: "pr_changed",
      number: pr.number,
      title: "検索の仕様",
      stage: "spec",
      branch: pr.branch,
      change: "merged",
    });
    expect(events).toContainEqual({
      type: "docs_changed",
      stage: "spec",
      commit: github.head,
      files: ["docs/specs/search.md"],
    });
    expect(chat.notices.at(-1)).toContain("PR がマージされました: #1");
  });

  it("マージされずに閉じられた PR は closed にし、お知らせに書かない", async () => {
    const { github, collector, chat, take } = setup();
    await collector.collect();
    const pr = github.addPr("やめた変更", ["src/a.ts"]);
    await collector.collect();
    take();
    github.updatePr(pr.number, { state: "closed" });
    await collector.collect();
    expect(take()).toMatchObject([{ type: "pr_changed", change: "closed" }]);
    expect(chat.notices).toHaveLength(1);
  });

  it("人のコメントは出来事にし、エージェントのコメントは出来事にしない", async () => {
    const { github, collector, take } = setup();
    await collector.collect();
    const pr = github.addPr("検索", ["src/search.ts"]);
    await collector.collect();
    take();

    github.addComment(
      pr.number,
      "null の扱いを直して\n\n<!-- tasuki:reviewer -->",
      "bot",
    );
    github.addComment(
      pr.number,
      "文言は「検索」にして",
      "human",
      "src/search.ts",
    );
    await collector.collect();
    expect(take()).toEqual([
      {
        type: "pr_comment",
        number: pr.number,
        author: "human",
        body: "文言は「検索」にして",
        path: "src/search.ts",
      },
    ]);
    await collector.collect();
    expect(take()).toEqual([]);
  });
});

describe("Issue", () => {
  it("作成・更新・クローズを出来事にする", async () => {
    const { github, collector, take } = setup();
    github.addIssue("前からある Issue");
    await collector.collect();
    expect(take()).toEqual([]);

    const issue = github.addIssue("検索 API");
    await collector.collect();
    expect(take()).toEqual([
      {
        type: "issue_changed",
        number: issue.number,
        title: "検索 API",
        change: "opened",
      },
    ]);

    github.updateIssue(issue.number, { body: "書き足し" });
    await collector.collect();
    expect(take()).toMatchObject([{ change: "updated" }]);

    github.updateIssue(issue.number, { state: "closed" });
    await collector.collect();
    expect(take()).toMatchObject([{ change: "closed" }]);

    await collector.collect();
    expect(take()).toEqual([]);
  });
});

describe("失敗", () => {
  it("Discord が失敗しても GitHub は確かめ、次の確認で続きから読む", async () => {
    const { chat, github, collector, logs, take } = setup();
    await collector.collect();
    const id = chat.postRequirement("検索機能がほしい");
    github.addIssue("検索 API");
    chat.failNext = true;
    const collected = await collector.collect();
    expect(collected.github?.issues).toHaveLength(1);
    expect(logs[0]).toContain("要件の受け取りに失敗しました");
    expect(take()).toMatchObject([{ type: "issue_changed" }]);

    await collector.collect();
    expect(take()).toMatchObject([
      { type: "requirement_posted", requirementId: id },
    ]);
  });

  it("PR の一覧が読めなければ PR と Issue を返さず、次の確認で続きから読む", async () => {
    const { github, collector, logs, take } = setup();
    await collector.collect();
    const pr = github.addPr("検索", ["src/search.ts"]);
    github.failOn = "openPullRequests";
    expect((await collector.collect()).github).toBeUndefined();
    expect(logs[0]).toContain("PR と Issue の確認に失敗しました");
    expect(take()).toEqual([]);

    const collected = await collector.collect();
    expect(collected.github?.pullRequests.map((p) => p.number)).toEqual([
      pr.number,
    ]);
    expect(take()).toMatchObject([{ type: "pr_changed", change: "opened" }]);
  });

  it("既定のブランチが読めなくても、PR と Issue は確かめる", async () => {
    const { github, collector, take } = setup();
    await collector.collect();
    github.commit(["docs/specs/a.md"]);
    github.failOn = "headCommit";
    expect((await collector.collect()).github).toBeDefined();
    expect(take()).toEqual([]);
    await collector.collect();
    expect(take()).toMatchObject([{ type: "docs_changed", stage: "spec" }]);
  });
});
