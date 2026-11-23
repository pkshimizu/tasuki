/**
 * 設定のフォームの値の扱い（項目の道・変更の見つけ方・取り消し）。
 */
import type { SettingsProblem, SettingsValues } from "../../src/admin/types.js";

/** フォームのまとまり */
export const SECTIONS = [
  "basic",
  "merge",
  "discord",
  "docs",
  "workspace",
  "models",
] as const;
export type Section = (typeof SECTIONS)[number];

/** 項目の値。一覧は 1 つの項目として扱う */
export type FieldValue = string | number | boolean | null | string[];

/** 項目（例: limits.agents）が、どのまとまりにあるか */
export function sectionOf(path: string): Section {
  const head = path.split(".")[0];
  switch (head) {
    case "merge":
      return "merge";
    case "discord":
      return "discord";
    case "paths":
    case "knowledge":
      return "docs";
    case "workspace":
      return "workspace";
    case "agents":
      return "models";
    default:
      return "basic";
  }
}

/** すべての項目の道 */
export function fieldPaths(values: SettingsValues): string[] {
  const walk = (value: unknown, path: string[]): string[] =>
    typeof value !== "object" || value === null || Array.isArray(value)
      ? [path.join(".")]
      : Object.entries(value).flatMap(([k, v]) => walk(v, [...path, k]));
  return walk(values, []);
}

export function getAt(values: SettingsValues, path: string): FieldValue {
  let node: unknown = values;
  for (const key of path.split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[key];
  }
  return node as FieldValue;
}

/** 項目を 1 つ変えた、新しい値を返す（もとは変えない） */
export function setAt(
  values: SettingsValues,
  path: string,
  value: FieldValue,
): SettingsValues {
  const keys = path.split(".");
  const set = (node: unknown, i: number): unknown =>
    i === keys.length
      ? value
      : {
          ...(node as Record<string, unknown>),
          [keys[i]!]: set((node as Record<string, unknown>)[keys[i]!], i + 1),
        };
  return set(values, 0) as SettingsValues;
}

/** 比べるための形にする（一覧の空の行と、前後の空白は無視する。サーバーと同じ） */
function tidy(value: FieldValue): FieldValue {
  if (Array.isArray(value)) {
    return value.map((x) => x.trim()).filter((x) => x !== "");
  }
  return typeof value === "string" ? value.trim() : value;
}

export function sameValue(a: FieldValue, b: FieldValue): boolean {
  return JSON.stringify(tidy(a)) === JSON.stringify(tidy(b));
}

/** もとと違う項目 */
export function changedPaths(
  base: SettingsValues,
  draft: SettingsValues,
): string[] {
  return fieldPaths(base).filter(
    (p) => !sameValue(getAt(base, p), getAt(draft, p)),
  );
}

/** 指定の項目を、もとの値に戻す */
export function resetPaths(
  base: SettingsValues,
  draft: SettingsValues,
  paths: readonly string[],
): SettingsValues {
  return paths.reduce((v, p) => setAt(v, p, getAt(base, p)), draft);
}

/** その項目についての誤り（一覧の何番目、のような下の道の誤りも含む） */
export function problemsFor(
  problems: readonly SettingsProblem[],
  path: string,
): string[] {
  return problems
    .filter((p) => p.path === path || p.path.startsWith(`${path}.`))
    .map((p) => p.message);
}

/** どの項目にも当てはまらない誤り（全体についてのもの、まとまりについてのもの） */
export function otherProblems(
  problems: readonly SettingsProblem[],
  paths: readonly string[],
): SettingsProblem[] {
  return problems.filter(
    (p) => !paths.some((f) => p.path === f || p.path.startsWith(`${f}.`)),
  );
}
