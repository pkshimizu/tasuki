/**
 * 危険な操作の拒否。エージェントの操作は広く許可し、ここで決めたものだけを実行時に拒否する。
 * 拒否は理由つきでエージェントに返す（人の許可待ちにはしない）。
 *
 * シェルのコマンドは文字列を見て判定するので、すり抜けを完全には防げない。
 * 既定のブランチは GitHub 側の保護（PR 必須・CI 必須）でも守る前提にする。
 */
import { isAbsolute, relative, resolve } from "node:path";

export interface GuardContext {
  /** 作業フォルダ（worktree） */
  cwd: string;
  /** 既定のブランチ */
  defaultBranch: string;
  /**
   * write: ファイルを書ける
   * read: ファイルを書けない（Issue・PR のコメントなど GitHub の操作はできる）
   * inspect: 読むだけ（司令塔）
   */
  access: "write" | "read" | "inspect";
}

const FILE_TOOLS: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const PROTECTED_DIR = ".tasuki";

function inside(parent: string, file: string): boolean {
  const rel = relative(parent, file);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function checkFile(path: string, ctx: GuardContext): string | undefined {
  const file = resolve(ctx.cwd, path);
  if (!inside(ctx.cwd, file)) {
    return `作業フォルダ（${ctx.cwd}）の外には書き込めません: ${path}`;
  }
  if (inside(resolve(ctx.cwd, PROTECTED_DIR), file)) {
    return `${PROTECTED_DIR}/ は書き換えられません: ${path}`;
  }
  return undefined;
}

/** 司令塔が使えるコマンド（読むだけ） */
const INSPECT_COMMANDS =
  /^(gh (pr|issue) (view|list|diff|checks|status)\b|gh run (view|list)\b|git (log|show|diff|status|branch|ls-files)\b|ls\b|cat\b)/;
const SHELL_OPERATORS = /[;&|<>`$\n]/;

/** `.tasuki` に触れてよい、読むだけのコマンド */
const READ_COMMANDS =
  /^(cat|ls|dir|type|head|tail|grep|rg|find|Get-Content|Get-ChildItem|Select-String|git (log|show|diff|status))\b/;

function gitPushProblem(
  command: string,
  defaultBranch: string,
): string | undefined {
  for (const m of command.matchAll(/\bgit\b[^;&|\n]*?\bpush\b([^;&|\n]*)/g)) {
    const args = m[1] ?? "";
    if (
      /(^|\s)(-f|--force|--force-with-lease(=\S+)?|--mirror)(\s|$)/.test(args)
    ) {
      return "force push はできません。履歴を書き換えず、新しいコミットを足してください";
    }
    if (/(^|\s)(--delete|-d)(\s|$)/.test(args) || /(^|\s):\S+/.test(args)) {
      return "リモートのブランチは削除できません";
    }
    if (/(^|\s)\+\S+/.test(args)) {
      return "force push はできません。履歴を書き換えず、新しいコミットを足してください";
    }
    const branch = defaultBranch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const toDefault = new RegExp(
      `(^|\\s)(\\S+:)?(refs/heads/)?${branch}(\\s|$)`,
    );
    if (toDefault.test(args)) {
      return `${defaultBranch} には直接 push できません。作業用のブランチに push して PR を作ってください`;
    }
  }
  return undefined;
}

function checkShell(command: string, ctx: GuardContext): string | undefined {
  const text = command.trim();
  if (ctx.access === "inspect") {
    if (!INSPECT_COMMANDS.test(text) || SHELL_OPERATORS.test(text)) {
      return "司令塔が使えるのは、gh と git の読むだけのコマンドだけです";
    }
    return undefined;
  }
  const push = gitPushProblem(text, ctx.defaultBranch);
  if (push) return push;
  if (/\bgh\s+pr\s+merge\b/.test(text) || /pulls\/\d+\/merge\b/.test(text)) {
    return "PR のマージはできません。マージは Tasuki が CI の合格を確かめてから行います";
  }
  if (text.includes(PROTECTED_DIR) && !isReadOnly(text)) {
    return `${PROTECTED_DIR}/ は書き換えられません`;
  }
  if (ctx.access === "read" && /\bgit\b[^;&|\n]*\b(commit|push)\b/.test(text)) {
    return "この役はファイルを変更できません（コミットと push はできません）";
  }
  return undefined;
}

function isReadOnly(command: string): boolean {
  return READ_COMMANDS.test(command) && !/[;&|>`\n]|\$\(/.test(command);
}

/** 操作を拒否する理由。許可するなら undefined */
export function denyReason(
  toolName: string,
  input: unknown,
  ctx: GuardContext,
): string | undefined {
  const args = (input ?? {}) as Record<string, unknown>;
  const pathField = FILE_TOOLS[toolName];
  if (pathField !== undefined) {
    if (ctx.access !== "write") return "この役はファイルを変更できません";
    const path = args[pathField];
    if (typeof path !== "string") return undefined;
    return checkFile(path, ctx);
  }
  if (SHELL_TOOLS.has(toolName)) {
    const command = args.command;
    if (typeof command !== "string") return undefined;
    return checkShell(command, ctx);
  }
  return undefined;
}
