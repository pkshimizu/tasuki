import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
}

const consoleOutput: Output = {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
};

export const HELP = `使い方: tasuki <コマンド> [オプション]

コマンド:
  check [フォルダ]  対象リポジトリの .tasuki/config.yaml を点検する（既定は今のフォルダ）
  start [フォルダ]  常駐して開発を進める（Ctrl+C で、動いているエージェントの終了を待って止まる）

オプション:
  -h, --help     この説明を表示する
  -v, --version  バージョンを表示する`;

export function version(): string {
  // src（テスト）と dist（ビルド後）のどちらから呼んでも 1 つ上が package.json
  const url = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(url, "utf8")) as { version: string };
  return pkg.version;
}

/** CLI の入口。終了コードを返す */
export async function main(
  argv: string[],
  output: Output = consoleOutput,
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
  const [command] = positionals;
  if (values.help || command === undefined) {
    output.out(HELP);
    return 0;
  }
  output.err(`知らないコマンドです: ${command}`);
  output.err(HELP);
  return 2;
}
