/**
 * 記録。出来事・読んだ位置・要件・質問スレッド・エージェントの実行・司令塔の判断を
 * PC 内の SQLite に置き、再起動しても続きから進められるようにする。
 * 段階や回数は記録しない（今の状況は毎回 GitHub と Discord から読む）。
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Role, Stage } from "../config/config.js";
import type {
  Finding,
  FindingResponse,
  NewFinding,
  Resolution,
  Review,
} from "../domain/review.js";
import type {
  EventPayload,
  RunStatus,
  Target,
  TasukiEvent,
  WorkerRole,
} from "../domain/types.js";

export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

export interface Requirement {
  id: string;
  author: string;
  content: string;
  status: "open" | "done";
  createdAt: string;
}

export interface Question {
  threadId: string;
  title: string;
  body: string;
  target: Target | null;
  /** どの役からの質問か（司令塔からなら dispatcher）。古い記録では null */
  origin: Role | null;
  /** 最後に読んだ投稿の ID */
  lastReadId: string | null;
  /** 人の返信を 1 度でも読んだか */
  answered: boolean;
  createdAt: string;
}

export interface Run {
  id: number;
  role: WorkerRole;
  target: Target;
  instruction: string;
  /** どの要件のための実行か。分からなければ null */
  requirement: string | null;
  status: RunStatus | "running";
  summary: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** 記録に残す PR の様子 */
export interface StoredPullRequest {
  number: number;
  title: string;
  branch: string;
  stage: Stage;
  state: "open" | "merged" | "closed";
  url: string;
  updatedAt: string;
}

export interface Decision {
  id: number;
  /** 判断のもとになった出来事の要約 */
  events: string[];
  reasoning: string;
  /** 指示の一覧（JSON にできる形） */
  actions: unknown[];
  createdAt: string;
}

export interface Store {
  /** 出来事を足す。同じキーの出来事が既にあれば足さずに false を返す */
  addEvent(key: string, payload: EventPayload): boolean;
  /** まだ司令塔に渡していない出来事（古い順） */
  pendingEvents(): TasukiEvent[];
  markHandled(ids: number[]): void;
  /** 最近の出来事（新しい順）。司令塔に渡したかどうかを添える */
  recentEvents(limit: number): (TasukiEvent & { handled: boolean })[];

  /** 読んだ位置や前回の様子など、名前で引く値 */
  getValue(name: string): string | undefined;
  setValue(name: string, value: string): void;

  addRequirement(input: Omit<Requirement, "status" | "createdAt">): void;
  requirements(status?: Requirement["status"]): Requirement[];
  completeRequirement(id: string): boolean;

  addQuestion(
    input: Omit<Question, "lastReadId" | "answered" | "createdAt">,
  ): void;
  questions(): Question[];
  /** 読んだ位置を進める。answered が true なら、返信ありにする */
  setQuestionRead(
    threadId: string,
    lastReadId: string,
    answered: boolean,
  ): void;

  startRun(input: {
    role: WorkerRole;
    target: Target;
    instruction: string;
    requirement?: string | null | undefined;
  }): number;
  finishRun(id: number, status: RunStatus, summary: string): void;
  /** 実行が、どの要件のためのものかを入れる */
  setRunRequirement(id: number, requirement: string): void;
  runningRuns(): Run[];
  recentRuns(limit: number): Run[];
  run(id: number): Run | undefined;

  /** PR の様子を覚える（閉じたあとも管理画面に出すため） */
  savePullRequest(pr: StoredPullRequest): void;
  pullRequests(): StoredPullRequest[];

  addDecision(input: Omit<Decision, "id" | "createdAt">): void;
  recentDecisions(limit: number): Decision[];

