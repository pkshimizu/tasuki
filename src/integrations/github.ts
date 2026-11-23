/**
 * GitHub とのやり取り。gh コマンドで PR・Issue・CI・コメントを読み、マージを行う。
 * マージは CI が合格しているときだけ行う（プログラムで必ず守る）。
 */
import { type Config, isUnder, type Stage } from "../config/config.js";
import { commandExec, type Exec, run } from "./exec.js";

export type CiStatus = "pass" | "fail" | "pending" | "none";

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  author: string;
  branch: string;
  base: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
  headSha: string;
  updatedAt: string;
  ci: CiStatus;
  /** 失敗した CI の名前 */
  failedChecks: string[];
  mergeable: "mergeable" | "conflicting" | "unknown";
  files: string[];
  url: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  updatedAt: string;
  url: string;
}

export interface PrComment {
  /** 種類つきの ID（重複を防ぐキーに使う） */
  id: string;
  author: string;
  body: string;
  /** 行へのコメントのときのファイル */
  path: string | null;
  createdAt: string;
}

export type MergeResult = { merged: true } | { merged: false; reason: string };

export interface GitHub {
  defaultBranch(): Promise<string>;
  /** ブランチの先頭のコミット */
  headCommit(branch: string): Promise<string>;
  /** base から head までに変わったファイル */
  changedFiles(base: string, head: string): Promise<string[]>;
  openPullRequests(): Promise<PullRequest[]>;
  pullRequest(number: number): Promise<PullRequest>;
  comments(pr: number): Promise<PrComment[]>;
  openIssues(): Promise<Issue[]>;
  issue(number: number): Promise<Issue>;
  /** CI が合格していればマージする。していなければ理由を返す */
  mergePullRequest(number: number, requireCi: boolean): Promise<MergeResult>;
}

const PR_FIELDS =
  "number,title,body,author,headRefName,baseRefName,state,isDraft,headRefOid,updatedAt,statusCheckRollup,mergeable,files,url";
const ISSUE_FIELDS = "number,title,body,state,labels,updatedAt,url";

interface RawCheck {
  __typename?: string;
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string | null;
  state?: string;
}

interface RawPr {
  number: number;
  title: string;
  body: string;
  author: { login: string } | null;
  headRefName: string;
  baseRefName: string;
  state: string;
  isDraft: boolean;
  headRefOid: string;
  updatedAt: string;
  statusCheckRollup: RawCheck[] | null;
  mergeable: string;
  files: { path: string }[] | null;
  url: string;
}

interface RawIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: { name: string }[];
  updatedAt: string;
  url: string;
}

const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/** CI の結果をまとめる。1 つでも失敗なら fail、実行中があれば pending、無ければ none */
export function summarizeChecks(checks: RawCheck[] | null): {
  ci: CiStatus;
  failedChecks: string[];
} {
  if (!checks || checks.length === 0) return { ci: "none", failedChecks: [] };
  const failed: string[] = [];
  let pending = false;
  for (const c of checks) {
    const name = c.name ?? c.context ?? "(名前なし)";
    if (c.__typename === "StatusContext" || c.state !== undefined) {
      if (c.state === "PENDING" || c.state === "EXPECTED") pending = true;
      else if (c.state !== "SUCCESS") failed.push(name);
    } else if (c.status !== "COMPLETED") {
      pending = true;
    } else if (!PASSED.has(c.conclusion ?? "")) {
      failed.push(name);
    }
  }
  if (failed.length > 0) return { ci: "fail", failedChecks: failed };
  return { ci: pending ? "pending" : "pass", failedChecks: [] };
}

function toPr(raw: RawPr): PullRequest {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body,
    author: raw.author?.login ?? "",
    branch: raw.headRefName,
    base: raw.baseRefName,
    state:
      raw.state === "MERGED"
        ? "merged"
        : raw.state === "CLOSED"
          ? "closed"
          : "open",
    draft: raw.isDraft,
    headSha: raw.headRefOid,
    updatedAt: raw.updatedAt,
    ...summarizeChecks(raw.statusCheckRollup),
    mergeable:
      raw.mergeable === "MERGEABLE"
        ? "mergeable"
        : raw.mergeable === "CONFLICTING"
          ? "conflicting"
          : "unknown",
    files: (raw.files ?? []).map((f) => f.path),
    url: raw.url,
  };
}

function toIssue(raw: RawIssue): Issue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body,
    state: raw.state === "CLOSED" ? "closed" : "open",
    labels: raw.labels.map((l) => l.name),
    updatedAt: raw.updatedAt,
    url: raw.url,
  };
}

/**
 * PR の工程を、変えたファイルの置き場で決める。
 * 仕様の置き場だけなら仕様、デザインの置き場だけならデザイン、それ以外は実装。
 */
export function stageOf(files: string[], paths: Config["paths"]): Stage {
  if (files.length === 0) return "implementation";
  if (files.every((f) => isUnder(f, paths.specs))) return "spec";
  if (
    files.every(
      (f) => isUnder(f, paths.design) || isUnder(f, paths.design_system),
    )
  ) {
    return "design";
  }
  return "implementation";
}

