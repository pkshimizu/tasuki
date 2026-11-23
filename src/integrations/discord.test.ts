import { describe, expect, it } from "vitest";
import {
  compareIds,
  DiscordChat,
  DiscordError,
  splitMessage,
} from "./discord.js";
import { ALLOWED_USER, testConfig } from "../testing/fixtures.js";

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** 決めた順に答える偽の fetch */
function fake(responses: { status?: number; json?: unknown }[]) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const queue = [...responses];
  const fetchFn = ((url: string, init: RequestInit) => {
    calls.push({
      method: init.method ?? "GET",
      path: url.replace("https://discord.com/api/v10", ""),
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const next = queue.shift();
    if (!next) throw new Error(`答えが足りません: ${url}`);
    return Promise.resolve(
      new Response(
        next.status === 204 ? null : JSON.stringify(next.json ?? {}),
        {
          status: next.status ?? 200,
        },
      ),
    );
  }) as unknown as typeof fetch;
  const chat = new DiscordChat("token", testConfig().discord, {
    fetch: fetchFn,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { chat, calls, sleeps };
}

function msg(id: string, content: string, author = ALLOWED_USER, extra = {}) {
  return {
    id,
    type: 0,
    content,
    author: { id: author, username: "user", global_name: "ユーザー" },
    ...extra,
  };
}

describe("splitMessage", () => {
  it("短い文はそのまま", () => {
    expect(splitMessage("こんにちは")).toEqual(["こんにちは"]);
  });
  it("長い文は行の切れ目で分ける", () => {
    const text = `${"a".repeat(1500)}\n${"b".repeat(1500)}`;
    const chunks = splitMessage(text);
    expect(chunks).toEqual(["a".repeat(1500), "b".repeat(1500)]);
  });
  it("切れ目が無ければ文字数で分ける", () => {
    const chunks = splitMessage("a".repeat(4500));
    expect(chunks.map((c) => c.length)).toEqual([2000, 2000, 500]);
  });
});

describe("compareIds", () => {
  it("桁数の違う ID も数として比べる", () => {
    expect(compareIds("999", "1000")).toBeLessThan(0);
    expect(compareIds("1001", "1000")).toBeGreaterThan(0);
    expect(compareIds("5", "5")).toBe(0);
  });
});

describe("newRequirements", () => {
  it("初めてのときは今ある投稿を要件にせず、位置だけを返す", async () => {
    const { chat, calls } = fake([{ json: [msg("50", "古い投稿")] }]);
    expect(await chat.newRequirements(undefined)).toEqual({
      messages: [],
      cursor: "50",
    });
    expect(calls[0]!.path).toBe(
      "/channels/1000000000000000001/messages?limit=1",
    );
  });

  it("初めてのときにチャンネルが空なら、最初の投稿から読めるよう位置を 0 にする", async () => {
    const { chat } = fake([{ json: [] }]);
    expect(await chat.newRequirements(undefined)).toEqual({
      messages: [],
      cursor: "0",
    });
  });

  it("許可した人の投稿だけを古い順に返す", async () => {
    const { chat, calls } = fake([
      {
        json: [
          msg("104", "", ALLOWED_USER),
          msg("103", "Bot の投稿", ALLOWED_USER, {
            author: { id: ALLOWED_USER, username: "bot", bot: true },
          }),
          msg("102", "知らない人", "999999"),
          msg("101", "検索機能がほしい"),
          msg("105", "スレッド作成の知らせ", ALLOWED_USER, { type: 18 }),
        ],
      },
    ]);
    const result = await chat.newRequirements("100");
    expect(result.messages).toEqual([
      {
        id: "101",
        authorId: ALLOWED_USER,
        authorName: "ユーザー",
        content: "検索機能がほしい",
      },
    ]);
    expect(result.cursor).toBe("105");
    expect(calls[0]!.path).toContain("after=100&limit=100");
  });

  it("新しい投稿が無ければ位置は変わらない", async () => {
    const { chat } = fake([{ json: [] }]);
    expect(await chat.newRequirements("100")).toEqual({
      messages: [],
      cursor: "100",
    });
  });

  it("100 件を超えたら続きを読む", async () => {
    const first = Array.from({ length: 100 }, (_, i) =>
      msg(String(1000 + i), `要件${String(i)}`),
    );
    const { chat, calls } = fake([
      { json: first },
      { json: [msg("1100", "最後")] },
    ]);
    const result = await chat.newRequirements("999");
    expect(result.messages).toHaveLength(101);
    expect(calls[1]!.path).toContain("after=1099");
    expect(result.cursor).toBe("1100");
  });
});

describe("createQuestionThread", () => {
  it("メンションつきの投稿からスレッドを作り、質問を書く", async () => {
    const { chat, calls } = fake([
      { json: msg("200", "head") },
      { json: { id: "200" } },
      { json: msg("201", "body") },
    ]);
    expect(
      await chat.createQuestionThread("仕様の確認", "1. どうしますか"),
    ).toBe("200");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/channels/1000000000000000002/messages",
      body: { content: `<@${ALLOWED_USER}> **仕様の確認**` },
    });
    expect(calls[1]).toMatchObject({
      path: "/channels/1000000000000000002/messages/200/threads",
      body: { name: "仕様の確認" },
    });
    expect(calls[2]).toMatchObject({
      path: "/channels/200/messages",
      body: { content: "1. どうしますか", allowed_mentions: { parse: [] } },
    });
  });
});

describe("activeQuestionThreads", () => {
  it("質問チャンネルのスレッドだけを返し、サーバー ID は 1 回だけ調べる", async () => {
    const threads = {
      threads: [
        { id: "t1", parent_id: "1000000000000000002", last_message_id: "9" },
        { id: "t2", parent_id: "other", last_message_id: "8" },
      ],
    };
    const { chat, calls } = fake([
      { json: { guild_id: "g1" } },
      { json: threads },
      { json: threads },
    ]);
    expect([...(await chat.activeQuestionThreads())]).toEqual([["t1", "9"]]);
    await chat.activeQuestionThreads();
    expect(calls.map((c) => c.path)).toEqual([
      "/channels/1000000000000000002",
      "/guilds/g1/threads/active",
      "/guilds/g1/threads/active",
    ]);
  });
});

describe("threadReplies", () => {
  it("読んだ位置が無ければスレッドの最初から読む", async () => {
    const { chat, calls } = fake([
      { json: [msg("301", "おすすめでよい"), msg("300", "質問", "bot-id")] },
    ]);
    const result = await chat.threadReplies("200", undefined);
    expect(result.messages.map((m) => m.content)).toEqual(["おすすめでよい"]);
    expect(result.cursor).toBe("301");
    expect(calls[0]!.path).toContain("/channels/200/messages?after=200");
  });
});

describe("notify", () => {
  it("お知らせチャンネルに、長い文は分けて書く", async () => {
    const { chat, calls } = fake([
      { json: msg("1", "") },
      { json: msg("2", "") },
    ]);
    await chat.notify(`${"a".repeat(1900)}\n${"b".repeat(500)}`);
    expect(calls.map((c) => c.path)).toEqual([
      "/channels/1000000000000000003/messages",
      "/channels/1000000000000000003/messages",
    ]);
  });
});

describe("失敗", () => {
  it("429 は待ってやり直す", async () => {
    const { chat, sleeps } = fake([
      { status: 429, json: { retry_after: 0.5 } },
      { json: [] },
    ]);
    await chat.newRequirements("1");
    expect(sleeps).toEqual([500]);
  });

  it("それ以外の失敗はエラーにする", async () => {
    const { chat } = fake([
      { status: 403, json: { message: "Missing Access" } },
    ]);
    await expect(chat.notify("x")).rejects.toThrow(DiscordError);
  });
});
