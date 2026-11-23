/**
 * tasuki init: 設定のひな形を、対象リポジトリの .tasuki/config.yaml に書き出す。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR, CONFIG_FILE } from "../config/config.js";
import { commandExec, type Exec } from "../integrations/exec.js";
import type { Output } from "./output.js";

/** origin の URL から owner/name を読む。GitHub の URL でなければ undefined */
export function repoFromRemote(url: string): string | undefined {
  const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m?.[1];
}

function template(): string {
  // src/cli（テスト）と dist/cli（ビルド後）のどちらから呼んでも 2 つ上が templates/
  const url = new URL("../../templates/tasuki/config.yaml", import.meta.url);
  return readFileSync(url, "utf8");
}

/** ひな形を書き出す。既にあれば上書きせずに 1 を返す */
export async function init(
  dir: string,
  output: Output,
  git: Exec = commandExec("git"),
): Promise<number> {
  const file = join(dir, CONFIG_DIR, CONFIG_FILE);
  if (existsSync(file)) {
    output.err(`${file} は既にあります（上書きしません）`);
    return 1;
  }
  let repo: string | undefined;
  try {
    const result = await git(["-C", dir, "remote", "get-url", "origin"]);
    if (result.code === 0) repo = repoFromRemote(result.stdout);
  } catch {
    // git が無い・リポジトリでないときは、ひな形の値のままにする
  }
  const text = repo
    ? template().replace("repo: owner/name", `repo: ${repo}`)
    : template();
  mkdirSync(join(dir, CONFIG_DIR), { recursive: true });
  writeFileSync(file, text);

  output.out(`${file} を作りました`);
  if (!repo) {
    output.out(
      "- github.repo を対象リポジトリ（owner/name）に書き換えてください（origin から読み取れませんでした）",
    );
  }
  output.out(
    "- discord.channels と discord.allowed_users を、使うチャンネルとユーザーの ID に書き換えてください",
  );
  output.out(
    "- 書き換えたら、tasuki check で点検し、既定のブランチに入れてください",
  );
  return 0;
}
