/**
 * 外部のコマンド（gh・git）を子プロセスで動かす。
 */
import { spawn } from "node:child_process";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  input?: string;
}

export type Exec = (
  args: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

/** command を引数つきで動かす Exec を作る（シェルは通さない） */
export function commandExec(command: string): Exec {
  return (args, options = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on("data", (d: Buffer) => out.push(d));
      child.stderr.on("data", (d: Buffer) => err.push(d));
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          code,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
        });
      });
      // 入力を読まずに終わるコマンド（git など）では、書き込みが EPIPE になる。結果は close で受け取るので無視する
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.input ?? "");
    });
}

export type ShellExec = (command: string, cwd: string) => Promise<ExecResult>;

/** 1 行のコマンドをシェルで動かす（設定に書かれた準備コマンド用）。制限時間を過ぎたら終わらせる */
export function shellExec(timeoutMs: number): ShellExec {
  return (command, cwd) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.stdout.on("data", (d: Buffer) => out.push(d));
      child.stderr.on("data", (d: Buffer) => err.push(d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          code: timedOut ? null : code,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: timedOut
            ? `制限時間（${String(Math.round(timeoutMs / 1000))} 秒）を過ぎたので終わらせました`
            : Buffer.concat(err).toString("utf8"),
        });
      });
    });
}

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly result: ExecResult,
  ) {
    super(
      `${command} が失敗しました（終了コード ${String(result.code)}）: ${result.stderr.trim().slice(0, 500)}`,
    );
    this.name = "CommandError";
  }
}

/** 成功したら標準出力を返し、失敗したら CommandError を投げる */
export async function run(
  exec: Exec,
  name: string,
  args: readonly string[],
  options?: ExecOptions,
): Promise<string> {
  const result = await exec(args, options);
  if (result.code !== 0) {
    throw new CommandError(`${name} ${args.slice(0, 3).join(" ")}`, result);
  }
  return result.stdout;
}
