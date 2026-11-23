/**
 * Discord とのやり取り。REST API（v10）を PC から読みにいくだけで、
 * 外から PC への接続口（Webhook・Gateway）は作らない。
 * 読むのは設定したチャンネルと、許可した人の投稿だけ。
 */
import type { Config } from "../config/config.js";

export interface ChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
}

export interface Chat {
  /**
   * 要件チャンネルの、after より新しい許可した人の投稿（古い順）と、読んだ位置。
   * after が無い（初めて）ときは、今ある投稿を要件にせず、位置だけを返す。
   */
  newRequirements(
    after: string | undefined,
  ): Promise<{ messages: ChatMessage[]; cursor: string | undefined }>;
  /** 質問チャンネルにスレッドを作って質問を書く。スレッド ID を返す */
  createQuestionThread(title: string, body: string): Promise<string>;
  /** 質問チャンネルの開いているスレッドと、それぞれの最後の投稿 ID */
  activeQuestionThreads(): Promise<Map<string, string | null>>;
  /** スレッドの、after より新しい投稿（古い順）。許可した人の投稿と、読んだ位置 */
  threadReplies(
    threadId: string,
    after: string | undefined,
  ): Promise<{ messages: ChatMessage[]; cursor: string | undefined }>;
  /** スレッドに書く */
  postToThread(threadId: string, text: string): Promise<void>;
  /** お知らせチャンネルに書く */
  notify(text: string): Promise<void>;
  /** スレッドをブラウザで開く URL。サーバーがまだ分からなければ undefined */
  threadUrl(threadId: string): string | undefined;
  /** 要件の投稿をブラウザで開く URL。サーバーがまだ分からなければ undefined */
  requirementUrl(messageId: string): string | undefined;
}

export const MESSAGE_LIMIT = 2000;
const API = "https://discord.com/api/v10";
/** 人が書いた投稿の種類（通常の投稿と返信） */
const HUMAN_MESSAGE_TYPES = new Set([0, 19]);
const PAGE = 100;
const THREAD_NAME_LIMIT = 100;

/** 2000 文字を超える文を、なるべく行の切れ目で分ける */
export function splitMessage(text: string, limit = MESSAGE_LIMIT): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/** 投稿 ID（数字の文字列）の大小を比べる */
export function compareIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

export class DiscordError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DiscordError";
  }
}

interface RawMessage {
  id: string;
  type: number;
  content: string;
  author: {
    id: string;
    username: string;
    global_name?: string | null;
    bot?: boolean;
  };
}

export interface DiscordDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

const realDeps: DiscordDeps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const MAX_RATE_LIMIT_RETRIES = 3;

export class DiscordChat implements Chat {
  private guildId: string | undefined;

