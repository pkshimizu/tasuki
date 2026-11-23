import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLES } from "../config/config.js";
import { testConfig } from "../testing/fixtures.js";
import {
  describeKnowledge,
  emptyKnowledge,
  FsSource,
  GitKnowledge,
  GitSource,
  knowledgePrompt,
  loadKnowledge,
  ROLE_KINDS,
} from "./knowledge.js";

const paths = testConfig().knowledge;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function write(dir: string, file: string, content: string) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
}

/** 文書を置いたフォルダ */
function docs() {
  const dir = mkdtempSync(join(tmpdir(), "tasuki-kn-"));
  write(dir, "docs/CONTEXT.md", "単語カードのアプリ\n");
  write(dir, "docs/ARCHITECTURE.md", "全体の構成\n");
  write(dir, "docs/architecture/2-db.md", "DB の構成\n");
  write(dir, "docs/architecture/1-web.md", "画面の構成\n");
  write(dir, "docs/architecture/sub/api.md", "API の構成\n");
  write(dir, "docs/architecture/diagram.png", "画像");
  write(dir, "docs/rules/implementation.md", "テストを先に書く\n");
  write(dir, "docs/review-perspectives/日本語の観点.md", "仕様どおりか\n");
  write(dir, "docs/rules/commit.md", "\n\n");
  return dir;
}

/** origin と、その clone */
function repo() {
  const base = mkdtempSync(join(tmpdir(), "tasuki-kn-git-"));
  const origin = join(base, "origin.git");
  const clone = join(base, "repo");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, clone], { stdio: "ignore" });
  git(clone, "config", "user.email", "t@example.test");
  git(clone, "config", "user.name", "t");
  git(clone, "config", "core.autocrlf", "false");
  const commit = (file: string, content: string) => {
    write(clone, file, content);
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", file);
    git(clone, "push", "-q", "origin", "HEAD:main");
  };
  return { clone, commit };
}

describe("loadKnowledge（作業フォルダから）", () => {
  it("ファイルとフォルダを読み、フォルダの中は .md を名前の順に読む", async () => {
    const k = await loadKnowledge(new FsSource(docs()), paths);
    expect(k.context).toEqual([
      { path: "docs/CONTEXT.md", content: "単語カードのアプリ" },
    ]);
    expect(k.architecture.map((d) => d.path)).toEqual([
      "docs/ARCHITECTURE.md",
      "docs/architecture/1-web.md",
      "docs/architecture/2-db.md",
      "docs/architecture/sub/api.md",
    ]);
    expect(k.review_perspectives.map((d) => d.path)).toEqual([
      "docs/review-perspectives/日本語の観点.md",
    ]);
  });

  it("無い文書と、中身が空の文書は読み飛ばす", async () => {
    const k = await loadKnowledge(new FsSource(docs()), paths);
    expect(k.spec_rules).toEqual([]);
    expect(k.merge_rules).toEqual([]);
    expect(k.commit_rules).toEqual([]);
  });

  it("同じファイルを 2 回指定しても 1 回だけ読む", async () => {
    const custom = testConfig(
      "knowledge:\n  architecture:\n    - docs/architecture\n    - docs/architecture/1-web.md\n",
    ).knowledge;
    const k = await loadKnowledge(new FsSource(docs()), custom);
    expect(k.architecture).toHaveLength(3);
  });
});

describe("GitSource", () => {
  it("コミットの中のファイルとフォルダを読む（日本語のファイル名も）", async () => {
    const { clone, commit } = repo();
    commit("docs/CONTEXT.md", "単語カードのアプリ\n");
    commit("docs/review-perspectives/2-コード.md", "コードの質\n");
    commit("docs/review-perspectives/1-仕様.md", "仕様どおりか\n");
    commit("docs/review-perspectives/memo.txt", "読まない\n");
    const source = new GitSource(clone, "origin/main");
    expect(await source.files("docs/CONTEXT.md")).toEqual(["docs/CONTEXT.md"]);
    expect(await source.files("docs/review-perspectives")).toEqual([
      "docs/review-perspectives/1-仕様.md",
      "docs/review-perspectives/2-コード.md",
    ]);
    expect(await source.files("docs/none.md")).toEqual([]);
    expect(await source.read("docs/review-perspectives/1-仕様.md")).toBe(
      "仕様どおりか\n",
    );
  });
});

