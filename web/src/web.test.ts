import { describe, expect, it } from "vitest";
import type { Directive } from "../../src/admin/types.js";
import { directiveLabel, outcomeLabel } from "./components/Chips.js";
import { lineCount } from "./components/Markdown.js";
import { splitEventText } from "./components/Timeline.js";
import {
  ago,
  clock,
  clockWithSeconds,
  dateTime,
  dayLabel,
  duration,
  elapsed,
  secondsUntil,
} from "./format.js";
import { defaultLang, MESSAGES, requirementName, targetLabel } from "./i18n.js";
import { PAGES, pathOf, routeOf } from "./routes.js";

const ja = MESSAGES.ja;
const en = MESSAGES.en;

describe("時刻の表示", () => {
  const at = new Date(2026, 10, 23, 17, 8, 5).toISOString();
  const now = new Date(2026, 10, 23, 17, 8, 5).getTime();

  it("時:分と、時:分:秒", () => {
    expect(clock(at)).toBe("17:08");
    expect(clockWithSeconds(at)).toBe("17:08:05");
  });

  it("今からの隔たり", () => {
    expect(ago(ja, at, now + 30_000)).toBe("たった今");
    expect(ago(ja, at, now + 12 * 60_000)).toBe("12 分前");
    expect(ago(ja, at, now + 60 * 60_000)).toBe("1 時間前");
    expect(ago(ja, at, now + 49 * 60 * 60_000)).toBe("2 日前");
    expect(ago(en, at, now + 60 * 60_000)).toBe("1 hour ago");
    expect(ago(en, at, now + 3 * 60 * 60_000)).toBe("3 hours ago");
  });

  it("動き出してからの時間", () => {
    expect(elapsed(at, now + 5_000)).toBe("0:05");
    expect(elapsed(at, now + 252_000)).toBe("4:12");
    expect(elapsed(at, now + 3_725_000)).toBe("1:02:05");
    expect(elapsed(at, now - 1_000)).toBe("0:00");
  });

  it("次の確認までの秒数は、過ぎていれば 0", () => {
    expect(secondsUntil(at, now - 41_500)).toBe(42);
    expect(secondsUntil(at, now + 5_000)).toBe(0);
  });
});

describe("道", () => {
  it("画面と道を行き来できる", () => {
    for (const page of PAGES) {
      expect(routeOf(pathOf(page))).toEqual({ page, id: null });
    }
    expect(pathOf("dashboard")).toBe("/");
    expect(pathOf("prs")).toBe("/prs");
    expect(pathOf("prs", "21")).toBe("/prs/21");
    expect(routeOf("/prs/21")).toEqual({ page: "prs", id: "21" });
    expect(routeOf(pathOf("questions", "a b/c"))).toEqual({
      page: "questions",
      id: "a b/c",
    });
  });
  it("知らない道はダッシュボードにする", () => {
    expect(routeOf("/unknown/1")).toEqual({ page: "dashboard", id: null });
    expect(routeOf("")).toEqual({ page: "dashboard", id: null });
    expect(routeOf("/prs/%E0%A4%A")).toEqual({ page: "prs", id: null });
  });
});

describe("文言", () => {
  /** 文言の入れ子をたどって、項目の名前を並べる */
  function keys(value: unknown, prefix = ""): string[] {
    if (typeof value !== "object" || value === null) return [prefix];
    return Object.entries(value).flatMap(([k, v]) =>
      keys(v, prefix ? `${prefix}.${k}` : k),
    );
  }

  it("日本語と英語で、同じ項目がそろっている", () => {
    expect(keys(en).sort()).toEqual(keys(ja).sort());
  });

  it("ブラウザが日本語なら日本語、それ以外は英語にする", () => {
    expect(defaultLang("ja-JP")).toBe("ja");
    expect(defaultLang("JA")).toBe("ja");
    expect(defaultLang("en-US")).toBe("en");
    expect(defaultLang(undefined)).toBe("en");
  });

  it("対象を、人が読む名前にする", () => {
    const names = new Map([["10", "カードモード"]]);
    expect(targetLabel(ja, { kind: "requirement", id: "10" }, names)).toBe(
      "要件「カードモード」",
    );
    expect(targetLabel(ja, { kind: "requirement", id: "99" }, names)).toBe(
      "要件",
    );
    expect(targetLabel(ja, { kind: "issue", number: 20 })).toBe("Issue #20");
    expect(targetLabel(en, { kind: "pr", number: 19 })).toBe("PR #19");
    expect(targetLabel(en, { kind: "repo" })).toBe("Whole repository");
    expect(targetLabel(ja, null)).toBe("");
  });

  it("要件の本文から、短い名前を作る", () => {
    expect(requirementName("カードモード")).toBe("カードモード");
    expect(
      requirementName("カードを一枚ずつランダムに表示し、表をクリックしたら"),
    ).toBe("カードを一枚ずつランダムに表示し…");
    expect(requirementName("1 行目\n2 行目")).toBe("1 行目");
  });
});