  /**
   * レビューの結果を記録する。回の番号と、新しい指摘の通し番号を振り、
   * 前の周の指摘に解消判定を反映する。
   */
  addReview(input: {
    pr: number;
    sha: string;
    verdict: Review["verdict"];
    runId: number;
    findings: NewFinding[];
    resolutions: Resolution[];
  }): { review: Review; firstNumber: number };
  /** 修正する役が返した、指摘ごとの対応を反映する */
  applyResponses(pr: number, responses: FindingResponse[]): void;
  /** PR のレビュー（古い順） */
  reviews(pr: number): Review[];
  /** PR の指摘（番号の順） */
  findings(pr: number): Finding[];

  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  handled_at TEXT
);
CREATE TABLE IF NOT EXISTS kv (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  thread_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target TEXT,
  last_read_id TEXT,
  answered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  target TEXT NOT NULL,
  instruction TEXT NOT NULL,
  requirement TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  summary TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS reviews (
  pr INTEGER NOT NULL,
  round INTEGER NOT NULL,
  sha TEXT NOT NULL,
  verdict TEXT NOT NULL,
  run_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pr, round)
);
CREATE TABLE IF NOT EXISTS findings (
  pr INTEGER NOT NULL,
  number INTEGER NOT NULL,
  round INTEGER NOT NULL,
  severity TEXT NOT NULL,
  file TEXT,
  line INTEGER,
  problem TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (pr, number)
);
CREATE TABLE IF NOT EXISTS pull_requests (
  number INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  branch TEXT NOT NULL,
  stage TEXT NOT NULL,
  state TEXT NOT NULL,
  url TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  events TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  actions TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

function toRun(r: Row): Run {
  return {
    id: r.id as number,
    role: r.role as WorkerRole,
    target: JSON.parse(r.target as string) as Target,
    instruction: r.instruction as string,
    requirement: (r.requirement as string | null) ?? null,
    status: r.status as Run["status"],
    summary: (r.summary as string | null) ?? null,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string | null) ?? null,
  };
}

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  /** file に ":memory:" を渡すとメモリ上に作る（テスト用） */
  constructor(
    file: string,
    private readonly clock: Clock = systemClock,
  ) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** 前の版で作った記録に、あとから足した列を足す */
  private migrate(): void {
    const has = (table: string, column: string) =>
      (
        this.db.prepare(`PRAGMA table_info(${table})`).all() as {
          name: string;
        }[]
      ).some((c) => c.name === column);
    if (!has("questions", "origin")) {
      this.db.exec("ALTER TABLE questions ADD COLUMN origin TEXT");
    }
    if (!has("runs", "requirement")) {
      this.db.exec("ALTER TABLE runs ADD COLUMN requirement TEXT");
    }
  }

  private now(): string {
    return this.clock.now().toISOString();
  }

  addEvent(key: string, payload: EventPayload): boolean {
    const r = this.db
      .prepare(
        "INSERT OR IGNORE INTO events (key, payload, created_at) VALUES (?, ?, ?)",
      )
      .run(key, JSON.stringify(payload), this.now());
    return Number(r.changes) > 0;
  }

  pendingEvents(): TasukiEvent[] {
    const rows = this.db
      .prepare(
        "SELECT id, key, payload, created_at FROM events WHERE handled_at IS NULL ORDER BY id",
      )
      .all() as Row[];
    return rows.map((r) => ({
      id: r.id as number,
      key: r.key as string,
      payload: JSON.parse(r.payload as string) as EventPayload,
      createdAt: r.created_at as string,
    }));
  }

  recentEvents(limit: number): (TasukiEvent & { handled: boolean })[] {
    const rows = this.db
      .prepare(
        "SELECT id, key, payload, created_at, handled_at FROM events ORDER BY id DESC LIMIT ?",
      )
      .all(limit) as Row[];
    return rows.map((r) => ({
      id: r.id as number,
      key: r.key as string,
      payload: JSON.parse(r.payload as string) as EventPayload,
      createdAt: r.created_at as string,
      handled: r.handled_at !== null,
    }));
  }

  markHandled(ids: number[]): void {
    const stmt = this.db.prepare(
      "UPDATE events SET handled_at = ? WHERE id = ? AND handled_at IS NULL",
    );
    const now = this.now();
    for (const id of ids) stmt.run(now, id);
  }

  getValue(name: string): string | undefined {
    const r = this.db.prepare("SELECT value FROM kv WHERE name = ?").get(name);
    return r?.value as string | undefined;
  }

  setValue(name: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO kv (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
      )
      .run(name, value);
  }

  addRequirement(input: Omit<Requirement, "status" | "createdAt">): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO requirements (id, author, content, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(input.id, input.author, input.content, this.now());
  }

