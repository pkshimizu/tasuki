/**
 * 監視スレッドの「集める」部分。Discord と GitHub を確かめ、前回から変わったことを出来事として記録する。
 * 何をするかはここでは決めない（事実を集めて伝えるだけ）。
 * どれかの取得に失敗しても止まらず、次の確認で続きから読む。
 */
import { type Config, isUnder, type Stage } from "../config/config.js";
import type { Chat } from "../integrations/discord.js";
import {
  type CiStatus,
  type GitHub,
  type Issue,
  type PullRequest,
  stageOf,
} from "../integrations/github.js";
import type { Store } from "../store/store.js";

/** エージェントが書いた PR・Issue・コメントに付ける印。人のコメントと見分ける */
export const AGENT_MARKER = "<!-- tasuki:";

export interface CollectorDeps {
  chat: Chat;
  github: GitHub;
  store: Store;
  config: Config;
  log: (text: string) => void;
}

export interface Collected {
  /** GitHub から読めたときだけ入る。読めなければ undefined */
  github: { issues: Issue[]; pullRequests: PullRequest[] } | undefined;
}

interface PrSnapshot {
  title: string;
  branch: string;
  stage: Stage;
  headSha: string;
  updatedAt: string;
  ci: CiStatus;
}
interface IssueSnapshot {
  title: string;
  updatedAt: string;
}

const KEY = {
  requirements: "discord:requirements",
  head: "github:head",
  prs: "github:prs",
  issues: "github:issues",
};

function readJson<T>(store: Store, name: string): T | undefined {
  const text = store.getValue(name);
  return text === undefined ? undefined : (JSON.parse(text) as T);
}

export class Collector {
  private defaultBranch: string | undefined;

  constructor(private readonly deps: CollectorDeps) {}

  async branch(): Promise<string> {
    this.defaultBranch ??= await this.deps.github.defaultBranch();
    return this.defaultBranch;
  }

  /** 1 回分の確認。新しい出来事を記録する */
  async collect(): Promise<Collected> {
    await this.attempt("要件の受け取り", () => this.requirements());
    await this.attempt("質問への返信の受け取り", () => this.answers());
    await this.attempt("仕様・デザインの変更の確認", () => this.docs());
    let github: Collected["github"];
    await this.attempt("PR と Issue の確認", async () => {
      const pullRequests = await this.pullRequests();
      const issues = await this.issues();
      github = { issues, pullRequests };
    });
    return { github };
  }

