/**
 * エージェントの作業フォルダ（git worktree）を用意する。
 * ファイルを書く役は対象ごとの worktree で、読むだけの役は確かめたいコミットを取り出した worktree で動かす。
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  commandExec,
  type Exec,
  run,
  type ShellExec,
  shellExec,
} from "../integrations/exec.js";
import type { GuardContext } from "./guard.js";
import { type Target, targetKey } from "../domain/types.js";

export interface Prepared {
  /** 作業フォルダ */
  cwd: string;
  /** 今のブランチ。ブランチに居なければ null */
  branch: string | null;
  /** コミットしていない変更があるか */
  dirty: boolean;
  /** 今回実行した準備コマンド。実行しなかったときは無い */
  setup?: { commands: string[]; error?: string };
}

/** 作業フォルダの準備 */
export interface SetupConfig {
  /** 実行するコマンド */
  commands: readonly string[];
  /** 変わったらもう一度実行するファイル（リポジトリからの相対パス） */
  onChange: readonly string[];
}

/** 準備コマンド 1 つの制限時間 */
export const SETUP_TIMEOUT_MS = 15 * 60 * 1000;
const OUTPUT_TAIL = 1500;

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
  /** 今ある作業フォルダの一覧 */
  entries(): Promise<WorkspaceEntry[]>;
  /** 作業フォルダを消す（コミットしていない変更も捨てる） */
  remove(entry: WorkspaceEntry): Promise<void>;
}

export interface WorkspaceEntry {
  /** フォルダの名前（例: issue-3、read-pr-7、requirement-123） */
  name: string;
  cwd: string;
  /** 取り出しているブランチ。ブランチに居なければ null */
  branch: string | null;
  /** 追跡しているファイルに、コミットしていない変更があるか */
  dirty: boolean;
}

/** 作業フォルダの名前から対象を読む。読むだけの役のフォルダは read が true */
export function parseEntryName(
  name: string,
): { target: Target; read: boolean } | undefined {
  const read = name.startsWith("read-");
  const rest = read ? name.slice("read-".length) : name;
  if (rest === "repo") return { target: { kind: "repo" }, read };
  const m = /^(issue|pr|requirement)-(.+)$/.exec(rest);
  if (!m) return undefined;
  const [, kind, id] = m;
  if (kind === "requirement") {
    return { target: { kind: "requirement", id: id! }, read };
  }
  if (!/^\d+$/.test(id!)) return undefined;
  return {
    target: { kind: kind as "issue" | "pr", number: Number(id) },
    read,
  };
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
    private readonly setup: SetupConfig = { commands: [], onChange: [] },
    private readonly shell: ShellExec = shellExec(SETUP_TIMEOUT_MS),
  ) {}

  /** 準備コマンドと、見張るファイルの中身から作る印。変わったら準備をやり直す */
  private setupKey(dir: string): string {
    const hash = createHash("sha256");
    hash.update(JSON.stringify(this.setup.commands));
    for (const file of this.setup.onChange) {
      const path = join(dir, file);
      hash.update(`\n${file}\n`);
      if (existsSync(path)) hash.update(readFileSync(path));
    }
    return hash.digest("hex");
  }

  /**
   * 準備コマンドを実行する。作業フォルダごとに、初めてのときと、見張るファイルが変わったときだけ。
   * 失敗しても止めず、失敗した内容を返す（次の用意のときにもう一度実行する）。
   */
  private async runSetup(dir: string): Promise<Prepared["setup"]> {
    const commands = [...this.setup.commands];
    if (commands.length === 0) return undefined;
    const marker = join(this.root, ".setup", `${basename(dir)}.txt`);
    const key = this.setupKey(dir);
    if (existsSync(marker) && readFileSync(marker, "utf8") === key) {
      return undefined;
    }
    for (const command of commands) {
      let failure: string | undefined;
      try {
        const result = await this.shell(command, dir);
        if (result.code !== 0) {
          failure = `${result.stderr}\n${result.stdout}`
            .trim()
            .slice(-OUTPUT_TAIL);
        }
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
      }
      if (failure !== undefined) {
        return { commands, error: `${command} が失敗しました:\n${failure}` };
      }
    }
    mkdirSync(join(this.root, ".setup"), { recursive: true });
    // 準備コマンドが見張るファイルを書き換えることがあるので、終わったあとの中身で印を付ける
    writeFileSync(marker, this.setupKey(dir));
    return { commands };
  }

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

  async entries(): Promise<WorkspaceEntry[]> {
    if (!existsSync(this.root)) return [];
    const entries: WorkspaceEntry[] = [];
    for (const item of readdirSync(this.root, { withFileTypes: true })) {
      if (!item.isDirectory() || item.name.startsWith(".")) continue;
      const cwd = join(this.root, item.name);
      // worktree として壊れているフォルダは飛ばす
      const branch = await this.exec(["-C", cwd, "branch", "--show-current"]);
      const status = await this.exec([
        "-C",
        cwd,
        "status",
        "--porcelain",
        "--untracked-files=no",
      ]);
      if (branch.code !== 0 || status.code !== 0) continue;
      entries.push({
        name: item.name,
        cwd,
        branch: branch.stdout.trim() || null,
        dirty: status.stdout.trim().length > 0,
      });
    }
    return entries;
  }

  async remove(entry: WorkspaceEntry): Promise<void> {
    await this.git(this.repoDir, ["worktree", "remove", "--force", entry.cwd]);
    rmSync(join(this.root, ".setup", `${entry.name}.txt`), { force: true });
    await this.exec(["-C", this.repoDir, "worktree", "prune"]);
  }

  async prepare(
    target: Target,
    access: GuardContext["access"],
    prBranch?: string,
  ): Promise<Prepared> {
    const prepared = await this.checkout(target, access, prBranch);
    const setup = await this.runSetup(prepared.cwd);
    return setup === undefined ? prepared : { ...prepared, setup };
  }

  /** 対象の worktree を用意して、確かめたいコミットを取り出す */
  private async checkout(
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
  }${describeSetup(p.setup)}`;
}

function describeSetup(setup: Prepared["setup"]): string {
  if (setup === undefined) return "";
  const list = setup.commands.map((c) => `\`${c}\``).join("、");
  if (setup.error === undefined) {
    return `\n作業フォルダの準備（${list}）は、Tasuki が実行済みです。`;
  }
  return `\n作業フォルダの準備（${list}）を Tasuki が実行しましたが、失敗しました。必要なら原因を確かめて、自分で実行してください。\n${setup.error}`;
}
