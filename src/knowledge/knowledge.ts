/**
 * 開発対象のプロダクトの情報（背景・アーキテクチャ・各種のルール）。
 * 対象リポジトリの文書を読み、役ごとに必要な種類の本文を、エージェントの指示に埋め込む。
 * エージェントを起動するたびに、既定のブランチの最新の内容を読む。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config, Role } from "../config/config.js";
import { commandExec, type Exec, run } from "../integrations/exec.js";

export const KNOWLEDGE_KINDS = [
  "context",
  "architecture",
  "spec_rules",
  "implementation_rules",
  "review_perspectives",
  "commit_rules",
  "task_rules",
  "pr_rules",
  "merge_rules",
] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** 種類の名前と、エージェントに伝える使いどころ */
export const KIND_LABELS: Record<KnowledgeKind, { name: string; use: string }> =
  {
    context: {
      name: "コンテキスト",
      use: "プロダクト全般の背景です。判断の前提にします",
    },
    architecture: {
      name: "アーキテクチャ",
      use: "プロダクトの構成です。これに沿って考えます",
    },
    spec_rules: { name: "仕様作成ルール", use: "仕様を書くときに従います" },
    implementation_rules: {
      name: "実装ルール",
      use: "実装とテストを書くときに従います",
    },
    review_perspectives: {
      name: "レビュー観点",
      use: "レビューするときに、この観点で確かめます",
    },
    commit_rules: { name: "コミットルール", use: "コミットするときに従います" },
    task_rules: {
      name: "タスク作成ルール",
      use: "Issue を作成・更新するときに従います",
    },
    pr_rules: { name: "プルリクルール", use: "PR を作るときに従います" },
    merge_rules: {
      name: "マージルール",
      use: "PR をマージしてよいかを判断するときに従います",
    },
  };

const SHARED: KnowledgeKind[] = ["context", "architecture"];
const COMMIT_AND_PR: KnowledgeKind[] = ["commit_rules", "pr_rules"];

/** 役ごとに渡す種類 */
export const ROLE_KINDS: Record<Role, KnowledgeKind[]> = {
  dispatcher: [...SHARED, "merge_rules"],
  "spec-master": [...SHARED, "spec_rules", ...COMMIT_AND_PR],
  planner: [...SHARED, "task_rules"],
  designer: [...SHARED, ...COMMIT_AND_PR],
  programmer: [...SHARED, "implementation_rules", ...COMMIT_AND_PR],
  reviewer: [...SHARED, "review_perspectives"],
};

export interface KnowledgeDoc {
  /** リポジトリからの相対パス */
  path: string;
  content: string;
}
export type Knowledge = Record<KnowledgeKind, KnowledgeDoc[]>;

export function emptyKnowledge(): Knowledge {
  return Object.fromEntries(
    KNOWLEDGE_KINDS.map((k) => [k, []]),
  ) as unknown as Knowledge;
}

/** 文書の読み出し元 */
export interface KnowledgeSource {
  /**
   * path がファイルならそのファイル、フォルダなら中の .md（下のフォルダも含む）を、名前の順に返す。
   * 無ければ空。
   */
  files(path: string): Promise<string[]>;
  read(path: string): Promise<string>;
}

function markdownOnly(files: string[]): string[] {
  return files.filter((f) => f.toLowerCase().endsWith(".md")).sort();
}

/** 作業フォルダのファイルから読む（tasuki check 用） */
export class FsSource implements KnowledgeSource {
  constructor(private readonly dir: string) {}

  files(path: string): Promise<string[]> {
    const full = join(this.dir, path);
    if (!existsSync(full)) return Promise.resolve([]);
    if (!statSync(full).isDirectory()) return Promise.resolve([path]);
    const found = (readdirSync(full, { recursive: true }) as string[])
      .map((f) => `${path}/${f.replaceAll("\\", "/")}`)
      .filter((f) => statSync(join(this.dir, f)).isFile());
    return Promise.resolve(markdownOnly(found));
  }

  read(path: string): Promise<string> {
    return Promise.resolve(readFileSync(join(this.dir, path), "utf8"));
  }
}

/** git のコミット（既定のブランチの先頭など）から読む */
export class GitSource implements KnowledgeSource {
  constructor(
    private readonly repoDir: string,
    private readonly ref: string,
    private readonly exec: Exec = commandExec("git"),
  ) {}

