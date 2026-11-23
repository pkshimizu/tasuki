import { describe, expect, it } from "vitest";
import { CommandError, commandExec, run } from "./exec.js";

const node = commandExec(process.execPath);

describe("commandExec", () => {
  it("標準出力・標準エラー・終了コードを返す", async () => {
    const result = await node([
      "-e",
      'console.log("out"); console.error("err"); process.exit(3)',
    ]);
    expect(result).toEqual({ code: 3, stdout: "out\n", stderr: "err\n" });
  });

  it("標準入力を渡す", async () => {
    const result = await node(["-e", "process.stdin.pipe(process.stdout)"], {
      input: "こんにちは",
    });
    expect(result.stdout).toBe("こんにちは");
  });

  it("入力を読まずにすぐ終わるコマンドでも、エラーにならない", async () => {
    const big = "x".repeat(1024 * 1024);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        node(["-e", "process.exit(0)"], { input: big }),
      ),
    );
    expect(results.every((r) => r.code === 0)).toBe(true);
  });

  it("コマンドが無ければ reject する", async () => {
    await expect(commandExec("tasuki-no-such-command")([])).rejects.toThrow();
  });
});

describe("run", () => {
  it("成功したら標準出力を返し、失敗したら CommandError を投げる", async () => {
    expect(await run(node, "node", ["-e", 'console.log("ok")'])).toBe("ok\n");
    await expect(
      run(node, "node", ["-e", 'console.error("boom"); process.exit(1)']),
    ).rejects.toThrow(CommandError);
  });
});
