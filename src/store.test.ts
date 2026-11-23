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
