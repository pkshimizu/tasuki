/**
 * エージェントの作業フォルダ（git worktree）を用意する。
 * ファイルを書く役は対象ごとの worktree で、読むだけの役は確かめたいコミットを取り出した worktree で動かす。
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { commandExec, type Exec, run } from "../integrations/exec.js";
import type { GuardContext } from "./guard.js";
import { type Target, targetKey } from "../domain/types.js";

export interface Prepared {
  /** 作業フォルダ */
  cwd: string;
  /** 今のブランチ。ブランチに居なければ null */
  branch: string | null;
  /** コミットしていない変更があるか */
  dirty: boolean;
}

export interface Workspace {
  /**
   * 対象の作業フォルダを用意する。
   * prBranch は、対象が PR のときのその PR のブランチ。
   */
  prepare(
    target: Target,
    access: GuardContext["access"],
    prBranch?: string,
  ): Promise<Prepared>;
}

/** worktree を置くフォルダ */
export function worktreeRoot(repo: string, home: string = homedir()): string {
  return join(home, ".tasuki", "worktrees", repo.replace("/", "__"));
}

export class GitWorkspace implements Workspace {
  constructor(
    /** 対象リポジトリのフォルダ（origin を持つ clone） */
    private readonly repoDir: string,
    private readonly root: string,
    private readonly defaultBranch: string,
    private readonly exec: Exec = commandExec("git"),
  ) {}

  private git(cwd: string, args: string[]): Promise<string> {
    return run(this.exec, "git", ["-C", cwd, ...args]);
  }

  private async state(cwd: string): Promise<Prepared> {
    const branch = (await this.git(cwd, ["branch", "--show-current"])).trim();
    const status = await this.git(cwd, ["status", "--porcelain"]);
    return {
      cwd,
      branch: branch.length > 0 ? branch : null,
      dirty: status.trim().length > 0,
    };
  }

  /** ブランチを取り出している worktree のフォルダ */
  private async worktreeOf(branch: string): Promise<string | undefined> {
    const out = await this.git(this.repoDir, [
      "worktree",
      "list",
      "--porcelain",
    ]);
    let dir: string | undefined;
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) dir = line.slice("worktree ".length);
      else if (line === `branch refs/heads/${branch}` && dir !== undefined) {
        return resolve(dir);
      }
    }
    return undefined;
  }

  private async ensure(dir: string, ref: string): Promise<void> {
    if (existsSync(dir)) return;
    await this.git(this.repoDir, ["worktree", "add", "--detach", dir, ref]);
  }

  async prepare(
    target: Target,
    access: GuardContext["access"],
    prBranch?: string,
  ): Promise<Prepared> {
    await this.git(this.repoDir, ["fetch", "origin", "--prune"]);
    const name = targetKey(target).replace(":", "-");
    const base = `origin/${this.defaultBranch}`;

    if (access !== "write") {
      // 読むだけの役: 確かめたいコミットを、ブランチを作らずに取り出す
      const dir = join(this.root, `read-${name}`);
      const ref = prBranch !== undefined ? `origin/${prBranch}` : base;
      await this.ensure(dir, ref);
      await this.git(dir, ["checkout", "--detach", "--force", ref]);
      return this.state(dir);
    }

    if (prBranch !== undefined) {
      // PR の修正: そのブランチを取り出している worktree があれば、そこで続ける
      const existing = await this.worktreeOf(prBranch);
      const dir = existing ?? join(this.root, name);
      if (existing === undefined) {
        await this.ensure(dir, base);
        await this.git(dir, ["checkout", "-B", prBranch, `origin/${prBranch}`]);
      }
      const state = await this.state(dir);
      if (!state.dirty) {
        // 人や別の実行が push したコミットを取り込む（進められなければそのままにする）
        await this.exec([
          "-C",
          dir,
          "merge",
          "--ff-only",
          `origin/${prBranch}`,
        ]);
      }
      return this.state(dir);
    }

    // Issue・要件: 対象ごとの worktree。前の実行の続きがあれば、そのまま残す
    const dir = join(this.root, name);
    await this.ensure(dir, base);
    return this.state(dir);
  }
}

/** 作業フォルダの様子を、指示書に添える文にする */
export function describeWorkspace(p: Prepared, defaultBranch: string): string {
  const where =
    p.branch !== null
      ? `今のブランチは ${p.branch} です`
      : `ブランチには居ません（コミットを直接取り出しています）。変更するときは origin/${defaultBranch} の最新から作業用のブランチを作ってください`;
  return `作業フォルダは ${p.cwd} です。${where}。${
    p.dirty
      ? "コミットしていない変更が残っています（前の実行の続きです）。git status で確かめてください。"
      : ""
  }`;
}