  constructor(
    private readonly token: string,
    private readonly discord: Config["discord"],
    private readonly deps: DiscordDeps = realDeps,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.deps.fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${this.token}`,
          "Content-Type": "application/json",
          "User-Agent": "DiscordBot (tasuki, 0.1)",
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const info = (await res.json().catch(() => ({}))) as {
          retry_after?: number;
        };
        await this.deps.sleep(Math.ceil((info.retry_after ?? 1) * 1000));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new DiscordError(
          res.status,
          `Discord ${method} ${path} が失敗しました（${String(res.status)}）: ${text.slice(0, 300)}`,
        );
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
  }

  /** チャンネル（スレッド）の after より新しい投稿を、古い順にすべて読む */
  private async messagesAfter(
    channelId: string,
    after: string,
  ): Promise<RawMessage[]> {
    const all: RawMessage[] = [];
    let cursor = after;
    for (;;) {
      const page = await this.request<RawMessage[]>(
        "GET",
        `/channels/${channelId}/messages?after=${cursor}&limit=${String(PAGE)}`,
      );
      if (page.length === 0) break;
      page.sort((a, b) => compareIds(a.id, b.id));
      all.push(...page);
      cursor = page.at(-1)!.id;
      if (page.length < PAGE) break;
    }
    return all;
  }

  private async latestId(channelId: string): Promise<string | undefined> {
    const page = await this.request<RawMessage[]>(
      "GET",
      `/channels/${channelId}/messages?limit=1`,
    );
    return page[0]?.id;
  }

  /** 許可した人が書いた投稿だけを残す */
  private accept(raw: RawMessage[]): ChatMessage[] {
    return raw
      .filter(
        (m) =>
          HUMAN_MESSAGE_TYPES.has(m.type) &&
          m.author.bot !== true &&
          this.discord.allowed_users.includes(m.author.id) &&
          m.content.trim().length > 0,
      )
      .map((m) => ({
        id: m.id,
        authorId: m.author.id,
        authorName: m.author.global_name ?? m.author.username,
        content: m.content,
      }));
  }

  private async read(channelId: string, after: string | undefined) {
    if (after === undefined) {
      // 投稿がまだ無いチャンネルは、最初の投稿から読めるように位置を 0 にする
      return {
        messages: [],
        cursor: (await this.latestId(channelId)) ?? "0",
      };
    }
    const raw = await this.messagesAfter(channelId, after);
    return { messages: this.accept(raw), cursor: raw.at(-1)?.id ?? after };
  }

  newRequirements(after: string | undefined) {
    return this.read(this.discord.channels.requirements, after);
  }

  async threadReplies(threadId: string, after: string | undefined) {
    // スレッドの ID は最初の投稿の ID と同じなので、そこから後ろを読めばすべての返信になる
    return this.read(threadId, after ?? threadId);
  }

  private async post(channelId: string, text: string, mention = false) {
    let first: RawMessage | undefined;
    for (const content of splitMessage(text)) {
      const sent = await this.request<RawMessage>(
        "POST",
        `/channels/${channelId}/messages`,
        {
          content,
          allowed_mentions: mention
            ? { users: this.discord.allowed_users }
            : { parse: [] },
        },
      );
      first ??= sent;
    }
    return first;
  }

  async createQuestionThread(title: string, body: string): Promise<string> {
    const mentions = this.discord.allowed_users
      .map((id) => `<@${id}>`)
      .join(" ");
    const head = `${mentions} **${title}**`;
    const starter = await this.request<RawMessage>(
      "POST",
      `/channels/${this.discord.channels.questions}/messages`,
      {
        content: head,
        allowed_mentions: { users: this.discord.allowed_users },
      },
    );
    const thread = await this.request<{ id: string }>(
      "POST",
      `/channels/${this.discord.channels.questions}/messages/${starter.id}/threads`,
      {
        name: title.replace(/\s+/g, " ").slice(0, THREAD_NAME_LIMIT),
        auto_archive_duration: 10080,
      },
    );
    await this.post(thread.id, body);
    return thread.id;
  }

  /** サーバーの ID を調べる（1 回だけ）。投稿やスレッドの URL を作るのに使う */
  async resolveServer(): Promise<string> {
    if (this.guildId === undefined) {
      const channel = await this.request<{ guild_id: string }>(
        "GET",
        `/channels/${this.discord.channels.questions}`,
      );
      this.guildId = channel.guild_id;
    }
    return this.guildId;
  }

  async activeQuestionThreads(): Promise<Map<string, string | null>> {
    const questions = this.discord.channels.questions;
    const guildId = await this.resolveServer();
    const active = await this.request<{
      threads: {
        id: string;
        parent_id: string;
        last_message_id: string | null;
      }[];
    }>("GET", `/guilds/${guildId}/threads/active`);
    return new Map(
      active.threads
        .filter((t) => t.parent_id === questions)
        .map((t) => [t.id, t.last_message_id]),
    );
  }

  async postToThread(threadId: string, text: string): Promise<void> {
    await this.post(threadId, text);
  }

  async notify(text: string): Promise<void> {
    await this.post(this.discord.channels.notices, text);
  }

  threadUrl(threadId: string): string | undefined {
    // サーバーの ID は、起動のあとか、質問スレッドを初めて確かめたときに分かる
    if (this.guildId === undefined) return undefined;
    return `https://discord.com/channels/${this.guildId}/${threadId}`;
  }

  requirementUrl(messageId: string): string | undefined {
    if (this.guildId === undefined) return undefined;
    return `https://discord.com/channels/${this.guildId}/${this.discord.channels.requirements}/${messageId}`;
  }
}
