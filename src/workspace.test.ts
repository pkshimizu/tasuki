import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeWorkspace, GitWorkspace, worktreeRoot } from "./workspace.js";

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
});

describe("worktreeRoot", () => {
  it("リポジトリごとの場所を返す", () => {
    expect(worktreeRoot("owner/name", "/home/u").replaceAll("\\", "/")).toBe(
      "/home/u/.tasuki/worktrees/owner__name",
    );
  });
});
