import { describe, expect, it } from "vitest";
import type { AgentRun, RunAgent } from "../agents/agent.js";
import { toJsonSchema } from "../agents/agent.js";
import type { LoadedConfig } from "../config/config.js";
import {
  buildDispatchPrompt,
  decisionSchema,
  describeAction,
  describeEvent,
  dispatch,
  dispatcherPrompt,
  type Situation,
} from "./dispatcher.js";
import { testConfig } from "../testing/fixtures.js";
import type { EventPayload, TasukiEvent } from "../domain/types.js";

const config = testConfig("merge:\n  spec: auto\n");
const loaded: LoadedConfig = {
  dir: "/repo",
  config,
  instructions: {
    dispatcher: "小さく進める",
    "spec-master": "",
    planner: "",
    designer: "",
    programmer: "",
    reviewer: "",
  },
};

function event(id: number, payload: EventPayload): TasukiEvent {
  return {
    id,
    key: `k${String(id)}`,
    payload,
    createdAt: "2026-11-23T00:00:00Z",
  };
}

const empty: Situation = {
  requirements: [],
  questions: [],
  issues: [],
  pullRequests: [],
  running: [],
  recentRuns: [],
  recentDecisions: [],
  limitUntil: null,
};

describe("describeEvent", () => {
  it("要件", () => {
    expect(
      describeEvent({
        type: "requirement_posted",
        requirementId: "10",
        author: "清水",
        content: "検索機能がほしい",
      }),
    ).toBe("新しい要件（ID 10、清水）:\n検索機能がほしい");
  });
  it("質問への返信", () => {
    const text = describeEvent({
      type: "question_answered",
      threadId: "t1",
      title: "検索の対象",
      target: { kind: "requirement", id: "10" },
      replies: [{ author: "清水", content: "全部おすすめでよい" }],
    });
    expect(text).toContain("質問「検索の対象」（要件 10、スレッド t1）");
    expect(text).toContain("- 清水: 全部おすすめでよい");
  });
  it("エージェントの終了（質問つき）", () => {
    const text = describeEvent({
      type: "agent_finished",
      runId: 3,
      role: "spec-master",
      target: { kind: "requirement", id: "10" },
      status: "question",
      summary: "検索の対象が決まっていない",
      questions: ["1. 対象はタイトルだけですか"],
      pr: null,
    });
    expect(text).toContain(
      "仕様マスター（要件 10、実行 3）が人への質問を返した",
    );
    expect(text).toContain("質問チャンネルに投稿済み");
  });
  it("PR・CI・マージの見送り", () => {
    expect(
      describeEvent({
        type: "pr_changed",
        number: 7,
        title: "検索",
        change: "merged",
        stage: "implementation",
        branch: "tasuki/issue-3",
      }),
    ).toBe("PR #7「検索」（実装、ブランチ tasuki/issue-3）がマージされた");
    expect(
      describeEvent({ type: "ci_changed", number: 7, status: "fail" }),
    ).toBe("PR #7 の CI が失敗した");
    expect(
      describeEvent({
        type: "merge_refused",
        number: 7,
        reason: "CI が実行中です",
      }),
    ).toContain("見送った: CI が実行中です");
  });
  it("長い本文は切る", () => {
    const text = describeEvent({
      type: "pr_comment",
      number: 7,
      author: "human",
      body: "あ".repeat(3000),
      path: "src/a.ts",
    });
    expect(text.length).toBeLessThan(1700);
    expect(text).toContain("（src/a.ts）");
  });
});

