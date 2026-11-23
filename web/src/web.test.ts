import { describe, expect, it } from "vitest";
import type { Directive } from "../../src/admin/types.js";
import { directiveLabel, outcomeLabel } from "./components/Chips.js";
import {
  ago,
  clock,
  clockWithSeconds,
  elapsed,
  secondsUntil,
} from "./format.js";
import { defaultLang, MESSAGES, requirementName, targetLabel } from "./i18n.js";
import { pageOf, PAGES, pathOf } from "./routes.js";

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
    for (const page of PAGES) expect(pageOf(pathOf(page))).toBe(page);
    expect(pathOf("dashboard")).toBe("/");
    expect(pathOf("prs")).toBe("/prs");
  });
  it("下の道は上の画面に、知らない道はダッシュボードにする", () => {
    expect(pageOf("/prs/21")).toBe("prs");
    expect(pageOf("/unknown")).toBe("dashboard");
    expect(pageOf("")).toBe("dashboard");
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
