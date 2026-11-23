/**
 * エージェントが使うシェルの用意。
 *
 * Windows の Claude Code は、Git Bash が見つからないと Windows PowerShell だけでコマンドを動かす。
 * Windows PowerShell 5.1 は、UTF-8 のファイルを文字コードの指定なしで読むと文字化けし、
 * ファイルに書くと先頭に BOM を付ける。Git Bash が使えるなら Bash の道具だけを使わせる。
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { commandExec, type Exec } from "../integrations/exec.js";

/** Claude Code に Git Bash の場所を教える環境変数 */
export const GIT_BASH_ENV = "CLAUDE_CODE_GIT_BASH_PATH";

export interface ShellSetup {
  /** エージェントの環境変数に足すもの */
  env: Record<string, string>;
  /** エージェントに渡さない道具 */
  disallowedTools: string[];
  /** 起動時に人に伝えること */
  warning?: string;
}

export interface ShellDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  git: Exec;
  exists: (path: string) => boolean;
}

const realDeps = (): ShellDeps => ({
  platform: process.platform,
  env: process.env,
  git: commandExec("git"),
  exists: existsSync,
});

/** git の置き場から上へたどって、bin/bash.exe を探す */
export async function findGitBash(
  deps: Pick<ShellDeps, "git" | "exists">,
): Promise<string | undefined> {
  let execPath: string;
  try {
    const result = await deps.git(["--exec-path"]);
    if (result.code !== 0) return undefined;
    execPath = result.stdout.trim();
  } catch {
    return undefined;
  }
  // 例: <Git>/mingw64/libexec/git-core → <Git>/bin/bash.exe
  let dir = execPath;
  for (let i = 0; i < 5 && dir.length > 0; i++) {
    const candidate = join(dir, "bin", "bash.exe");
    if (deps.exists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** エージェントに使わせるシェルを決める */
export async function setupShell(
  deps: ShellDeps = realDeps(),
): Promise<ShellSetup> {
  if (deps.platform !== "win32") return { env: {}, disallowedTools: [] };
  // 人が場所を指定していれば、それに従う
  if (deps.env[GIT_BASH_ENV]) {
    return { env: {}, disallowedTools: ["PowerShell"] };
  }
  const bash = await findGitBash(deps);
  if (bash !== undefined) {
    return { env: { [GIT_BASH_ENV]: bash }, disallowedTools: ["PowerShell"] };
  }
  return {
    env: {},
    disallowedTools: [],
    warning: `Git Bash が見つからないので、エージェントは Windows PowerShell でコマンドを動かします。日本語のファイルが文字化けすることがあります。Git for Windows を入れるか、環境変数 ${GIT_BASH_ENV} に bash.exe の場所を入れてください`,
  };
}
