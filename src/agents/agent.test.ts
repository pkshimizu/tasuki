import { resolve } from "node:path";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import {
  type AgentRun,
  buildOptions,
  createRunAgent,
  type QueryFn,
  resetDate,
  toJsonSchema,
} from "./agent.js";
import { rolePrompt, workerOutputSchema } from "./roles.js";
import { testConfig } from "../testing/fixtures.js";

const cwd = resolve("/work/tree");

function run(
  extra: Partial<AgentRun<typeof workerOutputSchema>> = {},
): AgentRun<typeof workerOutputSchema> {
  return {
    name: "programmer",
    systemPrompt: "決まり",
    prompt: "指示書",
    schema: workerOutputSchema,
    guard: { cwd, defaultBranch: "main", access: "write" },
    ...extra,
  };
}

/** 決めたメッセージを順に返す偽の SDK */
function fakeQuery(messages: unknown[], error?: Error) {
  const seen: { prompt: string; options: Options }[] = [];
  const query: QueryFn = (params) => {
    seen.push(params);
    return (async function* () {
      for (const m of messages) yield m as SDKMessage;
      if (error) throw error;
    })();
  };
  return { query, seen };
}

const output = {
  status: "done",
  summary: "実装して PR を作った",
  questions: [],
  pr: 12,
  verdict: null,
};

function success(structured: unknown = output) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    structured_output: structured,
    total_cost_usd: 0.5,
    num_turns: 9,
  };
}

describe("buildOptions", () => {
  it("作業フォルダ・決まり・結果の形を渡し、個人設定は持ち込まない", () => {
    const o = buildOptions(run({ model: "claude-sonnet-5-5" }));
    expect(o.cwd).toBe(cwd);
    expect(o.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "決まり",
    });
    expect(o.outputFormat).toEqual({
      type: "json_schema",
      schema: toJsonSchema(workerOutputSchema),
    });
    expect(o.settingSources).toEqual(["project"]);
    expect(o.permissionMode).toBe("default");
    expect(o.model).toBe("claude-sonnet-5-5");
    expect(o.disallowedTools).toBeUndefined();
  });

  it("書けない役には書き込みの道具を渡さない", () => {
    const o = buildOptions(
      run({ guard: { cwd, defaultBranch: "main", access: "read" } }),
    );
    expect(o.disallowedTools).toContain("Write");
  });

  it("共通の実行のしかた（環境変数・渡さない道具）を足す", () => {
    const runner = {
      env: { CLAUDE_CODE_GIT_BASH_PATH: "C:\\Git\\bin\\bash.exe" },
      disallowedTools: ["PowerShell"],
    };
    const write = buildOptions(run(), runner);
    expect(write.disallowedTools).toEqual(["PowerShell"]);
    expect(write.env).toMatchObject(runner.env);
    // この PC の環境変数も引き継ぐ
    expect(write.env!.PATH ?? write.env!.Path).toBeDefined();

    const read = buildOptions(
      run({ guard: { cwd, defaultBranch: "main", access: "read" } }),
      runner,
    );
    expect(read.disallowedTools).toEqual([
      "Write",
      "Edit",
      "MultiEdit",
      "NotebookEdit",
      "PowerShell",
    ]);
    expect(buildOptions(run()).env).toBeUndefined();
  });

  it("許可を求められた操作は、危険なものだけを拒否する", async () => {
    const o = buildOptions(run());
    const ask = (command: string) =>
      o.canUseTool!("Bash", { command }, {
        signal: new AbortController().signal,
      } as never);
    expect(await ask("npm test")).toMatchObject({ behavior: "allow" });
    expect(await ask("git push origin main")).toMatchObject({
      behavior: "deny",
    });
  });

  it("許可を求められない操作も、フックで拒否する", async () => {
    const o = buildOptions(run());
    const hook = o.hooks!.PreToolUse![0]!.hooks[0]!;
    const call = (command: string) =>
      hook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command },
        } as never,
        undefined,
        { signal: new AbortController().signal },
      );
    expect(await call("npm test")).toEqual({});
    expect(await call("gh pr merge 3")).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
  });

  it("中断の合図を SDK に伝える", () => {
    const controller = new AbortController();
    const o = buildOptions(run({ signal: controller.signal }));
    expect(o.abortController!.signal.aborted).toBe(false);
    controller.abort();
    expect(o.abortController!.signal.aborted).toBe(true);
  });
});

