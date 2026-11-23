/**
 * テスト用の偽の Discord と GitHub。メモリ上に状態を持つ。
 */
import { type Chat, type ChatMessage, compareIds } from "./discord.js";
import {
  type GitHub,
  type Issue,
  type MergeResult,
  mergeProblem,
  type PrComment,
  type PullRequest,
} from "./github.js";

export class FakeChat implements Chat {
  requirements: ChatMessage[] = [];
  threads = new Map<
    string,
    { title: string; body: string; replies: ChatMessage[]; archived: boolean }
  >();
  notices: string[] = [];
  threadPosts: { threadId: string; text: string }[] = [];
  /** 次の呼び出しを失敗させる */
  failNext = false;
  private nextId = 1000;

  private id(): string {
    return String(this.nextId++);
  }

  private check() {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Discord に接続できません");
    }
  }

  /** 人が要件チャンネルに投稿する */
  postRequirement(content: string, authorName = "清水"): string {
    const id = this.id();
    this.requirements.push({ id, authorId: "u1", authorName, content });
    return id;
  }

  /** 人が質問スレッドに返信する */
  reply(threadId: string, content: string, authorName = "清水"): string {
    const id = this.id();
    this.threads
      .get(threadId)!
      .replies.push({ id, authorId: "u1", authorName, content });
    return id;
  }

  newRequirements(after: string | undefined) {
    this.check();
    const latest = this.requirements.at(-1)?.id;
    if (after === undefined) {
      return Promise.resolve({ messages: [], cursor: latest ?? "0" });
    }
    const messages = this.requirements.filter(
      (m) => compareIds(m.id, after) > 0,
    );
    return Promise.resolve({ messages, cursor: latest ?? after });
  }

  createQuestionThread(title: string, body: string): Promise<string> {
    this.check();
    const id = this.id();
    this.threads.set(id, { title, body, replies: [], archived: false });
    return Promise.resolve(id);
  }

  activeQuestionThreads(): Promise<Map<string, string | null>> {
    this.check();
    return Promise.resolve(
      new Map(
        [...this.threads]
          .filter(([, t]) => !t.archived)
          .map(([id, t]) => [id, t.replies.at(-1)?.id ?? null]),
      ),
    );
  }

  threadReplies(threadId: string, after: string | undefined) {
    this.check();
    const replies = this.threads.get(threadId)?.replies ?? [];
    const messages = replies.filter(
      (m) => after === undefined || compareIds(m.id, after) > 0,
    );
    return Promise.resolve({
      messages,
      cursor: replies.at(-1)?.id ?? after,
    });
  }

  postToThread(threadId: string, text: string): Promise<void> {
    this.threadPosts.push({ threadId, text });
    return Promise.resolve();
  }

  notify(text: string): Promise<void> {
    this.notices.push(text);
    return Promise.resolve();
  }
}

export class FakeGitHub implements GitHub {
  head = "c0";
  /** コミットごとの、前のコミットから変わったファイル */
  commits: { sha: string; files: string[] }[] = [{ sha: "c0", files: [] }];
  prs = new Map<number, PullRequest>();
  issueMap = new Map<number, Issue>();
  commentMap = new Map<number, PrComment[]>();
  merged: number[] = [];
  /** 次にこの操作を呼んだときに失敗させる */
  failOn: "headCommit" | "openPullRequests" | null = null;
  private nextNumber = 1;
  private tick = 0;

  private check(operation: "headCommit" | "openPullRequests") {
    if (this.failOn === operation) {
      this.failOn = null;
      throw new Error("GitHub に接続できません");
    }
  }

  private time(): string {
    return new Date(Date.UTC(2026, 10, 23, 0, 0, this.tick++)).toISOString();
  }

  /** 既定のブランチにコミットを足す */
  commit(files: string[]): string {
    const sha = `c${String(this.commits.length)}`;
    this.commits.push({ sha, files });
    this.head = sha;
    return sha;
  }