  async files(path: string): Promise<string[]> {
    const result = await this.exec([
      "-C",
      this.repoDir,
      "ls-tree",
      "-r",
      "-z",
      "--name-only",
      this.ref,
      "--",
      path,
    ]);
    if (result.code !== 0) return [];
    const found = result.stdout.split("\0").filter((f) => f.length > 0);
    // path そのものがファイルのときは、拡張子によらずそのファイルを返す
    if (found.length === 1 && found[0] === path) return found;
    return markdownOnly(found);
  }

  read(path: string): Promise<string> {
    return run(this.exec, "git", [
      "-C",
      this.repoDir,
      "show",
      `${this.ref}:${path}`,
    ]);
  }
}

/** 設定に書かれた置き場から、すべての種類の文書を読む。無い文書は読み飛ばす */
export async function loadKnowledge(
  source: KnowledgeSource,
  paths: Config["knowledge"],
): Promise<Knowledge> {
  const knowledge = emptyKnowledge();
  for (const kind of KNOWLEDGE_KINDS) {
    const seen = new Set<string>();
    for (const path of paths[kind]) {
      for (const file of await source.files(path)) {
        if (seen.has(file)) continue;
        seen.add(file);
        const content = (await source.read(file)).trim();
        if (content.length > 0) knowledge[kind].push({ path: file, content });
      }
    }
  }
  return knowledge;
}

export interface KnowledgeProvider {
  load(): Promise<Knowledge>;
  /** 最後に読み込んだ内容。まだ読み込んでいなければ undefined */
  current?(): LoadedKnowledge | undefined;
}

export interface LoadedKnowledge {
  /** 読み込んだコミット */
  commit: string;
  loadedAt: string;
  knowledge: Knowledge;
}

/**
 * 既定のブランチの最新の内容を読む。
 * 先頭のコミットが前回と同じなら、読み直さない。
 */
export class GitKnowledge implements KnowledgeProvider {
  private cache: LoadedKnowledge | undefined;

  constructor(
    private readonly repoDir: string,
    private readonly defaultBranch: string,
    private readonly paths: Config["knowledge"],
    private readonly exec: Exec = commandExec("git"),
  ) {}

  async load(): Promise<Knowledge> {
    const ref = `origin/${this.defaultBranch}`;
    // 取得に失敗しても、手元にある内容で続ける
    await this.exec(["-C", this.repoDir, "fetch", "origin", "--prune"]).catch(
      () => undefined,
    );
    const commit = (
      await run(this.exec, "git", ["-C", this.repoDir, "rev-parse", ref])
    ).trim();
    if (this.cache?.commit === commit) return this.cache.knowledge;
    const knowledge = await loadKnowledge(
      new GitSource(this.repoDir, commit, this.exec),
      this.paths,
    );
    this.cache = { commit, loadedAt: new Date().toISOString(), knowledge };
    return knowledge;
  }

  current(): LoadedKnowledge | undefined {
    return this.cache;
  }
}

/** 役に渡す種類の本文を、指示に埋め込む文にする。渡すものが無ければ空 */
export function knowledgePrompt(role: Role, knowledge: Knowledge): string {
  const sections: string[] = [];
  for (const kind of ROLE_KINDS[role]) {
    const docs = knowledge[kind];
    if (docs.length === 0) continue;
    const { name, use } = KIND_LABELS[kind];
    sections.push(
      [
        `### ${name}`,
        `${use}。`,
        ...docs.map(
          (d) => `<document path="${d.path}">\n${d.content}\n</document>`,
        ),
      ].join("\n\n"),
    );
  }
  if (sections.length === 0) return "";
  return [
    "## プロダクトの情報",
    "対象リポジトリで管理している文書です（既定のブランチの最新の内容）。この内容に従って作業します。上に書いた Tasuki の決まり（できないこと・結果の形）と食い違うときは、Tasuki の決まりを優先します。",
    ...sections,
  ].join("\n\n");
}

/** 種類ごとに見つかった文書を、人に見せる行にする（tasuki check 用） */
export function describeKnowledge(
  knowledge: Knowledge,
  paths: Config["knowledge"],
): string[] {
  return KNOWLEDGE_KINDS.map((kind) => {
    const docs = knowledge[kind];
    const found =
      docs.length > 0
        ? docs.map((d) => d.path).join("、")
        : `なし（置き場: ${paths[kind].join("、")}）`;
    return `  ${KIND_LABELS[kind].name}: ${found}`;
  });
}