describe("GitKnowledge", () => {
  it("既定のブランチの最新の内容を読み、変わっていなければ読み直さない", async () => {
    const { clone, commit } = repo();
    commit("docs/CONTEXT.md", "最初の背景\n");
    // 手元の作業フォルダの内容ではなく、origin の内容を読む
    write(clone, "docs/CONTEXT.md", "コミットしていない変更\n");
    const provider = new GitKnowledge(clone, "main", paths);
    const first = await provider.load();
    expect(first.context[0]!.content).toBe("最初の背景");
    expect(await provider.load()).toBe(first);

    git(clone, "checkout", "-q", "--", ".");
    commit("docs/CONTEXT.md", "直した背景\n");
    const second = await provider.load();
    expect(second).not.toBe(first);
    expect(second.context[0]!.content).toBe("直した背景");
  });
});

describe("knowledgePrompt", () => {
  const k = emptyKnowledge();
  for (const kind of Object.keys(k) as (keyof typeof k)[]) {
    k[kind].push({ path: `docs/${kind}.md`, content: `本文:${kind}` });
  }
  const kindsIn = (role: (typeof ROLES)[number]) =>
    (Object.keys(k) as (keyof typeof k)[]).filter((kind) =>
      knowledgePrompt(role, k).includes(`本文:${kind}`),
    );

  it("コンテキストとアーキテクチャは、すべての役に渡す", () => {
    for (const role of ROLES) {
      expect(kindsIn(role)).toEqual(
        expect.arrayContaining(["context", "architecture"]),
      );
    }
  });

  it("役ごとに決まった種類だけを渡す", () => {
    expect(kindsIn("spec-master")).toEqual([
      "context",
      "architecture",
      "spec_rules",
      "commit_rules",
      "pr_rules",
    ]);
    expect(kindsIn("planner")).toEqual([
      "context",
      "architecture",
      "task_rules",
    ]);
    expect(kindsIn("designer")).toEqual([
      "context",
      "architecture",
      "commit_rules",
      "pr_rules",
    ]);
    expect(kindsIn("programmer")).toEqual([
      "context",
      "architecture",
      "implementation_rules",
      "commit_rules",
      "pr_rules",
    ]);
    expect(kindsIn("reviewer")).toEqual([
      "context",
      "architecture",
      "review_perspectives",
    ]);
    expect(kindsIn("dispatcher")).toEqual([
      "context",
      "architecture",
      "merge_rules",
    ]);
  });

  it("種類の名前・使いどころ・ファイルの場所を添える", () => {
    const p = knowledgePrompt("dispatcher", k);
    expect(p).toContain("## プロダクトの情報");
    expect(p).toContain("### マージルール");
    expect(p).toContain("PR をマージしてよいかを判断するときに従います。");
    expect(p).toContain(
      '<document path="docs/merge_rules.md">\n本文:merge_rules\n</document>',
    );
  });

  it("渡すものが無ければ空", () => {
    expect(knowledgePrompt("programmer", emptyKnowledge())).toBe("");
    for (const role of ROLES)
      expect(ROLE_KINDS[role].length).toBeGreaterThan(0);
  });
});

describe("describeKnowledge", () => {
  it("種類ごとに、見つかった文書か、置き場を出す", async () => {
    const k = await loadKnowledge(new FsSource(docs()), paths);
    const lines = describeKnowledge(k, paths);
    expect(lines).toHaveLength(9);
    expect(lines[0]).toBe("  コンテキスト: docs/CONTEXT.md");
    expect(lines[2]).toBe(
      "  仕様作成ルール: なし（置き場: docs/rules/spec.md）",
    );
  });
});