describe("buildDispatchPrompt", () => {
  it("出来事と今の状況を見出しごとに並べる", () => {
    const prompt = buildDispatchPrompt(
      [event(1, { type: "ci_changed", number: 7, status: "pass" })],
      {
        ...empty,
        requirements: [
          { id: "10", author: "清水", content: "検索機能がほしい" },
        ],
        questions: [
          {
            threadId: "t1",
            title: "検索の対象",
            target: null,
            answered: false,
          },
        ],
        issues: [
          {
            number: 3,
            title: "検索 API",
            body: "先に済ませる Issue: #2",
            state: "open",
            labels: [],
            updatedAt: "",
            url: "",
          },
        ],
        pullRequests: [
          {
            number: 7,
            title: "検索",
            body: "",
            author: "bot",
            branch: "tasuki/issue-3",
            base: "main",
            state: "open",
            draft: false,
            headSha: "abc",
            updatedAt: "",
            ci: "pass",
            failedChecks: [],
            mergeable: "mergeable",
            files: [],
            url: "",
            stage: "implementation",
            merge: "human",
          },
        ],
        running: [
          {
            role: "reviewer",
            target: { kind: "pr", number: 7 },
            startedAt: "2026-11-23T00:00:00Z",
          },
        ],
        recentRuns: [
          {
            role: "programmer",
            target: { kind: "issue", number: 3 },
            status: "done",
            summary: "PR #7 を作った",
            finishedAt: "2026-11-23T00:00:00Z",
          },
        ],
        recentDecisions: [
          {
            at: "2026-11-22T23:00:00Z",
            events: ["Issue #3 が作成された"],
            reasoning: "着手できる",
            actions: [{ type: "run_agent" }],
          },
        ],
        limitUntil: "2026-11-23T05:00:00Z",
      },
      config,
    );
    expect(prompt).toContain("## 新しい出来事\n\n1. PR #7 の CI が合格した");
    expect(prompt).toContain("- ID 10（清水）: 検索機能がほしい");
    expect(prompt).toContain(
      "「検索の対象」（対象なし、スレッド t1）: 返信待ち",
    );
    expect(prompt).toContain("### #3 検索 API\n先に済ませる Issue: #2");
    expect(prompt).toContain(
      "#7「検索」: 実装、ブランチ tasuki/issue-3、作成者 bot、CI 合格、衝突なし、マージの設定 human（人がマージ）",
    );
    expect(prompt).toContain("- レビュアー（PR #7、");
    expect(prompt).toContain("プログラマー（Issue #3）終えた: PR #7 を作った");
    expect(prompt).toContain("理由: 着手できる");
    expect(prompt).toContain(
      "同時に動かせる作業エージェント: 2（今 1 動いている）",
    );
    expect(prompt).toContain("マージ: 仕様 auto、デザイン human、実装 human");
    expect(prompt).toContain("2026-11-23T05:00:00Z まで");
  });

  it("何も無い見出しには（なし）と書く", () => {
    const prompt = buildDispatchPrompt([], empty, config);
    expect(prompt).toContain("## 開いている PR\n\n（なし）");
  });
});

describe("decisionSchema", () => {
  it("指示の一覧を読める", () => {
    const decision = decisionSchema.parse({
      reasoning: "要件が来たので仕様を作る",
      actions: [
        {
          type: "run_agent",
          role: "spec-master",
          target: { kind: "requirement", id: "10" },
          instruction: "仕様を作る",
        },
        { type: "ask_human", title: "確認", question: "?", target: null },
        { type: "merge_pr", number: 7 },
        { type: "complete_requirement", requirementId: "10", message: "完了" },
        { type: "notify", message: "x" },
        { type: "wait", reason: "CI を待つ" },
      ],
    });
    expect(decision.actions.map(describeAction)).toEqual([
      "仕様マスターを起動（requirement:10）",
      "人に質問「確認」",
      "PR #7 をマージ",
      "要件 10 を完了",
      "お知らせ",
      "待つ（CI を待つ）",
    ]);
  });

  it("司令塔を作業エージェントとして起動する指示は誤り", () => {
    expect(
      decisionSchema.safeParse({
        reasoning: "",
        actions: [
          {
            type: "run_agent",
            role: "dispatcher",
            target: { kind: "repo" },
            instruction: "x",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("JSON Schema にできる", () => {
    const schema = toJsonSchema(decisionSchema);
    expect(JSON.stringify(schema)).toContain("run_agent");
    expect(JSON.stringify(schema)).not.toContain("oneOf");
  });
});

describe("dispatch", () => {
  it("読むだけの権限で、対象リポジトリのフォルダから起動する", async () => {
    let seen: AgentRun<typeof decisionSchema> | undefined;
    const runAgent = ((run: AgentRun<typeof decisionSchema>) => {
      seen = run;
      return Promise.resolve({
        kind: "ok",
        output: { reasoning: "何もない", actions: [] },
        costUsd: 0,
        turns: 1,
      });
    }) as unknown as RunAgent;
    const outcome = await dispatch(runAgent, {
      loaded,
      defaultBranch: "main",
      events: [event(1, { type: "limit_recovered" })],
      situation: empty,
    });
    expect(outcome.kind).toBe("ok");
    expect(seen!.guard).toEqual({
      cwd: "/repo",
      defaultBranch: "main",
      access: "inspect",
    });
    expect(seen!.prompt).toContain("利用上限から回復した");
  });
});

describe("dispatcherPrompt", () => {
  it("役・置き場・追加の指示・言語を入れる", () => {
    const p = dispatcherPrompt(loaded);
    expect(p).toContain("owner/name");
    expect(p).toContain("docs/specs/");
    expect(p).toContain("小さく進める");
    expect(p).toContain("日本語");
  });
});