  addIssue(title: string, body = ""): Issue {
    const number = this.nextNumber++;
    const issue: Issue = {
      number,
      title,
      body,
      state: "open",
      labels: [],
      updatedAt: this.time(),
      url: `https://example.test/issues/${String(number)}`,
    };
    this.issueMap.set(number, issue);
    return issue;
  }

  updateIssue(number: number, change: Partial<Issue>): void {
    Object.assign(this.issueMap.get(number)!, change, {
      updatedAt: this.time(),
    });
  }

  addPr(title: string, files: string[], extra: Partial<PullRequest> = {}) {
    const number = this.nextNumber++;
    const pr: PullRequest = {
      number,
      title,
      body: "",
      author: "bot",
      branch: `tasuki/pr-${String(number)}`,
      base: "main",
      state: "open",
      draft: false,
      headSha: `h${String(number)}-1`,
      updatedAt: this.time(),
      ci: "pending",
      failedChecks: [],
      mergeable: "mergeable",
      files,
      url: `https://example.test/pull/${String(number)}`,
      ...extra,
    };
    this.prs.set(number, pr);
    return pr;
  }

  updatePr(number: number, change: Partial<PullRequest>): void {
    Object.assign(this.prs.get(number)!, change, { updatedAt: this.time() });
  }

  addComment(
    pr: number,
    body: string,
    author = "human",
    path: string | null = null,
  ) {
    const list = this.commentMap.get(pr) ?? [];
    list.push({
      id: `comment:${String(pr)}-${String(list.length + 1)}`,
      author,
      body,
      path,
      createdAt: this.time(),
    });
    this.commentMap.set(pr, list);
    this.updatePr(pr, {});
  }

  defaultBranch(): Promise<string> {
    return Promise.resolve("main");
  }

  headCommit(): Promise<string> {
    this.check("headCommit");
    return Promise.resolve(this.head);
  }

  changedFiles(base: string, head: string): Promise<string[]> {
    const from = this.commits.findIndex((c) => c.sha === base);
    const to = this.commits.findIndex((c) => c.sha === head);
    return Promise.resolve([
      ...new Set(this.commits.slice(from + 1, to + 1).flatMap((c) => c.files)),
    ]);
  }

  openPullRequests(): Promise<PullRequest[]> {
    this.check("openPullRequests");
    return Promise.resolve(
      [...this.prs.values()]
        .filter((p) => p.state === "open")
        .map((p) => ({ ...p })),
    );
  }

  pullRequest(number: number): Promise<PullRequest> {
    return Promise.resolve({ ...this.prs.get(number)! });
  }

  comments(pr: number): Promise<PrComment[]> {
    return Promise.resolve([...(this.commentMap.get(pr) ?? [])]);
  }

  openIssues(): Promise<Issue[]> {
    return Promise.resolve(
      [...this.issueMap.values()]
        .filter((i) => i.state === "open")
        .map((i) => ({ ...i })),
    );
  }

  issue(number: number): Promise<Issue> {
    return Promise.resolve({ ...this.issueMap.get(number)! });
  }

  mergePullRequest(number: number, requireCi: boolean): Promise<MergeResult> {
    const pr = this.prs.get(number);
    if (!pr)
      return Promise.resolve({ merged: false, reason: "PR がありません" });
    const reason = mergeProblem(pr, requireCi);
    if (reason) return Promise.resolve({ merged: false, reason });
    this.updatePr(number, { state: "merged" });
    this.merged.push(number);
    this.commit(pr.files);
    // PR の本文の Closes #n の Issue を閉じる
    for (const m of pr.body.matchAll(/Closes #(\d+)/g)) {
      const issue = this.issueMap.get(Number(m[1]));
      if (issue) this.updateIssue(issue.number, { state: "closed" });
    }
    return Promise.resolve({ merged: true });
  }
}
