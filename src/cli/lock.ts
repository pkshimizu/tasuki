/**
 * 二重起動の防止。同じリポジトリを担当する Tasuki が既に動いていれば、起動しない。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Lock {
  release(): void;
}

export interface LockDeps {
  pid: number;
  /** そのプロセスが動いているか */
  isAlive: (pid: number) => boolean;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // 権限が無くて合図を送れないだけなら、プロセスは居る
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const realDeps: LockDeps = { pid: process.pid, isAlive: processAlive };

/**
 * ロックを取る。既に動いているプロセスがあれば、その番号を problem に入れて返す。
 * 前のプロセスが落ちて残ったロックは引き継ぐ。
 */
export function acquireLock(
  file: string,
  deps: LockDeps = realDeps,
): Lock | { problem: string } {
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 既にあれば失敗する（同時に起動しても、取れるのは 1 つだけ）
      writeFileSync(file, String(deps.pid), { flag: "wx" });
      return {
        release: () => {
          try {
            if (readFileSync(file, "utf8").trim() === String(deps.pid)) {
              rmSync(file, { force: true });
            }
          } catch {
            // 既に無ければ何もしない
          }
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const owner = Number(readFileSync(file, "utf8").trim());
      if (Number.isInteger(owner) && owner > 0 && deps.isAlive(owner)) {
        return {
          problem: `このリポジトリを担当する Tasuki が既に動いています（プロセス ${String(owner)}）。止めてから起動してください`,
        };
      }
      // 前のプロセスが落ちて残ったロックなので、消して取り直す
      rmSync(file, { force: true });
    }
  }
  return { problem: `ロック（${file}）を取れませんでした` };
}

/** リポジトリごとのロックの場所 */
export function lockFile(stateFile: string): string {
  return `${stateFile}.lock`;
}
