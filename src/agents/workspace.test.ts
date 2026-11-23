import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeWorkspace,
  GitWorkspace,
  parseEntryName,
  worktreeRoot,
} from "./workspace.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

/** origin（bare）と、その clone を作る */
function setup() {
  const base = mkdtempSync(join(tmpdir(), "tasuki-ws-"));
  const origin = join(base, "origin.git");
  const repo = join(base, "repo");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, repo], { stdio: "ignore" });
  git(repo, "config", "user.email", "test@example.test");
  git(repo, "config", "user.name", "test");
  git(repo, "config", "core.autocrlf", "false");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "first");
  git(repo, "push", "-q", "origin", "HEAD:main");
  const workspace = new GitWorkspace(repo, join(base, "worktrees"), "main");
  /** origin に、別の人としてコミットを足す */
  const pushTo = (branch: string, file: string, content: string) => {
    const other = mkdtempSync(join(base, "other-"));
    execFileSync("git", ["clone", "-q", origin, other], { stdio: "ignore" });
    git(other, "config", "user.email", "o@example.test");
    git(other, "config", "user.name", "other");
    try {
      git(other, "checkout", "-q", branch);
    } catch {
      git(other, "checkout", "-q", "-b", branch);
    }
    writeFileSync(join(other, file), content);
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", `change ${file}`);
    git(other, "push", "-q", "origin", branch);
  };
  return { base, repo, workspace, pushTo };
}

describe("GitWorkspace", () => {
  it("Issue には対象ごとの worktree を作り、次の実行でも続きを残す", async () => {
    const { workspace, pushTo } = setup();
    const target = { kind: "issue", number: 3 } as const;
    const first = await workspace.prepare(target, "write");
    expect(first.branch).toBeNull();
    expect(first.dirty).toBe(false);
    expect(first.cwd).toMatch(/issue-3$/);
    expect(readFileSync(join(first.cwd, "a.txt"), "utf8")).toBe("one\n");

    git(first.cwd, "checkout", "-q", "-b", "tasuki/issue-3");
    writeFileSync(join(first.cwd, "b.txt"), "wip\n");
    pushTo("main", "c.txt", "new\n");

    const second = await workspace.prepare(target, "write");
    expect(second).toEqual({
      cwd: first.cwd,
      branch: "tasuki/issue-3",
      dirty: true,
    });
    // origin の最新は取り込んである（取り出してはいない）
    expect(git(second.cwd, "show", "origin/main:c.txt")).toBe("new");
  });

  it("PR の修正は、そのブランチを取り出している worktree で続ける", async () => {
    const { workspace, pushTo } = setup();
    const issue = await workspace.prepare(
      { kind: "issue", number: 3 },
      "write",
    );
    git(issue.cwd, "checkout", "-q", "-b", "tasuki/issue-3");
    writeFileSync(join(issue.cwd, "b.txt"), "done\n");
    git(issue.cwd, "add", "-A");
    git(
      issue.cwd,
      "-c",
      "user.email=a@example.test",
      "-c",
      "user.name=a",
      "commit",
      "-q",
      "-m",
      "b",
    );
    git(issue.cwd, "push", "-q", "origin", "tasuki/issue-3");
    pushTo("tasuki/issue-3", "human.txt", "fix\n");

    const pr = await workspace.prepare(
      { kind: "pr", number: 7 },
      "write",
      "tasuki/issue-3",
    );
    expect(pr.cwd).toBe(issue.cwd);
    expect(pr.branch).toBe("tasuki/issue-3");
    // 人が push したコミットを取り込んである
    expect(readFileSync(join(pr.cwd, "human.txt"), "utf8")).toBe("fix\n");
  });

  it("どこにも取り出されていない PR のブランチは、新しい worktree に取り出す", async () => {
    const { workspace, pushTo } = setup();
    pushTo("feature/by-human", "h.txt", "x\n");
    const pr = await workspace.prepare(
      { kind: "pr", number: 9 },
      "write",
      "feature/by-human",
    );
    expect(pr.cwd).toMatch(/pr-9$/);
    expect(pr.branch).toBe("feature/by-human");
    expect(readFileSync(join(pr.cwd, "h.txt"), "utf8")).toBe("x\n");
  });

  it("読むだけの役には、確かめたいコミットをブランチなしで取り出す", async () => {
    const { workspace, pushTo } = setup();
    pushTo("tasuki/issue-3", "b.txt", "v1\n");
    const target = { kind: "pr", number: 7 } as const;
    const review = await workspace.prepare(target, "read", "tasuki/issue-3");
    expect(review.cwd).toMatch(/read-pr-7$/);
    expect(review.branch).toBeNull();
    expect(readFileSync(join(review.cwd, "b.txt"), "utf8")).toBe("v1\n");

    pushTo("tasuki/issue-3", "b.txt", "v2\n");
    const again = await workspace.prepare(target, "read", "tasuki/issue-3");
    expect(readFileSync(join(again.cwd, "b.txt"), "utf8")).toBe("v2\n");

    const planner = await workspace.prepare({ kind: "repo" }, "read");
    expect(planner.cwd).toMatch(/read-repo$/);
  });
});

