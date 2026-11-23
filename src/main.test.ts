import { describe, expect, it } from "vitest";
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
