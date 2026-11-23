import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireLock, lockFile } from "./lock.js";

function file() {
  return join(
    mkdtempSync(join(tmpdir(), "tasuki-lock-")),
    "state",
    "a.db.lock",
  );
}

describe("acquireLock", () => {
  it("取れたら自分の番号を書き、release で消す", () => {
    const f = file();
    const lock = acquireLock(f, { pid: 100, isAlive: () => true });
    expect(readFileSync(f, "utf8")).toBe("100");
    expect("release" in lock).toBe(true);
    if ("release" in lock) lock.release();
    expect(existsSync(f)).toBe(false);
  });

  it("動いているプロセスのロックがあれば取れない", () => {
    const f = file();
    acquireLock(f, { pid: 100, isAlive: () => true });
    const second = acquireLock(f, { pid: 200, isAlive: (pid) => pid === 100 });
    expect(second).toEqual({
      problem: expect.stringContaining("プロセス 100") as string,
    });
    expect(readFileSync(f, "utf8")).toBe("100");
  });

  it("落ちたプロセスのロックは引き継ぐ", () => {
    const f = file();
    acquireLock(f, { pid: 100, isAlive: () => true });
    const second = acquireLock(f, { pid: 200, isAlive: () => false });
    expect("release" in second).toBe(true);
    expect(readFileSync(f, "utf8")).toBe("200");
  });

  it("中身が壊れたロックは引き継ぐ", () => {
    const f = file();
    acquireLock(f, { pid: 100, isAlive: () => true });
    writeFileSync(f, "こわれた");
    expect("release" in acquireLock(f, { pid: 200, isAlive: () => true })).toBe(
      true,
    );
  });

  it("引き継がれたあとの release は、相手のロックを消さない", () => {
    const f = file();
    const first = acquireLock(f, { pid: 100, isAlive: () => true });
    acquireLock(f, { pid: 200, isAlive: () => false });
    if ("release" in first) first.release();
    expect(readFileSync(f, "utf8")).toBe("200");
  });

  it("今のプロセスは動いていると判定する", () => {
    const f = file();
    acquireLock(f);
    expect(acquireLock(f)).toHaveProperty("problem");
  });
});

describe("lockFile", () => {
  it("記録のファイルの隣に置く", () => {
    expect(lockFile("/home/u/.tasuki/state/o__r.db")).toBe(
      "/home/u/.tasuki/state/o__r.db.lock",
    );
  });
});