/** 1 行に 1 つの JSON を読む（gh api --paginate --jq の出力） */
function jsonLines<T>(text: string): T[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

export class GhGitHub implements GitHub {
  constructor(
    private readonly repo: string,
    private readonly exec: Exec = commandExec("gh"),
  ) {}

  private gh(args: string[]): Promise<string> {
    return run(this.exec, "gh", args);
  }

  private async api<T>(path: string, jq: string): Promise<T[]> {
    return jsonLines<T>(
      await this.gh([
        "api",
        `repos/${this.repo}/${path}`,
        "--paginate",
        "--jq",
        jq,
      ]),
    );
  }

  async defaultBranch(): Promise<string> {
    const out = await this.gh([
      "api",
      `repos/${this.repo}`,
      "--jq",
      ".default_branch",
    ]);
    return out.trim();
  }

  async headCommit(branch: string): Promise<string> {
    const out = await this.gh([
      "api",
      `repos/${this.repo}/commits/${branch}`,
      "--jq",
      ".sha",
    ]);
    return out.trim();
  }

  async changedFiles(base: string, head: string): Promise<string[]> {
    const out = await this.gh([
      "api",
      `repos/${this.repo}/compare/${base}...${head}`,
      "--jq",
      ".files[].filename",
    ]);
    return out.split(/\r?\n/).filter((l) => l.length > 0);
  }

  async openPullRequests(): Promise<PullRequest[]> {
    const out = await this.gh([
      "pr",
      "list",
      "--repo",
      this.repo,
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      PR_FIELDS,
    ]);
    return (JSON.parse(out) as RawPr[])
      .map(toPr)
      .sort((a, b) => a.number - b.number);
  }

  async pullRequest(number: number): Promise<PullRequest> {
    const out = await this.gh([
      "pr",
      "view",
      String(number),
      "--repo",
      this.repo,
      "--json",
      PR_FIELDS,
    ]);
    return toPr(JSON.parse(out) as RawPr);
  }

  async comments(pr: number): Promise<PrComment[]> {
    const n = String(pr);
    const shape = (kind: string, path: string, time: string) =>
      `.[] | {id: ("${kind}:" + (.id | tostring)), author: .user.login, body: (.body // ""), path: ${path}, createdAt: ${time}}`;
    const [general, inline, reviews] = await Promise.all([
      this.api<PrComment>(
        `issues/${n}/comments`,
        shape("comment", "null", ".created_at"),
      ),
      this.api<PrComment>(
        `pulls/${n}/comments`,
        shape("line", ".path", ".created_at"),
      ),
      this.api<PrComment>(
        `pulls/${n}/reviews`,
        shape("review", "null", ".submitted_at"),
      ),
    ]);
    return [...general, ...inline, ...reviews]
      .filter((c) => c.body.trim().length > 0)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async openIssues(): Promise<Issue[]> {
    const out = await this.gh([
      "issue",
      "list",
      "--repo",
      this.repo,
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      ISSUE_FIELDS,
    ]);
    return (JSON.parse(out) as RawIssue[])
      .map(toIssue)
      .sort((a, b) => a.number - b.number);
  }

  async issue(number: number): Promise<Issue> {
    const out = await this.gh([
      "issue",
      "view",
      String(number),
      "--repo",
      this.repo,
      "--json",
      ISSUE_FIELDS,
    ]);
    return toIssue(JSON.parse(out) as RawIssue);
  }

  async mergePullRequest(
    number: number,
    requireCi: boolean,
  ): Promise<MergeResult> {
    // マージの直前に、今の様子を読み直して確かめる
    const pr = await this.pullRequest(number);
    const refuse = mergeProblem(pr, requireCi);
    if (refuse) return { merged: false, reason: refuse };
    const result = await this.exec([
      "pr",
      "merge",
      String(number),
      "--repo",
      this.repo,
      "--squash",
      "--delete-branch",
      "--match-head-commit",
      pr.headSha,
    ]);
    if (result.code !== 0) {
      return {
        merged: false,
        reason: `gh pr merge が失敗しました: ${result.stderr.trim().slice(0, 500)}`,
      };
    }
    return { merged: true };
  }
}

/** マージできない理由。マージしてよければ undefined */
export function mergeProblem(
  pr: PullRequest,
  requireCi: boolean,
): string | undefined {
  if (pr.state !== "open") return "PR が開いていません";
  if (pr.draft) return "PR が下書きです";
  if (pr.mergeable === "conflicting") {
    return `${pr.base} と衝突しています`;
  }
  if (pr.ci === "fail") {
    return `CI が失敗しています（${pr.failedChecks.join("、")}）`;
  }
  if (pr.ci === "pending") return "CI が実行中です";
  if (pr.ci === "none" && requireCi) {
    return "CI の結果がまだありません（CI の無いリポジトリでは merge.require_ci を false にします）";
  }
  return undefined;
}
