import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteStore, stateFile } from "./store.js";

function memory() {
  let t = Date.parse("2026-11-23T00:00:00Z");
  return new SqliteStore(":memory:", {
    now: () => new Date((t += 1000)),
  });
}

describe("出来事", () => {
  it("同じキーの出来事は二度足さない", () => {
    const s = memory();
    const payload = { type: "ci_changed", number: 3, status: "pass" } as const;
    expect(s.addEvent("ci:3:abc:pass", payload)).toBe(true);
    expect(s.addEvent("ci:3:abc:pass", payload)).toBe(false);
    expect(s.pendingEvents()).toHaveLength(1);
  });

  it("渡した出来事は次から出てこない", () => {
    const s = memory();
    s.addEvent("a", { type: "limit_recovered" });
    s.addEvent("b", { type: "ci_changed", number: 1, status: "fail" });
    const [first] = s.pendingEvents();
    s.markHandled([first!.id]);
    const rest = s.pendingEvents();
    expect(rest.map((e) => e.key)).toEqual(["b"]);
    expect(rest[0]!.payload).toEqual({
      type: "ci_changed",
      number: 1,
      status: "fail",
    });
  });
});

describe("値", () => {
  it("上書きできる", () => {
    const s = memory();
    expect(s.getValue("cursor")).toBeUndefined();
    s.setValue("cursor", "1");
    s.setValue("cursor", "2");
    expect(s.getValue("cursor")).toBe("2");
  });
});

describe("要件", () => {
  it("足して、完了にできる", () => {
    const s = memory();
    s.addRequirement({ id: "10", author: "u", content: "ログイン機能" });
    s.addRequirement({ id: "10", author: "u", content: "二重" });
    s.addRequirement({ id: "11", author: "u", content: "検索" });
    expect(s.requirements().map((r) => r.content)).toEqual([
      "ログイン機能",
      "検索",
    ]);
    expect(s.completeRequirement("10")).toBe(true);
    expect(s.completeRequirement("99")).toBe(false);
    expect(s.requirements("open").map((r) => r.id)).toEqual(["11"]);
  });
});

describe("質問スレッド", () => {
  it("対象と、読んだ位置を覚える", () => {
    const s = memory();
    s.addQuestion({
      threadId: "t1",
      title: "確認",
      body: "どちらにしますか",
      target: { kind: "issue", number: 4 },
    });
    s.addQuestion({ threadId: "t2", title: "全体", body: "?", target: null });
    s.setQuestionRead("t1", "400", true);
    s.setQuestionRead("t1", "500", false);
    s.setQuestionRead("t2", "600", false);
    const [q1, q2] = s.questions();
    expect(q1).toMatchObject({
      threadId: "t1",
      target: { kind: "issue", number: 4 },
      lastReadId: "500",
      answered: true,
    });
    expect(q2).toMatchObject({
      target: null,
      lastReadId: "600",
      answered: false,
    });
  });
});

describe("エージェントの実行", () => {
  it("動いている実行と、最近の実行を返す", () => {
    const s = memory();
    const a = s.startRun({
      role: "programmer",
      target: { kind: "issue", number: 1 },
      instruction: "実装する",
    });
    const b = s.startRun({
      role: "reviewer",
      target: { kind: "pr", number: 2 },
      instruction: "レビューする",
    });
    s.finishRun(a, "done", "終えた");
    expect(s.runningRuns().map((r) => r.id)).toEqual([b]);
    const recent = s.recentRuns(10);
    expect(recent.map((r) => r.status)).toEqual(["done", "running"]);
    expect(recent[0]).toMatchObject({ summary: "終えた", role: "programmer" });
    expect(recent[0]!.finishedAt).not.toBeNull();
    expect(s.recentRuns(1).map((r) => r.id)).toEqual([b]);
  });
});

describe("司令塔の判断", () => {
  it("古い順に最近のものを返す", () => {
    const s = memory();
    for (const n of [1, 2, 3]) {
      s.addDecision({
        events: [`出来事${String(n)}`],
        reasoning: `理由${String(n)}`,
        actions: [{ type: "wait" }],
      });
    }
    expect(s.recentDecisions(2).map((d) => d.reasoning)).toEqual([
      "理由2",
      "理由3",
    ]);
  });
});