describe("司令塔の指示と結果", () => {
  const base: Directive = {
    type: "wait",
    role: null,
    target: null,
    number: null,
    requirement: null,
    outcome: "none",
    detail: "",
  };
  const names = new Map<string, string>();

  it("エージェントの起動は、役と対象を見出しにし、役の色を付ける", () => {
    const d: Directive = {
      ...base,
      type: "run_agent",
      role: "reviewer",
      target: { kind: "pr", number: 19 },
      outcome: "done",
    };
    expect(directiveLabel(ja, d, names)).toMatchObject({
      label: "レビュアーを起動（PR #19）",
      role: "reviewer",
    });
    expect(directiveLabel(en, d, names).label).toBe("Launch Reviewer (PR #19)");
    expect(outcomeLabel(ja, d)).toBe("起動した");
  });

  it("見送りと失敗は、指示の種類によらず同じ文言にする", () => {
    const merge: Directive = { ...base, type: "merge_pr", number: 21 };
    expect(directiveLabel(ja, merge, names).label).toBe("マージ（PR #21）");
    expect(outcomeLabel(ja, { ...merge, outcome: "skipped" })).toBe("見送り");
    expect(outcomeLabel(ja, { ...merge, outcome: "failed" })).toBe("失敗");
    expect(outcomeLabel(ja, { ...merge, outcome: "done" })).toBe("マージした");
  });

  it("そのほかの指示", () => {
    expect(directiveLabel(ja, base, names).label).toBe("待つ");
    expect(outcomeLabel(ja, base)).toBe("待った");
    expect(directiveLabel(ja, { ...base, type: "notify" }, names).label).toBe(
      "お知らせ",
    );
    expect(
      directiveLabel(ja, { ...base, type: "ask_human" }, names).label,
    ).toBe("人に質問");
    expect(
      directiveLabel(ja, { ...base, type: "complete_requirement" }, names)
        .label,
    ).toBe("要件を完了");
  });
});

describe("日付の表示", () => {
  const now = new Date(2026, 10, 23, 18, 0, 0).getTime();
  const at = (d: number, h: number, m: number) =>
    new Date(2026, 10, d, h, m, 0).toISOString();

  it("今日・昨日・月/日", () => {
    expect(dayLabel(ja, at(23, 0, 5), now)).toBe("今日");
    expect(dayLabel(ja, at(22, 23, 59), now)).toBe("昨日");
    expect(dayLabel(ja, at(15, 9, 0), now)).toBe("11/15");
    expect(dayLabel(en, at(23, 9, 0), now)).toBe("Today");
  });

  it("日付と時刻、始まりから終わりまでの時間", () => {
    expect(dateTime(ja, at(23, 17, 44), now)).toBe("今日 17:44");
    expect(dateTime(ja, at(22, 9, 5), now)).toBe("昨日 09:05");
    expect(duration(at(23, 17, 0), at(23, 17, 2))).toBe("2:00");
  });
});

describe("文章の表示", () => {
  it("空行を除いた行数を数える", () => {
    expect(lineCount("1 行目\n\n2 行目\n  \n3 行目")).toBe(3);
    expect(lineCount("")).toBe(0);
  });

  it("出来事の内容を、見出しと本文に分ける", () => {
    expect(
      splitEventText("PR #21 に human のコメント:\n文言を直して\n2 行目"),
    ).toEqual({
      title: "PR #21 に human のコメント",
      body: "文言を直して\n2 行目",
    });
    expect(splitEventText("PR #21 の CI が合格した")).toEqual({
      title: "PR #21 の CI が合格した",
      body: "",
    });
  });
});
