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
      child.stdin.end(options.input ?? "");
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