describe("準備コマンド", () => {
  /** 実行した回数を count.txt に足していく準備コマンド */
  const COUNT =
    "node -e \"const fs=require('fs');fs.appendFileSync('count.txt','x')\"";
  const count = (cwd: string) =>
    readFileSync(join(cwd, "count.txt"), "utf8").length;

  function withSetup(commands: string[], onChange: string[] = []) {
    const s = setup();
    const workspace = new GitWorkspace(
      s.repo,
      join(s.base, "worktrees"),
      "main",
      undefined,
      { commands, onChange },
    );
    return { ...s, workspace };
  }

  it("作業フォルダを初めて用意したときだけ実行する", async () => {
    const { workspace } = withSetup([COUNT]);
    const target = { kind: "issue", number: 3 } as const;
    const first = await workspace.prepare(target, "write");
    expect(first.setup).toEqual({ commands: [COUNT] });
    expect(count(first.cwd)).toBe(1);

    const second = await workspace.prepare(target, "write");
    expect(second.setup).toBeUndefined();
    expect(count(second.cwd)).toBe(1);
  });

  it("読むだけの役の作業フォルダでも実行する", async () => {
    const { workspace } = withSetup([COUNT]);
    const review = await workspace.prepare({ kind: "repo" }, "read");
    expect(review.setup).toEqual({ commands: [COUNT] });
    expect(count(review.cwd)).toBe(1);
  });

  it("見張るファイルが変わったら、もう一度実行する", async () => {
    const { workspace, pushTo } = withSetup([COUNT], ["a.txt"]);
    const target = { kind: "repo" } as const;
    const first = await workspace.prepare(target, "read");
    expect(count(first.cwd)).toBe(1);
    await workspace.prepare(target, "read");
    expect(count(first.cwd)).toBe(1);

    pushTo("main", "a.txt", "two\n");
    const third = await workspace.prepare(target, "read");
    expect(third.setup).toEqual({ commands: [COUNT] });
    expect(count(first.cwd)).toBe(2);
  });

  it("失敗したら内容を返し、次の用意のときにもう一度実行する", async () => {
    const FAIL =
      "node -e \"console.error('依存を入れられません');process.exit(1)\"";
    const { workspace } = withSetup([COUNT, FAIL, COUNT]);
    const target = { kind: "issue", number: 3 } as const;
    const first = await workspace.prepare(target, "write");
    expect(first.setup?.error).toContain("が失敗しました");
    expect(first.setup?.error).toContain("依存を入れられません");
    // 失敗したコマンドのあとは実行しない
    expect(count(first.cwd)).toBe(1);

    const second = await workspace.prepare(target, "write");
    expect(second.setup?.error).toBeDefined();
    expect(count(second.cwd)).toBe(2);
  });

  it("準備コマンドが無ければ何もしない", async () => {
    const { workspace } = withSetup([]);
    const p = await workspace.prepare({ kind: "repo" }, "read");
    expect(p.setup).toBeUndefined();
  });
});

