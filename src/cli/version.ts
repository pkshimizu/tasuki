import { readFileSync } from "node:fs";

/** package.json に書かれた版 */
export function version(): string {
  // src/cli（テスト）と dist/cli（ビルド後）のどちらから呼んでも 2 つ上が package.json
  const url = new URL("../../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(url, "utf8")) as { version: string };
  return pkg.version;
}