  private async attempt(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.deps.log(
        `${name}に失敗しました（次の確認でやり直します）: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async notify(text: string): Promise<void> {
    await this.attempt("お知らせの書き込み", () => this.deps.chat.notify(text));
  }

  private async requirements(): Promise<void> {
    const { chat, store } = this.deps;
    const { messages, cursor } = await chat.newRequirements(
      store.getValue(KEY.requirements),
    );
    for (const m of messages) {
      store.addRequirement({
        id: m.id,
        author: m.authorName,
        content: m.content,
      });
      store.addEvent(`requirement:${m.id}`, {
        type: "requirement_posted",
        requirementId: m.id,
        author: m.authorName,
        content: m.content,
      });
    }
    if (cursor !== undefined) store.setValue(KEY.requirements, cursor);
  }

  private async answers(): Promise<void> {
    const { chat, store } = this.deps;
    const questions = store.questions();
    if (questions.length === 0) return;
    const active = await chat.activeQuestionThreads();
    for (const q of questions) {
      const last = active.get(q.threadId);
      // アーカイブされたスレッドと、前回から投稿が増えていないスレッドは読まない
      if (last === undefined || last === null || last === q.lastReadId)
        continue;
      const { messages, cursor } = await chat.threadReplies(
        q.threadId,
        q.lastReadId ?? undefined,
      );
      const lastReply = messages.at(-1);
      if (lastReply) {
        store.addEvent(`answer:${q.threadId}:${lastReply.id}`, {
          type: "question_answered",
          threadId: q.threadId,
          title: q.title,
          target: q.target,
          replies: messages.map((m) => ({
            author: m.authorName,
            content: m.content,
          })),
        });
      }
      if (cursor !== undefined) {
        store.setQuestionRead(q.threadId, cursor, lastReply !== undefined);
      }
    }
  }

  private async docs(): Promise<void> {
    const { github, store, config } = this.deps;
    const head = await github.headCommit(await this.branch());
    const previous = store.getValue(KEY.head);
    if (previous === head) return;
    if (previous !== undefined) {
      const files = await github.changedFiles(previous, head);
      const { specs, design, design_system } = config.paths;
      const groups = {
        spec: files.filter((f) => isUnder(f, specs)),
        design: files.filter(
          (f) => isUnder(f, design) || isUnder(f, design_system),
        ),
      };
      for (const stage of ["spec", "design"] as const) {
        if (groups[stage].length === 0) continue;
        store.addEvent(`docs:${stage}:${head}`, {
          type: "docs_changed",
          stage,
          commit: head,
          files: groups[stage],
        });
      }
    }
    store.setValue(KEY.head, head);
  }

  private async pullRequests(): Promise<PullRequest[]> {
    const { github, store, config } = this.deps;
    const open = await github.openPullRequests();
    const previous = readJson<Record<string, PrSnapshot>>(store, KEY.prs);
    const next: Record<string, PrSnapshot> = {};

    for (const pr of open) {
      const stage = stageOf(pr.files, config.paths);
      const before = previous?.[String(pr.number)];
      next[String(pr.number)] = {
        title: pr.title,
        branch: pr.branch,
        stage,
        headSha: pr.headSha,
        updatedAt: pr.updatedAt,
        ci: pr.ci,
      };
      // 初めて確かめたときは、今ある PR を出来事にせず、様子だけを覚える
      if (previous === undefined) continue;

      const base = {
        type: "pr_changed",
        number: pr.number,
        title: pr.title,
        stage,
        branch: pr.branch,
      } as const;
      if (!before) {
        const added = store.addEvent(`pr:${String(pr.number)}:opened`, {
          ...base,
          change: "opened",
        });
        if (added) {
          await this.notify(
            `PR を作成しました: #${String(pr.number)} ${pr.title}\n${pr.url}`,
          );
        }
      } else if (before.headSha !== pr.headSha) {
        store.addEvent(`pr:${String(pr.number)}:updated:${pr.headSha}`, {
          ...base,
          change: "updated",
        });
      }
      if (
        (pr.ci === "pass" || pr.ci === "fail") &&
        (before?.ci !== pr.ci || before.headSha !== pr.headSha)
      ) {
        store.addEvent(`ci:${String(pr.number)}:${pr.headSha}:${pr.ci}`, {
          type: "ci_changed",
          number: pr.number,
          status: pr.ci,
        });
      }
      if (!before || before.updatedAt !== pr.updatedAt) {
        await this.comments(pr.number);
      }
    }

    for (const [number, before] of Object.entries(previous ?? {})) {
      if (next[number]) continue;
      const pr = await github.pullRequest(Number(number));
      if (pr.state === "open") {
        // 一覧から漏れただけなので、前の様子を残す
        next[number] = before;
        continue;
      }
      await this.comments(pr.number);
      const added = store.addEvent(`pr:${number}:${pr.state}`, {
        type: "pr_changed",
        number: pr.number,
        title: pr.title,
        stage: before.stage,
        branch: pr.branch,
        change: pr.state,
      });
      if (added && pr.state === "merged") {
        await this.notify(
          `PR がマージされました: #${number} ${pr.title}\n${pr.url}`,
        );
      }
    }
    store.setValue(KEY.prs, JSON.stringify(next));
    return open;
  }

  /** PR の新しいコメントを出来事にする。エージェントが書いたコメントは出来事にしない */
  private async comments(pr: number): Promise<void> {
    const { github, store } = this.deps;
    for (const c of await github.comments(pr)) {
      if (c.body.includes(AGENT_MARKER)) continue;
      store.addEvent(`comment:${String(pr)}:${c.id}`, {
        type: "pr_comment",
        number: pr,
        author: c.author,
        body: c.body,
        path: c.path,
      });
    }
  }

  private async issues(): Promise<Issue[]> {
    const { github, store } = this.deps;
    const open = await github.openIssues();
    const previous = readJson<Record<string, IssueSnapshot>>(store, KEY.issues);
    const next: Record<string, IssueSnapshot> = {};

    for (const issue of open) {
      const n = String(issue.number);
      next[n] = { title: issue.title, updatedAt: issue.updatedAt };
      if (previous === undefined) continue;
      const before = previous[n];
      if (!before) {
        store.addEvent(`issue:${n}:opened:${issue.updatedAt}`, {
          type: "issue_changed",
          number: issue.number,
          title: issue.title,
          change: "opened",
        });
      } else if (before.updatedAt !== issue.updatedAt) {
        store.addEvent(`issue:${n}:updated:${issue.updatedAt}`, {
          type: "issue_changed",
          number: issue.number,
          title: issue.title,
          change: "updated",
        });
      }
    }

    for (const [n, before] of Object.entries(previous ?? {})) {
      if (next[n]) continue;
      const issue = await github.issue(Number(n));
      if (issue.state === "open") {
        next[n] = before;
        continue;
      }
      store.addEvent(`issue:${n}:closed:${issue.updatedAt}`, {
        type: "issue_changed",
        number: issue.number,
        title: issue.title,
        change: "closed",
      });
    }
    store.setValue(KEY.issues, JSON.stringify(next));
    return open;
  }
}