describe("作業フォルダの一覧と削除", () => {
  it("作業フォルダの名前・ブランチ・変更の有無を返し、消せる", async () => {
    const { workspace, repo } = setup();
    const issue = await workspace.prepare(
      { kind: "issue", number: 3 },
      "write",
    );
    git(issue.cwd, "checkout", "-q", "-b", "tasuki/issue-3");
    writeFileSync(join(issue.cwd, "a.txt"), "changed\n");
    // 追跡していないファイル（依存パッケージなど）は、変更に数えない
    writeFileSync(join(issue.cwd, "untracked.txt"), "x\n");
    const review = await workspace.prepare({ kind: "pr", number: 7 }, "read");

    const entries = await workspace.entries();
    expect(entries).toEqual([
      {
        name: "issue-3",
        cwd: issue.cwd,
        branch: "tasuki/issue-3",
        dirty: true,
      },
      { name: "read-pr-7", cwd: review.cwd, branch: null, dirty: false },
    ]);

    for (const e of entries) await workspace.remove(e);
    expect(await workspace.entries()).toEqual([]);
    expect(existsSync(issue.cwd)).toBe(false);
    expect(git(repo, "worktree", "list").split("\n")).toHaveLength(1);
    // 消したあと、同じ対象の作業フォルダを作り直せる
    const again = await workspace.prepare(
      { kind: "issue", number: 3 },
      "write",
    );
    expect(again.dirty).toBe(false);
  });

  it("消したら、準備コマンドは次に用意したときにもう一度実行する", async () => {
    const COUNT =
      "node -e \"const fs=require('fs');fs.appendFileSync('count.txt','x')\"";
    const s = setup();
    const workspace = new GitWorkspace(
      s.repo,
      join(s.base, "worktrees"),
      "main",
      undefined,
      { commands: [COUNT], onChange: [] },
    );
    const target = { kind: "repo" } as const;
    await workspace.prepare(target, "read");
    const [entry] = await workspace.entries();
    await workspace.remove(entry!);
    const again = await workspace.prepare(target, "read");
    expect(again.setup).toEqual({ commands: [COUNT] });
  });

  it("作業フォルダがまだ無ければ空を返す", async () => {
    expect(await setup().workspace.entries()).toEqual([]);
  });
});

describe("parseEntryName", () => {
  it("名前から対象を読む", () => {
    expect(parseEntryName("issue-3")).toEqual({
      target: { kind: "issue", number: 3 },
      read: false,
    });
    expect(parseEntryName("read-pr-7")).toEqual({
      target: { kind: "pr", number: 7 },
      read: true,
    });
    expect(parseEntryName("requirement-1574335613631467533")).toEqual({
      target: { kind: "requirement", id: "1574335613631467533" },
      read: false,
    });
    expect(parseEntryName("read-repo")).toEqual({
      target: { kind: "repo" },
      read: true,
    });
  });
  it("知らない名前は読まない", () => {
    expect(parseEntryName("memo")).toBeUndefined();
    expect(parseEntryName("issue-abc")).toBeUndefined();
  });
});

describe("describeWorkspace", () => {
  it("ブランチと、残っている変更を伝える", () => {
    expect(
      describeWorkspace(
        { cwd: "/w", branch: "tasuki/issue-3", dirty: true },
        "main",
      ),
    ).toContain("今のブランチは tasuki/issue-3 です。コミットしていない変更");
    expect(
      describeWorkspace({ cwd: "/w", branch: null, dirty: false }, "main"),
    ).toContain("origin/main の最新から作業用のブランチを作ってください");
  });
  it("準備コマンドの結果を伝える", () => {
    const base = { cwd: "/w", branch: null, dirty: false };
    expect(
      describeWorkspace({ ...base, setup: { commands: ["npm ci"] } }, "main"),
    ).toContain("作業フォルダの準備（`npm ci`）は、Tasuki が実行済みです。");
    expect(
      describeWorkspace(
        {
          ...base,
          setup: {
            commands: ["npm ci"],
            error: "npm ci が失敗しました:\nE404",
          },
        },
        "main",
      ),
    ).toContain(
      "失敗しました。必要なら原因を確かめて、自分で実行してください。\nnpm ci が失敗しました:\nE404",
    );
    expect(describeWorkspace(base, "main")).not.toContain("準備");
  });
});

describe("worktreeRoot", () => {
  it("リポジトリごとの場所を返す", () => {
    expect(worktreeRoot("owner/name", "/home/u").replaceAll("\\", "/")).toBe(
      "/home/u/.tasuki/worktrees/owner__name",
    );
  });
});
