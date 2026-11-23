/**
 * 対象リポジトリの .tasuki/config.yaml を読む。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** 役の名前。agents.<役> の項目名に使う */
export const ROLES = [
  "dispatcher",
  "spec-master",
  "planner",
  "designer",
  "programmer",
  "reviewer",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  dispatcher: "司令塔",
  "spec-master": "仕様マスター",
  planner: "プランナー",
  designer: "UIデザイナー",
  programmer: "プログラマー",
  reviewer: "レビュアー",
};

/** PR の工程。マージの設定はこの単位で決める */
export const STAGES = ["spec", "design", "implementation"] as const;
export type Stage = (typeof STAGES)[number];

export const TOKEN_ENV = "TASUKI_DISCORD_TOKEN";

const snowflake = z
  .string()
  .regex(/^\d{5,25}$/, '数字だけの ID を文字列（"..."）で書きます');
const mergeMode = z.enum(["auto", "human"]);
const repoPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.includes("..") && !p.includes("\\"), {
    message: "リポジトリからの相対パスを / 区切りで書きます",
  })
  .transform((p) => p.replace(/\/+$/, ""));
/** 1 つのパスか、パスの一覧 */
const pathList = z
  .union([repoPath, z.array(repoPath).min(1)])
  .transform((p) => (typeof p === "string" ? [p] : p));
const agentSchema = z.strictObject({ model: z.string().min(1).optional() });

export const configSchema = z.strictObject({
  github: z.strictObject({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "owner/name の形で書きます"),
  }),
  discord: z.strictObject({
    channels: z.strictObject({
      requirements: snowflake,
      questions: snowflake,
      notices: snowflake,
    }),
    allowed_users: z.array(snowflake).min(1, "1 人以上書きます"),
  }),
  merge: z
    .strictObject({
      spec: mergeMode.default("human"),
      design: mergeMode.default("human"),
      implementation: mergeMode.default("human"),
      /** CI の無いリポジトリで自動マージを使うときだけ false にする */
      require_ci: z.boolean().default(true),
    })
    .prefault({}),
  poll_interval: z.number().int().min(10).max(3600).default(60),
  limits: z
    .strictObject({ agents: z.number().int().min(1).max(10).default(2) })
    .prefault({}),
  language: z.string().min(1).default("日本語"),
  paths: z
    .strictObject({
      specs: repoPath.default("docs/specs"),
      design: repoPath.default("docs/design"),
      design_system: repoPath.default("docs/design-system"),
    })
    .prefault({}),
  /** プロダクトの情報の置き場。種類ごとに、ファイル・フォルダ・その一覧を書ける */
  knowledge: z
    .strictObject({
      context: pathList.default(["docs/CONTEXT.md"]),
      architecture: pathList.default([
        "docs/ARCHITECTURE.md",
        "docs/architecture",
      ]),
      spec_rules: pathList.default(["docs/rules/spec.md"]),
      implementation_rules: pathList.default([
        "docs/rules/implementation.md",
        "docs/rules/implementation",
      ]),
      review_perspectives: pathList.default([
        "docs/review-perspectives.md",
        "docs/review-perspectives",
      ]),
      commit_rules: pathList.default(["docs/rules/commit.md"]),
      task_rules: pathList.default(["docs/rules/task.md"]),
      pr_rules: pathList.default(["docs/rules/pr.md"]),
      merge_rules: pathList.default(["docs/rules/merge.md"]),
    })
    .prefault({}),
  workspace: z
    .strictObject({
      /** 作業フォルダを用意したあとに実行するコマンド（例: npm ci） */
      setup: z.array(z.string().min(1)).default([]),
      /** このファイルが変わったら、準備コマンドをもう一度実行する（例: package-lock.json） */
      setup_on_change: z.array(repoPath).default([]),
    })
    .prefault({}),
  agents: z
    .strictObject({
      dispatcher: agentSchema.optional(),
      "spec-master": agentSchema.optional(),
      planner: agentSchema.optional(),
      designer: agentSchema.optional(),
      programmer: agentSchema.optional(),
      reviewer: agentSchema.optional(),
    })
    .prefault({}),
});
export type Config = z.infer<typeof configSchema>;

export interface LoadedConfig {
  /** 対象リポジトリのフォルダ */
  dir: string;
  config: Config;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
    this.name = "ConfigError";
  }
}

export const CONFIG_DIR = ".tasuki";
export const CONFIG_FILE = "config.yaml";

/** config.yaml の中身（文字列）を点検して返す */
export function parseConfig(text: string): Config {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ConfigError([`YAML として読めません: ${(e as Error).message}`]);
  }
  const result = configSchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map(
        (i) => `${i.path.join(".") || "(全体)"}: ${i.message}`,
      ),
    );
  }
  const { channels } = result.data.discord;
  const ids = [channels.requirements, channels.questions, channels.notices];
  if (new Set(ids).size !== ids.length) {
    throw new ConfigError([
      "discord.channels: 要件・質問・お知らせには別々のチャンネルを書きます",
    ]);
  }
  return result.data;
}

export function loadConfig(dir: string): LoadedConfig {
  const file = join(dir, CONFIG_DIR, CONFIG_FILE);
  if (!existsSync(file)) {
    throw new ConfigError([`${file} がありません`]);
  }
  const config = parseConfig(readFileSync(file, "utf8"));
  return { dir, config };
}

/** Discord のトークン。無ければ理由を返す */
export function discordToken(
  env: Record<string, string | undefined>,
): { token: string } | { problem: string } {
  const token = env[TOKEN_ENV]?.trim();
  if (!token) {
    return {
      problem: `環境変数 ${TOKEN_ENV} に Discord の Bot のトークンを入れてください`,
    };
  }
  return { token };
}

/** file が folder そのものか、その下にあるか（どちらもリポジトリからの相対パス） */
export function isUnder(file: string, folder: string): boolean {
  return file === folder || file.startsWith(`${folder}/`);
}