  requirements(status?: Requirement["status"]): Requirement[] {
    const rows = (
      status
        ? this.db
            .prepare(
              "SELECT * FROM requirements WHERE status = ? ORDER BY created_at, id",
            )
            .all(status)
        : this.db
            .prepare("SELECT * FROM requirements ORDER BY created_at, id")
            .all()
    ) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      author: r.author as string,
      content: r.content as string,
      status: r.status as Requirement["status"],
      createdAt: r.created_at as string,
    }));
  }

  completeRequirement(id: string): boolean {
    const r = this.db
      .prepare("UPDATE requirements SET status = 'done' WHERE id = ?")
      .run(id);
    return Number(r.changes) > 0;
  }

  addQuestion(
    input: Omit<Question, "lastReadId" | "answered" | "createdAt">,
  ): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO questions (thread_id, title, body, target, origin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.threadId,
        input.title,
        input.body,
        input.target ? JSON.stringify(input.target) : null,
        input.origin,
        this.now(),
      );
  }

  questions(): Question[] {
    const rows = this.db
      .prepare("SELECT * FROM questions ORDER BY created_at, thread_id")
      .all() as Row[];
    return rows.map((r) => ({
      threadId: r.thread_id as string,
      title: r.title as string,
      body: r.body as string,
      target: r.target ? (JSON.parse(r.target as string) as Target) : null,
      origin: (r.origin as Role | null) ?? null,
      lastReadId: (r.last_read_id as string | null) ?? null,
      answered: r.answered === 1,
      createdAt: r.created_at as string,
    }));
  }

  setQuestionRead(
    threadId: string,
    lastReadId: string,
    answered: boolean,
  ): void {
    this.db
      .prepare(
        "UPDATE questions SET last_read_id = ?, answered = MAX(answered, ?) WHERE thread_id = ?",
      )
      .run(lastReadId, answered ? 1 : 0, threadId);
  }

  startRun(input: {
    role: WorkerRole;
    target: Target;
    instruction: string;
    requirement?: string | null | undefined;
  }): number {
    const r = this.db
      .prepare(
        "INSERT INTO runs (role, target, instruction, requirement, started_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        input.role,
        JSON.stringify(input.target),
        input.instruction,
        input.requirement ?? null,
        this.now(),
      );
    return Number(r.lastInsertRowid);
  }

  finishRun(id: number, status: RunStatus, summary: string): void {
    this.db
      .prepare(
        "UPDATE runs SET status = ?, summary = ?, finished_at = ? WHERE id = ?",
      )
      .run(status, summary, this.now(), id);
  }

  setRunRequirement(id: number, requirement: string): void {
    this.db
      .prepare("UPDATE runs SET requirement = ? WHERE id = ?")
      .run(requirement, id);
  }

  runningRuns(): Run[] {
    return (
      this.db
        .prepare("SELECT * FROM runs WHERE status = 'running' ORDER BY id")
        .all() as Row[]
    ).map(toRun);
  }

  recentRuns(limit: number): Run[] {
    return (
      this.db
        .prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ?")
        .all(limit) as Row[]
    )
      .map(toRun)
      .reverse();
  }

  run(id: number): Run | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as
      Row | undefined;
    return row ? toRun(row) : undefined;
  }

  savePullRequest(pr: StoredPullRequest): void {
    this.db
      .prepare(
        `INSERT INTO pull_requests (number, title, branch, stage, state, url, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(number) DO UPDATE SET title = excluded.title, branch = excluded.branch,
           stage = excluded.stage, state = excluded.state, url = excluded.url,
           updated_at = excluded.updated_at`,
      )
      .run(
        pr.number,
        pr.title,
        pr.branch,
        pr.stage,
        pr.state,
        pr.url,
        pr.updatedAt,
      );
  }

  pullRequests(): StoredPullRequest[] {
    const rows = this.db
      .prepare("SELECT * FROM pull_requests ORDER BY number DESC")
      .all() as Row[];
    return rows.map((r) => ({
      number: r.number as number,
      title: r.title as string,
      branch: r.branch as string,
      stage: r.stage as Stage,
      state: r.state as StoredPullRequest["state"],
      url: r.url as string,
      updatedAt: r.updated_at as string,
    }));
  }

  addDecision(input: Omit<Decision, "id" | "createdAt">): void {
    this.db
      .prepare(
        "INSERT INTO decisions (events, reasoning, actions, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        JSON.stringify(input.events),
        input.reasoning,
        JSON.stringify(input.actions),
        this.now(),
      );
  }

  recentDecisions(limit: number): Decision[] {
    const rows = this.db
      .prepare("SELECT * FROM decisions ORDER BY id DESC LIMIT ?")
      .all(limit) as Row[];
    return rows
      .map((r) => ({
        id: r.id as number,
        events: JSON.parse(r.events as string) as string[],
        reasoning: r.reasoning as string,
        actions: JSON.parse(r.actions as string) as unknown[],
        createdAt: r.created_at as string,
      }))
      .reverse();
  }

  addReview(input: {
    pr: number;
    sha: string;
    verdict: Review["verdict"];
    runId: number;
    findings: NewFinding[];
    resolutions: Resolution[];
  }): { review: Review; firstNumber: number } {
    const round = this.reviews(input.pr).length + 1;
    const existing = this.findings(input.pr);
    const firstNumber = Math.max(0, ...existing.map((f) => f.number)) + 1;
    const review: Review = {
      pr: input.pr,
      round,
      sha: input.sha,
      verdict: input.verdict,
      runId: input.runId,
      createdAt: this.now(),
    };
    this.db
      .prepare(
        "INSERT INTO reviews (pr, round, sha, verdict, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        review.pr,
        review.round,
        review.sha,
        review.verdict,
        review.runId,
        review.createdAt,
      );
    // 前の周の指摘に、解消判定を反映する（知らない番号は読み飛ばす）
    const update = this.db.prepare(
      "UPDATE findings SET status = ?, note = ? WHERE pr = ? AND number = ?",
    );
    for (const r of input.resolutions) {
      update.run(
        r.status === "resolved" ? "resolved" : "open",
        r.status === "worsened" ? `修正で悪くなった: ${r.note}` : r.note,
        input.pr,
        r.number,
      );
    }
    const insert = this.db.prepare(
      "INSERT INTO findings (pr, number, round, severity, file, line, problem, suggestion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    input.findings.forEach((f, i) => {
      insert.run(
        input.pr,
        firstNumber + i,
        round,
        f.severity,
        f.file,
        f.line,
        f.problem,
        f.suggestion,
      );
    });
    return { review, firstNumber };
  }

  applyResponses(pr: number, responses: FindingResponse[]): void {
    // 解消済みの指摘は、あとから来た対応の報告で開き直さない
    const update = this.db.prepare(
      "UPDATE findings SET status = ?, note = ? WHERE pr = ? AND number = ? AND status != 'resolved'",
    );
    for (const r of responses) update.run(r.action, r.note, pr, r.number);
  }

  reviews(pr: number): Review[] {
    const rows = this.db
      .prepare("SELECT * FROM reviews WHERE pr = ? ORDER BY round")
      .all(pr) as Row[];
    return rows.map((r) => ({
      pr: r.pr as number,
      round: r.round as number,
      sha: r.sha as string,
      verdict: r.verdict as Review["verdict"],
      runId: r.run_id as number,
      createdAt: r.created_at as string,
    }));
  }

  findings(pr: number): Finding[] {
    const rows = this.db
      .prepare("SELECT * FROM findings WHERE pr = ? ORDER BY number")
      .all(pr) as Row[];
    return rows.map((r) => ({
      pr: r.pr as number,
      number: r.number as number,
      round: r.round as number,
      severity: r.severity as Finding["severity"],
      file: (r.file as string | null) ?? null,
      line: (r.line as number | null) ?? null,
      problem: r.problem as string,
      suggestion: r.suggestion as string,
      status: r.status as Finding["status"],
      note: r.note as string,
    }));
  }

  close(): void {
    this.db.close();
  }
}

/** リポジトリごとの記録ファイルの場所 */
export function stateFile(repo: string, home: string = homedir()): string {
  return join(home, ".tasuki", "state", `${repo.replace("/", "__")}.db`);
}
