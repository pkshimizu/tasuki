import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MINIMAL_CONFIG } from "./testing.js";
import { HELP, main, type Output } from "./main.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const output: Output = {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
  };
  return { out, err, output };
}

describe("main", () => {
  it("--version でバージョンを出す", async () => {
    const c = capture();
    expect(await main(["--version"], c.output)).toBe(0);
    expect(c.out[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("引数なしで説明を出す", async () => {
    const c = capture();
    expect(await main([], c.output)).toBe(0);
    expect(c.out).toEqual([HELP]);
  });

  it("知らないコマンドは 2 を返す", async () => {
    const c = capture();
    expect(await main(["nope"], c.output)).toBe(2);
    expect(c.err[0]).toContain("nope");
  });
});

describe("check", () => {
  function repo(config?: string) {
    const dir = mkdtempSync(join(tmpdir(), "tasuki-check-"));
    if (config !== undefined) {
      mkdirSync(join(dir, ".tasuki"));
      writeFileSync(join(dir, ".tasuki", "config.yaml"), config);
    }
    return dir;
  }

  it("設定とトークンがそろっていれば 0", async () => {
    const c = capture();
    const code = await main(["check", repo(MINIMAL_CONFIG)], c.output, {
      TASUKI_DISCORD_TOKEN: "x",
    });
    expect(code).toBe(0);
    expect(c.out.at(-1)).toBe("問題はありません");
  });

  it("トークンが無ければ 1", async () => {
    const c = capture();
    expect(await main(["check", repo(MINIMAL_CONFIG)], c.output, {})).toBe(1);
    expect(c.err[0]).toContain("TASUKI_DISCORD_TOKEN");
  });

  it("設定が無ければ 1", async () => {
    const c = capture();
    const code = await main(["check", repo()], c.output, {
      TASUKI_DISCORD_TOKEN: "x",
    });
    expect(code).toBe(1);
  });
});
