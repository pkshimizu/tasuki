import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../config/config.js";
import type { Exec } from "../integrations/exec.js";
import { init, repoFromRemote } from "./init.js";
import type { Output } from "./output.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const output: Output = { out: (t) => out.push(t), err: (t) => err.push(t) };
  return { out, err, output };
}

const remote =
  (url: string, code = 0): Exec =>
  () =>
    Promise.resolve({ code, stdout: `${url}\n`, stderr: "" });

describe("repoFromRemote", () => {
  it("ssh と https の URL から owner/name を読む", () => {
    expect(repoFromRemote("git@github.com:pkshimizu/wordcards.git\n")).toBe(
      "pkshimizu/wordcards",
    );
    expect(repoFromRemote("https://github.com/pkshimizu/word.cards")).toBe(
      "pkshimizu/word.cards",
    );
    expect(repoFromRemote("https://github.com/pkshimizu/wordcards/")).toBe(
      "pkshimizu/wordcards",
    );
  });
  it("GitHub の URL でなければ読まない", () => {
    expect(repoFromRemote("https://example.test/a/b.git")).toBeUndefined();
    expect(repoFromRemote("")).toBeUndefined();
  });
});

describe("init", () => {
  it("ひな形を書き出し、origin から読んだリポジトリを入れる", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tasuki-init-"));
    const c = capture();
    const code = await init(
      dir,
      c.output,
      remote("git@github.com:pkshimizu/wordcards.git"),
    );
    expect(code).toBe(0);
    const text = readFileSync(join(dir, ".tasuki", "config.yaml"), "utf8");
    expect(text).toContain("repo: pkshimizu/wordcards");
    expect(text).toContain("# knowledge:");
    expect(c.out[0]).toContain("を作りました");
    expect(c.out.some((l) => l.includes("github.repo"))).toBe(false);
    // チャンネルの ID はまだひな形のままなので、点検では誤りになる
    expect(() => parseConfig(text)).toThrow(ConfigError);
    // ID を書き換えれば、そのまま読める
    let n = 0;
    const filled = text.replaceAll(
      '"000000000000000000"',
      () => `"10000000000000000${String(n++)}"`,
    );
    expect(parseConfig(filled).github.repo).toBe("pkshimizu/wordcards");
  });

  it("origin を読めなければ、ひな形の値のままにして書き換えを促す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tasuki-init-"));
    const c = capture();
    expect(await init(dir, c.output, remote("", 128))).toBe(0);
    expect(readFileSync(join(dir, ".tasuki", "config.yaml"), "utf8")).toContain(
      "repo: owner/name",
    );
    expect(c.out.some((l) => l.includes("github.repo"))).toBe(true);

    const other = mkdtempSync(join(tmpdir(), "tasuki-init-"));
    const failing: Exec = () => Promise.reject(new Error("ENOENT"));
    expect(await init(other, capture().output, failing)).toBe(0);
  });

  it("既にあれば上書きしない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tasuki-init-"));
    const git = remote("git@github.com:pkshimizu/wordcards.git");
    await init(dir, capture().output, git);
    const before = readFileSync(join(dir, ".tasuki", "config.yaml"), "utf8");
    const c = capture();
    expect(
      await init(dir, c.output, remote("git@github.com:other/repo.git")),
    ).toBe(1);
    expect(c.err[0]).toContain("既にあります");
    expect(readFileSync(join(dir, ".tasuki", "config.yaml"), "utf8")).toBe(
      before,
    );
    expect(existsSync(join(dir, ".tasuki"))).toBe(true);
  });
});
