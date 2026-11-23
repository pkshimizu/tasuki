/**
 * 管理画面の、設定の画面。
 *
 * 既定のブランチにある .tasuki/config.yaml をフォームで変える。保存すると、変えた項目だけを
 * 書き換えたファイルを新しいブランチにコミットして、PR を作る（既定のブランチには直接書かない）。
 * 入力の点検は、設定の読み込みと同じ決まり（parseConfig）で行う。
 */
import { isMap, parseDocument } from "yaml";
import { z } from "zod";
import {
  type Config,
  CONFIG_DIR,
  CONFIG_FILE,
  ConfigError,
  configSchema,
  parseConfig,
  ROLES,
} from "../config/config.js";
import type { GitHub } from "../integrations/github.js";
import { KNOWLEDGE_KINDS } from "../knowledge/knowledge.js";
import type { Clock } from "../store/store.js";
import type {
  DiffLine,
  SettingsData,
  SettingsPreview,
  SettingsProblem,
  SettingsSaveResult,
  SettingsValues,
} from "./types.js";

export const SETTINGS_FILE = `${CONFIG_DIR}/${CONFIG_FILE}`;

export interface SettingsSources {
  repo: string;
  github: Pick<GitHub, "fileOnDefault" | "proposeFile">;
  defaultBranch: string;
  /** いま動いている設定 */
  running: Config;
  /** Discord のトークンが環境変数に入っているか */
  tokenSet: boolean;
  clock: Clock;
}

// ---------- フォームの値

const text = z.string().max(500);
const list = z.array(text).max(100);
const record = <K extends string>(keys: readonly K[], value: z.ZodType) =>
  z.strictObject(
    Object.fromEntries(keys.map((k) => [k, value])) as Record<K, z.ZodType>,
  );

/** 画面から届く値の形（中身の決まりは、設定の読み込みと同じものを使う） */
const valuesSchema = z.strictObject({
  poll_interval: z.number().nullable(),
  limits: z.strictObject({ agents: z.number().nullable() }),
  language: text,
  merge: z.strictObject({
    spec: text,
    design: text,
    implementation: text,
    require_ci: z.boolean(),
  }),
  discord: z.strictObject({
    channels: z.strictObject({
      requirements: text,
      questions: text,
      notices: text,
    }),
    allowed_users: list,
  }),
  paths: z.strictObject({ specs: text, design: text, design_system: text }),
  knowledge: record(KNOWLEDGE_KINDS, list),
  workspace: z.strictObject({ setup: list, setup_on_change: list }),
  agents: record(ROLES, text),
});
const requestSchema = z.strictObject({ sha: text, values: valuesSchema });

/** 設定から、フォームの値を作る */
export function valuesOf(config: Config): SettingsValues {
  return {
    poll_interval: config.poll_interval,
    limits: { agents: config.limits.agents },
    language: config.language,
    merge: { ...config.merge },
    discord: {
      channels: { ...config.discord.channels },
      allowed_users: [...config.discord.allowed_users],
    },
    paths: { ...config.paths },
    knowledge: Object.fromEntries(
      KNOWLEDGE_KINDS.map((k) => [k, [...config.knowledge[k]]]),
    ) as SettingsValues["knowledge"],
    workspace: {
      setup: [...config.workspace.setup],
      setup_on_change: [...config.workspace.setup_on_change],
    },
    agents: Object.fromEntries(
      ROLES.map((r) => [r, config.agents[r]?.model ?? ""]),
    ) as SettingsValues["agents"],
  };
}

/** 省略したときの値 */
export function defaultValues(): SettingsValues {
  return valuesOf(
    configSchema.parse({
      github: { repo: "owner/name" },
      discord: {
        channels: {
          requirements: "10000",
          questions: "10001",
          notices: "10002",
        },
        allowed_users: ["10000"],
      },
    }),
  );
}

type Leaf = [path: string[], value: unknown];

