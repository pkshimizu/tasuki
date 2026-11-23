/**
 * テスト用の偽の部品（Discord・GitHub・作業フォルダ・エージェント）と、それらを組み立てた監視スレッド。
 */
import type { z } from "zod";
import { Collector } from "../monitor/collector.js";
import type { LoadedConfig } from "../config/config.js";
import { Executor } from "../monitor/executor.js";
import {
  emptyKnowledge,
  type Knowledge,
  type KnowledgeProvider,
} from "../knowledge/knowledge.js";
import { Monitor } from "../monitor/monitor.js";
import { SqliteStore } from "../store/store.js";
import { testConfig } from "./fixtures.js";
import type { AgentOutcome, AgentRun, RunAgent } from "../agents/agent.js";
import type { DispatchDecision } from "../dispatcher/dispatcher.js";
import {
  type Chat,
  type ChatMessage,
  compareIds,
} from "../integrations/discord.js";
import type { GuardContext } from "../agents/guard.js";
import {
  type FileProposal,
  type GitHub,
  type Issue,
  type MergeResult,
  mergeProblem,
  type PrComment,
  type PullRequest,
  type RepoFile,
} from "../integrations/github.js";
import type { WorkerOutput } from "../agents/roles.js";
import { type Target, targetKey } from "../domain/types.js";
import type {
  Prepared,
  Workspace,
  WorkspaceEntry,
} from "../agents/workspace.js";

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

  threadUrl(threadId: string): string | undefined {
    return `https://discord.test/channels/g1/${threadId}`;
  }

  requirementUrl(messageId: string): string | undefined {
    return `https://discord.test/channels/g1/req/${messageId}`;
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

  /** 既定のブランチにあるファイル */
  files = new Map<string, RepoFile>();
  proposals: FileProposal[] = [];

  setFile(path: string, text: string): RepoFile {
    const file = { text, sha: `f${String(this.tick++)}` };
    this.files.set(path, file);
    return file;
  }

  fileOnDefault(path: string): Promise<RepoFile | undefined> {
    return Promise.resolve(this.files.get(path));
  }

  proposeFile(proposal: FileProposal) {
    if (this.files.get(proposal.path)?.sha !== proposal.sha) {
      return Promise.reject(new Error("409: ファイルが変わっています"));
    }
    this.proposals.push(proposal);
    const pr = this.addPr(proposal.title, [proposal.path], {
      branch: proposal.branch,
      body: proposal.body,
    });
    return Promise.resolve({ number: pr.number, url: pr.url });
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

/** 決めた文書を返す偽のプロダクトの情報 */
export class FakeKnowledge implements KnowledgeProvider {
  knowledge: Knowledge = emptyKnowledge();
  loads = 0;

  load(): Promise<Knowledge> {
    this.loads++;
    return Promise.resolve(this.knowledge);
  }
}

/** 作業フォルダを作らず、対象ごとの名前だけを返す偽の Workspace */
export class FakeWorkspace implements Workspace {
  prepared: { key: string; access: string; prBranch: string | undefined }[] =
    [];
  /** PR のブランチ → 共有する作業フォルダ */
  shared = new Map<string, string>();
  /** 今ある作業フォルダ（片付けのテスト用に、テストが入れる） */
  existing: WorkspaceEntry[] = [];
  removed: string[] = [];

  entries(): Promise<WorkspaceEntry[]> {
    return Promise.resolve([...this.existing]);
  }

  remove(entry: WorkspaceEntry): Promise<void> {
    this.existing = this.existing.filter((e) => e.name !== entry.name);
    this.removed.push(entry.name);
    return Promise.resolve();
  }

  prepare(
    target: Target,
    access: GuardContext["access"],
    prBranch?: string,
  ): Promise<Prepared> {
    const key = targetKey(target);
    this.prepared.push({ key, access, prBranch });
    const cwd =
      access !== "write"
        ? `/worktrees/read-${key}`
        : ((prBranch !== undefined ? this.shared.get(prBranch) : undefined) ??
          `/worktrees/${key}`);
    return Promise.resolve({ cwd, branch: prBranch ?? null, dirty: false });
  }
}

type Handler<T> = (
  run: AgentRun<z.ZodType>,
) => AgentOutcome<T> | Promise<AgentOutcome<T>>;

export function ok<T>(output: T): AgentOutcome<T> {
  return { kind: "ok", output, costUsd: 0, turns: 1 };
}

export function output(extra: Partial<WorkerOutput> = {}): WorkerOutput {
  return {
    status: "done",
    summary: "終えた",
    questions: [],
    pr: null,
    verdict: null,
    findings: [],
    resolutions: [],
    responses: [],
    rule_proposals: [],
    ...extra,
  };
}

/** 役ごとに決めた動きをする偽のエージェント */
export class ScriptedAgents {
  runs: AgentRun<z.ZodType>[] = [];
  dispatcher: Handler<DispatchDecision> = () =>
    ok({ reasoning: "何もしない", actions: [] });
  worker: Handler<WorkerOutput> = () => ok(output());

  readonly runAgent = ((run: AgentRun<z.ZodType>) => {
    this.runs.push(run);
    return Promise.resolve(
      run.name === "dispatcher" ? this.dispatcher(run) : this.worker(run),
    );
  }) as unknown as RunAgent;

  /** 役の名前ごとの起動した回数 */
  count(name: string): number {
    return this.runs.filter((r) => r.name === name).length;
  }
}

/** 偽の部品で監視スレッドを組み立てる */
export function harness(extraYaml = "") {
  const chat = new FakeChat();
  const github = new FakeGitHub();
  const store = new SqliteStore(":memory:");
  const agents = new ScriptedAgents();
  const logs: string[] = [];
  const log = (t: string) => logs.push(t);
  const loaded: LoadedConfig = {
    dir: "/repo",
    config: testConfig(extraYaml),
  };
  const knowledge = new FakeKnowledge();
  const collector = new Collector({
    chat,
    github,
    store,
    config: loaded.config,
    log,
  });
  const ref: { monitor?: Monitor } = {};
  const executor = new Executor({
    loaded,
    defaultBranch: "main",
    store,
    chat,
    github,
    runAgent: agents.runAgent,
    workspace: new FakeWorkspace(),
    knowledge,
    log,
    onFinish: () => ref.monitor?.wakeUp(),
  });
  const monitor = new Monitor({
    loaded,
    store,
    chat,
    collector,
    executor,
    runAgent: agents.runAgent,
    knowledge,
    log,
    sleep: () => new Promise((r) => setTimeout(r, 0)),
  });
  ref.monitor = monitor;
  return { chat, github, store, agents, executor, monitor, logs, knowledge };
}

/** 司令塔への依頼文から、新しい出来事の欄だけを取り出す */
export function newEvents(prompt: string): string {
  return prompt.split("## 進行中の要件")[0] ?? "";
}