describe("runAgent", () => {
  it("決めた形の結果を返す", async () => {
    const { query, seen } = fakeQuery([{ type: "system" }, success()]);
    const outcome = await createRunAgent(query)(run());
    expect(outcome).toEqual({
      kind: "ok",
      output,
      costUsd: 0.5,
      turns: 9,
    });
    expect(seen[0]!.prompt).toBe("指示書");
  });

  it("結果が決めた形でなければエラー", async () => {
    const { query } = fakeQuery([success({ status: "unknown" })]);
    const outcome = await createRunAgent(query)(run());
    expect(outcome.kind).toBe("error");
  });

  it("利用上限の知らせのあとに失敗したら、回復時刻つきで limit を返す", async () => {
    const { query } = fakeQuery([
      {
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", resetsAt: 1795000000 },
      },
      {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["limit"],
      },
    ]);
    const outcome = await createRunAgent(query)(run());
    expect(outcome).toMatchObject({
      kind: "limit",
      resetsAt: new Date(1795000000 * 1000),
    });
  });

  it("利用上限の警告だけなら、そのまま結果を返す", async () => {
    const { query } = fakeQuery([
      {
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed_warning" },
      },
      success(),
    ]);
    expect((await createRunAgent(query)(run())).kind).toBe("ok");
  });

  it("エラー文が利用上限なら limit を返す", async () => {
    const { query } = fakeQuery([], new Error("Claude AI usage limit reached"));
    expect(await createRunAgent(query)(run())).toMatchObject({
      kind: "limit",
      resetsAt: undefined,
    });
  });

  it("そのほかの失敗は error を返す", async () => {
    const failed = fakeQuery([
      {
        type: "result",
        subtype: "error_max_structured_output_retries",
        is_error: true,
        errors: ["bad"],
      },
    ]);
    expect(await createRunAgent(failed.query)(run())).toMatchObject({
      kind: "error",
    });
    const thrown = fakeQuery([], new Error("spawn failed"));
    expect(await createRunAgent(thrown.query)(run())).toEqual({
      kind: "error",
      message: "programmer: spawn failed",
    });
    const empty = fakeQuery([]);
    expect((await createRunAgent(empty.query)(run())).kind).toBe("error");
  });
});

describe("resetDate", () => {
  it("秒でもミリ秒でも同じ時刻にする", () => {
    expect(resetDate(1795000000)).toEqual(resetDate(1795000000000));
    expect(resetDate(undefined)).toBeUndefined();
  });
});

describe("rolePrompt", () => {
  const config = testConfig();
  it("役の仕事・置き場・追加の指示・言語を入れる", () => {
    const p = rolePrompt("spec-master", config, "用語集に従う");
    expect(p).toContain("仕様マスター");
    expect(p).toContain("docs/specs/");
    expect(p).toContain("用語集に従う");
    expect(p).toContain("日本語");
  });
  it("文字化けしない読み書きのしかたを伝える", () => {
    const p = rolePrompt("programmer", config, "");
    expect(p).toContain("ファイルを読むときは Read");
    expect(p).toContain("--body-file");
  });
  it("書けない役には、読むだけだと伝える", () => {
    expect(rolePrompt("reviewer", config, "")).toContain("この役は読むだけ");
    expect(rolePrompt("programmer", config, "")).not.toContain(
      "この役は読むだけ",
    );
  });
});
