/**
 * エージェントを Claude Agent SDK で起動し、結果を決まった形で受け取る。
 * - 毎回新しいセッション。認証はこの PC の Claude Code のログインをそのまま使う
 * - 操作は広く許可し、危険な操作だけを実行時に拒否する（guard.ts）
 * - 利用上限に達したら、回復時刻を呼び出し元に返す
 */
import {
  query as sdkQuery,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { denyReason, type GuardContext } from "./guard.js";

/** SDK の query と同じ形。テストでは差し替える */
export type QueryFn = (params: {
  prompt: string;
  options: Options;
}) => AsyncIterable<SDKMessage>;

export interface AgentRun<S extends z.ZodType> {
  /** 役の名前（記録とエラー表示用） */
  name: string;
  /** 役の決まり。Claude Code の標準の指示に足す */
  systemPrompt: string;
  /** 指示書 */
  prompt: string;
  schema: S;
  guard: GuardContext;
  model?: string | undefined;
  signal?: AbortSignal | undefined;
}

export type AgentOutcome<T> =
  | { kind: "ok"; output: T; costUsd: number; turns: number }
  /** 利用上限で終わった。resetsAt が分かれば回復時刻 */
  | { kind: "limit"; resetsAt: Date | undefined; message: string }
  | { kind: "error"; message: string };

export type RunAgent = <S extends z.ZodType>(
  run: AgentRun<S>,
) => Promise<AgentOutcome<z.infer<S>>>;

/** Claude Agent SDK に渡す JSON Schema */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete json.$schema;
  return json;
}

const LIMIT_PATTERN =
  /usage limit|hit your (?:usage )?limit|rate[_ ]limit|limit reached|out of extra usage/i;

/** 回復時刻（秒かミリ秒）を Date にする */
export function resetDate(resetsAt: number | undefined): Date | undefined {
  if (resetsAt === undefined || !Number.isFinite(resetsAt)) return undefined;
  return new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt);
}

/** すべてのエージェントに共通の、実行のしかた */
export interface RunnerOptions {
  /** エージェントの環境変数に足すもの */
  env?: Record<string, string>;
  /** エージェントに渡さない道具 */
  disallowedTools?: readonly string[];
}

const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];

export function buildOptions<S extends z.ZodType>(
  run: AgentRun<S>,
  runner: RunnerOptions = {},
): Options {
  const guard = run.guard;
  const disallowedTools = [
    ...(guard.access !== "write" ? WRITE_TOOLS : []),
    ...(runner.disallowedTools ?? []),
  ];
  const abortController = new AbortController();
  if (run.signal) {
    if (run.signal.aborted) abortController.abort();
    else {
      run.signal.addEventListener("abort", () => abortController.abort(), {
        once: true,
      });
    }
  }
  return {
    cwd: guard.cwd,
    abortController,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: run.systemPrompt,
    },
    outputFormat: { type: "json_schema", schema: toJsonSchema(run.schema) },
    // 対象リポジトリの CLAUDE.md は読むが、この PC の個人設定（フックや許可の規則）は持ち込まない
    settingSources: ["project"],
    persistSession: false,
    permissionMode: "default",
    ...(run.model !== undefined && { model: run.model }),
    ...(disallowedTools.length > 0 && { disallowedTools }),
    ...(runner.env !== undefined &&
      Object.keys(runner.env).length > 0 && {
        env: { ...process.env, ...runner.env },
      }),
    // 許可を求められた操作は、危険なものだけを拒否して、ほかは許可する
    canUseTool: (toolName, input) => {
      const reason = denyReason(toolName, input, guard);
      return Promise.resolve(
        reason === undefined
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: reason },
      );
    },
    // 設定で許可済みになっていて許可を求められない操作も、ここで必ず確かめる
    hooks: {
      PreToolUse: [
        {
          hooks: [
            (input) => {
              if (input.hook_event_name !== "PreToolUse") {
                return Promise.resolve({});
              }
              const reason = denyReason(
                input.tool_name,
                input.tool_input,
                guard,
              );
              if (reason === undefined) return Promise.resolve({});
              return Promise.resolve({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: reason,
                },
              });
            },
          ],
        },
      ],
    },
  };
}

export function createRunAgent(
  query: QueryFn = sdkQuery,
  runner: RunnerOptions = {},
): RunAgent {
  return async (run) => {
    let limit: { resetsAt: Date | undefined } | undefined;
    let result: Extract<SDKMessage, { type: "result" }> | undefined;
    try {
      for await (const message of query({
        prompt: run.prompt,
        options: buildOptions(run, runner),
      })) {
        if (message.type === "rate_limit_event") {
          const info = message.rate_limit_info;
          if (info.status === "rejected") {
            limit = { resetsAt: resetDate(info.resetsAt) };
          } else {
            limit = undefined;
          }
        } else if (message.type === "result") {
          result = message;
        }
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (limit || LIMIT_PATTERN.test(text)) {
        return { kind: "limit", resetsAt: limit?.resetsAt, message: text };
      }
      return { kind: "error", message: `${run.name}: ${text}` };
    }

    if (!result) {
      return { kind: "error", message: `${run.name}: 結果が返りませんでした` };
    }
    if (result.subtype !== "success" || result.is_error) {
      const text =
        result.subtype === "success"
          ? result.result
          : [result.subtype, ...result.errors].join(": ");
      if (limit || LIMIT_PATTERN.test(text)) {
        return { kind: "limit", resetsAt: limit?.resetsAt, message: text };
      }
      return { kind: "error", message: `${run.name}: ${text}` };
    }
    const output = run.schema.safeParse(result.structured_output);
    if (!output.success) {
      return {
        kind: "error",
        message: `${run.name}: 結果が決めた形になっていません\n${z.prettifyError(output.error)}`,
      };
    }
    return {
      kind: "ok",
      output: output.data,
      costUsd: result.total_cost_usd,
      turns: result.num_turns,
    };
  };
}
