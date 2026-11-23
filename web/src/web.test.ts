import { describe, expect, it } from "vitest";
import type { Directive } from "../../src/admin/types.js";
import { directiveLabel, outcomeLabel } from "./components/Chips.js";
import type { SettingsValues } from "../../src/admin/types.js";
import { operate, postJson } from "./api.js";
import {
  changedPaths,
  fieldPaths,
  getAt,
  otherProblems,
  problemsFor,
  resetPaths,
  SECTIONS,
  sectionOf,
  setAt,
} from "./settings.js";
import { operationError } from "./components/Dialog.js";
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

describe("操作", () => {
  const reply = (status: number, body: string) =>
    (() => Promise.resolve(new Response(body, { status }))) as typeof fetch;

  it("管理画面の印を付けて POST し、結果を返す", async () => {
    const calls: [unknown, RequestInit | undefined][] = [];
    const send = ((input: unknown, init?: RequestInit) => {
      calls.push([input, init]);
      return Promise.resolve(new Response('{"ok":true}'));
    }) as typeof fetch;
    expect(await operate("/api/ops/stop", send)).toEqual({ ok: true });
    expect(calls[0]![0]).toBe("/api/ops/stop");
    expect(calls[0]![1]).toMatchObject({
      method: "POST",
      headers: { "X-Tasuki-Admin": "1" },
    });
  });

  it("できなかった理由を返す。返事が読めなければ undefined", async () => {
    const refused = { ok: false, reason: "not_running", detail: "" };
    expect(await operate("/x", reply(409, JSON.stringify(refused)))).toEqual(
      refused,
    );
    expect(await operate("/x", reply(403, "Forbidden"))).toBeUndefined();
    expect(
      await operate("/x", reply(500, '{"error":"internal"}')),
    ).toBeUndefined();
    expect(
      await operate("/x", (() =>
        Promise.reject(new Error("down"))) as typeof fetch),
    ).toBeUndefined();
  });

  it("できなかった理由を、人が読む文にする", () => {
    expect(operationError(ja, undefined)).toBe(ja.ops.errors.failed);
    expect(
      operationError(ja, {
        ok: false,
        reason: "invalid_config",
        detail: "x が無い",
      }),
    ).toBe(`${ja.ops.errors.invalid_config}\nx が無い`);
    expect(
      operationError(en, { ok: false, reason: "not_running", detail: "" }),
    ).toBe(en.ops.errors.not_running);
  });
});

describe("設定のフォーム", () => {
  const base: SettingsValues = {
    poll_interval: 60,
    limits: { agents: 2 },
    language: "日本語",
    merge: {
      spec: "human",
      design: "human",
      implementation: "human",
      require_ci: true,
    },
    discord: {
      channels: { requirements: "1", questions: "2", notices: "3" },
      allowed_users: ["9"],
    },
    paths: { specs: "docs/specs", design: "docs/design", design_system: "ds" },
    knowledge: { context: ["docs/CONTEXT.md"] },
    workspace: { setup: [], setup_on_change: [] },
    agents: {
      dispatcher: "",
      "spec-master": "",
      planner: "",
      designer: "",
      programmer: "",
      reviewer: "",
    },
  };

  it("項目の道と、まとまり", () => {
    const paths = fieldPaths(base);
    expect(paths).toContain("poll_interval");
    expect(paths).toContain("limits.agents");
    expect(paths).toContain("discord.channels.notices");
    expect(paths).toContain("discord.allowed_users");
    expect(paths).toContain("agents.spec-master");
    expect(paths).not.toContain("discord");
    expect(sectionOf("language")).toBe("basic");
    expect(sectionOf("limits.agents")).toBe("basic");
    expect(sectionOf("merge.spec")).toBe("merge");
    expect(sectionOf("paths.specs")).toBe("docs");
    expect(sectionOf("knowledge.context")).toBe("docs");
    expect(sectionOf("workspace.setup")).toBe("workspace");
    expect(sectionOf("agents.reviewer")).toBe("models");
    // どのまとまりも、文言がある
    for (const id of SECTIONS) expect(ja.settings.sections[id]).toBeTruthy();
  });

  it("項目を変えても、もとの値は変えない", () => {
    const next = setAt(base, "limits.agents", 3);
    expect(getAt(next, "limits.agents")).toBe(3);
    expect(base.limits.agents).toBe(2);
    expect(next.merge).toBe(base.merge);
    expect(
      getAt(setAt(base, "agents.spec-master", "m"), "agents.spec-master"),
    ).toBe("m");
  });

  it("もとと違う項目を見つける。空の行と前後の空白は変更に数えない", () => {
    expect(changedPaths(base, base)).toEqual([]);
    let draft = setAt(base, "poll_interval", 30);
    draft = setAt(draft, "merge.spec", "auto");
    draft = setAt(draft, "workspace.setup", ["", "  "]);
    draft = setAt(draft, "language", " 日本語 ");
    draft = setAt(draft, "discord.allowed_users", ["9", "8"]);
    expect(changedPaths(base, draft)).toEqual([
      "poll_interval",
      "merge.spec",
      "discord.allowed_users",
    ]);
    expect(changedPaths(base, setAt(base, "poll_interval", null))).toEqual([
      "poll_interval",
    ]);
  });

  it("指定の項目だけを、もとの値に戻す", () => {
    let draft = setAt(base, "poll_interval", 30);
    draft = setAt(draft, "merge.spec", "auto");
    const reset = resetPaths(base, draft, ["poll_interval"]);
    expect(changedPaths(base, reset)).toEqual(["merge.spec"]);
  });

  it("項目についての誤りを選ぶ", () => {
    const problems = [
      { path: "discord.allowed_users.1", message: "ID を書きます" },
      { path: "discord.channels", message: "別々にします" },
      { path: "poll_interval", message: "10 以上" },
      { path: "", message: "全体の誤り" },
    ];
    expect(problemsFor(problems, "discord.allowed_users")).toEqual([
      "ID を書きます",
    ]);
    expect(problemsFor(problems, "poll_interval")).toEqual(["10 以上"]);
    // 名前の前半が同じだけの項目には出さない
    expect(problemsFor(problems, "poll")).toEqual([]);
    expect(
      otherProblems(problems, ["discord.allowed_users", "poll_interval"]),
    ).toEqual([problems[1], problems[3]]);
  });

  it("本文つきで POST する", async () => {
    const calls: RequestInit[] = [];
    const send = ((_: unknown, init?: RequestInit) => {
      calls.push(init ?? {});
      return Promise.resolve(new Response('{"problems":[]}'));
    }) as typeof fetch;
    expect(await postJson("/api/settings/preview", { sha: "s" }, send)).toEqual(
      {
        problems: [],
      },
    );
    expect(calls[0]).toMatchObject({
      method: "POST",
      body: '{"sha":"s"}',
      headers: { "X-Tasuki-Admin": "1", "Content-Type": "application/json" },
    });
  });
});