describe("ファイル", () => {
  it("閉じて開き直しても続きから読める", () => {
    const file = join(
      mkdtempSync(join(tmpdir(), "tasuki-store-")),
      "a",
      "s.db",
    );
    const s1 = new SqliteStore(file);
    s1.addEvent("a", { type: "limit_recovered" });
    s1.setValue("cursor", "9");
    const run = s1.startRun({
      role: "planner",
      target: { kind: "repo" },
      instruction: "x",
    });
    s1.close();
    const s2 = new SqliteStore(file);
    expect(s2.pendingEvents()).toHaveLength(1);
    expect(s2.getValue("cursor")).toBe("9");
    expect(s2.runningRuns().map((r) => r.id)).toEqual([run]);
    s2.close();
  });

  it("リポジトリごとの場所を返す", () => {
    expect(stateFile("owner/name", "/home/u").replaceAll("\\", "/")).toBe(
      "/home/u/.tasuki/state/owner__name.db",
    );
  });
});

describe("レビューの記録", () => {
  const f = (
    severity: "blocker" | "major" | "minor" | "nit",
    problem: string,
  ) => ({
    severity,
    file: "src/a.ts",
    line: 1,
    problem,
    suggestion: "直す",
  });

  it("回の番号と、指摘の通し番号を振る", () => {
    const s = memory();
    const first = s.addReview({
      pr: 7,
      sha: "sha1",
      verdict: "request_changes",
      runId: 1,
      findings: [f("blocker", "落ちる"), f("minor", "名前")],
      resolutions: [],
    });
    expect(first.review.round).toBe(1);
    expect(first.firstNumber).toBe(1);
    const second = s.addReview({
      pr: 7,
      sha: "sha2",
      verdict: "approve",
      runId: 2,
      findings: [f("nit", "空行")],
      resolutions: [],
    });
    expect(second.review.round).toBe(2);
    expect(second.firstNumber).toBe(3);
    expect(s.reviews(7).map((r) => [r.round, r.sha, r.verdict])).toEqual([
      [1, "sha1", "request_changes"],
      [2, "sha2", "approve"],
    ]);
    expect(s.findings(7).map((x) => [x.number, x.round, x.severity])).toEqual([
      [1, 1, "blocker"],
      [2, 1, "minor"],
      [3, 2, "nit"],
    ]);
    // PR ごとに別々に数える
    expect(s.reviews(8)).toEqual([]);
    expect(
      s.addReview({
        pr: 8,
        sha: "x",
        verdict: "approve",
        runId: 3,
        findings: [f("major", "別の PR")],
        resolutions: [],
      }).firstNumber,
    ).toBe(1);
  });

  it("対応の報告と、解消判定を指摘に反映する", () => {
    const s = memory();
    s.addReview({
      pr: 7,
      sha: "sha1",
      verdict: "request_changes",
      runId: 1,
      findings: [
        f("blocker", "a"),
        f("major", "b"),
        f("major", "c"),
        f("minor", "d"),
      ],
      resolutions: [],
    });
    s.applyResponses(7, [
      { number: 1, action: "fixed", note: "直した" },
      { number: 2, action: "fixed", note: "直した" },
      { number: 3, action: "deferred", note: "設計の変更が要る" },
      { number: 4, action: "declined", note: "既存に合わせている" },
      { number: 99, action: "fixed", note: "無い番号" },
    ]);
    expect(s.findings(7).map((x) => x.status)).toEqual([
      "fixed",
      "fixed",
      "deferred",
      "declined",
    ]);

    s.addReview({
      pr: 7,
      sha: "sha2",
      verdict: "request_changes",
      runId: 2,
      findings: [],
      resolutions: [
        { number: 1, status: "resolved", note: "直っている" },
        { number: 2, status: "worsened", note: "別の場所が壊れた" },
        { number: 4, status: "resolved", note: "理由に納得" },
      ],
    });
    expect(s.findings(7).map((x) => [x.status, x.note])).toEqual([
      ["resolved", "直っている"],
      ["open", "修正で悪くなった: 別の場所が壊れた"],
      ["deferred", "設計の変更が要る"],
      ["resolved", "理由に納得"],
    ]);

    // 解消済みの指摘は、あとから来た対応の報告で開き直さない
    s.applyResponses(7, [
      { number: 1, action: "declined", note: "遅れて届いた" },
    ]);
    expect(s.findings(7)[0]!.status).toBe("resolved");
  });
});
