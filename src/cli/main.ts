import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ConfigError, discordToken, loadConfig } from "../config/config.js";
import {
  describeKnowledge,
  FsSource,
  loadKnowledge,
} from "../knowledge/knowledge.js";
import { consoleOutput, type Output } from "./output.js";
import { start } from "./start.js";

export const HELP = `使い方: tasuki <コマンド> [オプション]

コマンド:
  check [フォルダ]  対象リポジトリの .tasuki/config.yaml を点検する（既定は今のフォルダ）
  start [フォルダ]  常駐して開発を進める（Ctrl+C で、動いているエージェントの終了を待って止まる）

オプション:
  -h, --help     この説明を表示する
  -v, --version  バージョンを表示する`;

export function version(): string {
  // src/cli（テスト）と dist/cli（ビルド後）のどちらから呼んでも 2 つ上が package.json
  const url = new URL("../../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(url, "utf8")) as { version: string };
  return pkg.version;
}

/** CLI の入口。終了コードを返す */
export async function main(
  argv: string[],
  output: Output = consoleOutput,
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (e) {
    output.err((e as Error).message);
    output.err(HELP);
    return 2;
  }

  const { values, positionals } = parsed;
  if (values.version) {
    output.out(version());
    return 0;
  }
  const [command, folder] = positionals;
  if (values.help || command === undefined) {
    output.out(HELP);
    return 0;
  }
  if (command === "check") return check(resolve(folder ?? "."), output, env);
  if (command === "start") return start(resolve(folder ?? "."), output, env);
  output.err(`知らないコマンドです: ${command}`);
  output.err(HELP);
  return 2;
}

/** 設定を点検する。誤りがあれば 1 を返す */
export async function check(
  dir: string,
  output: Output,
  env: Record<string, string | undefined>,
): Promise<number> {
  let failed = false;
  try {
    const { config } = loadConfig(dir);
    output.out(`設定を読みました: ${config.github.repo}`);
    const knowledge = await loadKnowledge(new FsSource(dir), config.knowledge);
    output.out(
      "プロダクトの情報（このフォルダにある文書。動かすときは既定のブランチから読みます）:",
    );
    for (const line of describeKnowledge(knowledge, config.knowledge)) {
      output.out(line);
    }
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    for (const p of e.problems) output.err(p);
    failed = true;
  }
  const token = discordToken(env);
  if ("problem" in token) {
    output.err(token.problem);
    failed = true;
  }
  if (failed) return 1;
  output.out("問題はありません");
  return 0;
}