/** 値を、項目（道と値）の並びにする。一覧は 1 つの項目として扱う */
function leaves(value: unknown, path: string[] = []): Leaf[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [[path, value]];
  }
  return Object.entries(value).flatMap(([k, v]) => leaves(v, [...path, k]));
}

/** 一覧の空の行を除き、文字の前後の空白を取る */
function tidy(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((x) => (typeof x === "string" ? x.trim() : (x as unknown)))
      .filter((x) => x !== "");
  }
  return typeof value === "string" ? value.trim() : value;
}

function splitProblem(problem: string): SettingsProblem {
  const at = problem.indexOf(": ");
  if (at < 0) return { path: "", message: problem };
  const path = problem.slice(0, at);
  return {
    path: path === "(全体)" ? "" : path,
    message: problem.slice(at + 2),
  };
}

export interface Applied {
  /** 書き換えたあとの中身。変更が無ければ、もとのまま */
  text: string;
  /** 変えた項目（例: poll_interval、merge.spec） */
  changed: string[];
  problems: SettingsProblem[];
}

/**
 * 設定ファイルの中身に、フォームの値を当てはめる。
 * もとと違う項目だけを書き換え、ほかの行とコメントは残す。
 */
export function applySettings(
  current: string,
  values: SettingsValues,
): Applied {
  const before = new Map(
    leaves(valuesOf(parseConfig(current))).map(([p, v]) => [p.join("."), v]),
  );
  const doc = parseDocument(current);
  const changed: string[] = [];
  try {
    for (const [path, raw] of leaves(values)) {
      const value = tidy(raw);
      const key = path.join(".");
      if (JSON.stringify(before.get(key)) === JSON.stringify(value)) continue;
      changed.push(key);
      if (path[0] === "agents") {
        // 空欄は、既定のモデル（項目を書かない）
        const model = [...path, "model"];
        if (value !== "") {
          doc.setIn(model, value);
          continue;
        }
        doc.deleteIn(model);
        for (const parent of [path, ["agents"]]) {
          const node = doc.getIn(parent, true);
          if (isMap(node) && node.items.length === 0) doc.deleteIn(parent);
        }
      } else {
        doc.setIn(path, Array.isArray(value) ? doc.createNode(value) : value);
      }
    }
  } catch (e) {
    return {
      text: current,
      changed,
      problems: [
        {
          path: "",
          message: `設定ファイルを書き換えられません: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }
  if (changed.length === 0) return { text: current, changed, problems: [] };
  const next = doc.toString({ lineWidth: 0 });
  try {
    parseConfig(next);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    return { text: next, changed, problems: e.problems.map(splitProblem) };
  }
  return { text: next, changed, problems: [] };
}

// ---------- 差分

/** 行ごとの差分（最長の共通部分をもとにする） */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // lcs[i][j]: a の i 行目以降と b の j 行目以降の、共通する行の数
  const lcs = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "remove", text: a[i++]! });
    } else {
      out.push({ kind: "add", text: b[j++]! });
    }
  }
  while (i < a.length) out.push({ kind: "remove", text: a[i++]! });
  while (j < b.length) out.push({ kind: "add", text: b[j++]! });
  return out;
}

/** 変わった行と、その前後 context 行だけを残す。飛ばしたところは gap にする */
export function withContext(lines: DiffLine[], context = 2): DiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, i) => {
    if (line.kind === "same" || line.kind === "gap") return;
    const from = Math.max(0, i - context);
    const to = Math.min(lines.length - 1, i + context);
    for (let k = from; k <= to; k++) keep[k] = true;
  });
  const out: DiffLine[] = [];
  lines.forEach((line, i) => {
    if (keep[i]) out.push(line);
    else if (out.length > 0 && out.at(-1)!.kind !== "gap") {
      out.push({ kind: "gap" });
    }
  });
  if (out.at(-1)?.kind === "gap") out.pop();
  return out;
}

// ---------- 画面とのやり取り

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function buildSettings(s: SettingsSources): Promise<SettingsData> {
  const base: SettingsData = {
    repo: s.repo,
    file: SETTINGS_FILE,
    branch: s.defaultBranch,
    sha: null,
    values: null,
    defaults: defaultValues(),
    error: null,
    tokenSet: s.tokenSet,
    differsFromRunning: false,
  };
  let file;
  try {
    file = await s.github.fileOnDefault(SETTINGS_FILE);
  } catch (e) {
    return { ...base, error: describe(e) };
  }
  if (!file) return { ...base, error: "not_found" };
  let config;
  try {
    config = parseConfig(file.text);
  } catch (e) {
    return { ...base, sha: file.sha, error: describe(e) };
  }
  return {
    ...base,
    sha: file.sha,
    values: valuesOf(config),
    differsFromRunning: JSON.stringify(config) !== JSON.stringify(s.running),
  };
}

/** 届いた値を読む。形が違えば undefined */
function readRequest(
  body: unknown,
): { sha: string; values: SettingsValues } | undefined {
  const parsed = requestSchema.safeParse(body);
  return parsed.success
    ? { sha: parsed.data.sha, values: parsed.data.values as SettingsValues }
    : undefined;
}

const BAD_REQUEST: SettingsProblem = {
  path: "",
  message: "画面から届いた値が読めません。画面を読み込み直してください",
};
const CONFLICT =
  "既定のブランチの設定が、画面を開いたあとに変わっています。画面を読み込み直してください";

/** 入力を点検し、保存したときの差分を返す */
export async function previewSettings(
  s: SettingsSources,
  body: unknown,
): Promise<SettingsPreview> {
  const request = readRequest(body);
  if (!request) return { problems: [BAD_REQUEST], changed: [], diff: [] };
  const file = await s.github.fileOnDefault(SETTINGS_FILE);
  if (!file || file.sha !== request.sha) {
    return {
      problems: [{ path: "", message: CONFLICT }],
      changed: [],
      diff: [],
    };
  }
  const applied = applySettings(file.text, request.values);
  return {
    problems: applied.problems,
    changed: applied.changed,
    diff: withContext(lineDiff(file.text, applied.text)),
  };
}

function branchName(now: Date): string {
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  return `tasuki/config-${stamp}`;
}

/** 変更をコミットして PR を作る */
export async function saveSettings(
  s: SettingsSources,
  body: unknown,
): Promise<SettingsSaveResult> {
  const request = readRequest(body);
  if (!request) {
    return { ok: false, reason: "invalid", detail: BAD_REQUEST.message };
  }
  let file;
  try {
    file = await s.github.fileOnDefault(SETTINGS_FILE);
  } catch (e) {
    return { ok: false, reason: "failed", detail: describe(e) };
  }
  if (!file || file.sha !== request.sha) {
    return { ok: false, reason: "conflict", detail: CONFLICT };
  }
  const applied = applySettings(file.text, request.values);
  if (applied.problems.length > 0) {
    return {
      ok: false,
      reason: "invalid",
      detail: applied.problems
        .map((p) => (p.path ? `${p.path}: ${p.message}` : p.message))
        .join("\n"),
    };
  }
  if (applied.changed.length === 0) {
    return { ok: false, reason: "unchanged", detail: "" };
  }
  const title = "chore: Tasuki の設定を変える";
  try {
    const pr = await s.github.proposeFile({
      path: SETTINGS_FILE,
      text: applied.text,
      sha: file.sha,
      branch: branchName(s.clock.now()),
      message: title,
      title,
      body: [
        "Tasuki の管理画面から、設定を変えます。",
        "",
        "変えた項目:",
        ...applied.changed.map((c) => `- \`${c}\``),
        "",
        "マージしたあと、Tasuki を動かしている PC の対象リポジトリのフォルダで `git pull` してから、管理画面で再起動すると反映されます。",
      ].join("\n"),
    });
    return { ok: true, number: pr.number, url: pr.url };
  } catch (e) {
    return { ok: false, reason: "failed", detail: describe(e) };
  }
}
