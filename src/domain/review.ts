/**
 * レビューの記録と、そこから作る文。
 * レビューと修正の往復を少ない周回で収束させるために、指摘に番号と重要度を付けて覚え、
 * 次のレビュアーと、修正する役に、前の周の指摘と対応を確実に渡す。
 * 回数の上限はここでは決めない（事実を司令塔に渡し、判断は司令塔に任せる）。
 */
import { z } from "zod";

export const SEVERITIES = ["blocker", "major", "minor", "nit"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** レビュアーが返す新しい指摘 */
export const newFindingSchema = z.strictObject({
  severity: z
    .enum(SEVERITIES)
    .describe(
      "blocker=このままではマージできない、major=直すべき、minor=直したほうがよい、nit=細かい点",
    ),
  file: z.string().nullable().describe("対象のファイル。特定できなければ null"),
  line: z.number().int().nullable().describe("行番号。特定できなければ null"),
  problem: z.string().describe("何が問題か、なぜ問題か"),
  suggestion: z.string().describe("どう直すか"),
});
export type NewFinding = z.infer<typeof newFindingSchema>;

/** レビュアーが返す、前の周の指摘の解消判定 */
export const resolutionSchema = z.strictObject({
  number: z.number().int().describe("指摘の番号"),
  status: z
    .enum(["resolved", "unresolved", "worsened"])
    .describe(
      "resolved=解消した、unresolved=まだ残っている、worsened=修正で悪くなった",
    ),
  note: z.string().describe("判定の根拠（1〜2 行）"),
});
export type Resolution = z.infer<typeof resolutionSchema>;

/** 修正する役が返す、指摘ごとの対応 */
export const responseSchema = z.strictObject({
  number: z.number().int().describe("指摘の番号"),
  action: z
    .enum(["fixed", "declined", "deferred"])
    .describe(
      "fixed=直した、declined=直さない（誤検知・対象外・意図どおり など）、deferred=設計の変更が要るので別の Issue に持ち越す",
    ),
  note: z.string().describe("どう直したか・確かめ方、または直さない理由"),
});
export type FindingResponse = z.infer<typeof responseSchema>;

export type FindingStatus =
  | "open" // 指摘されたまま、または再レビューで未解消・悪化
  | "fixed" // 直したと報告された（再レビュー待ち）
  | "declined" // 直さないと報告された
  | "deferred" // 持ち越すと報告された
  | "resolved"; // レビュアーが解消を確かめた

export interface Finding extends NewFinding {
  pr: number;
  /** PR の中の通し番号 */
  number: number;
  /** 指摘が出たレビューの回 */
  round: number;
  status: FindingStatus;
  /** 最後の対応か判定の説明 */
  note: string;
}

export interface Review {
  pr: number;
  round: number;
  /** レビューしたコミット */
  sha: string;
  verdict: "approve" | "request_changes";
  runId: number;
  createdAt: string;
}

const SEVERITY_LABELS: Record<Severity, string> = {
  blocker: "blocker",
  major: "major",
  minor: "minor",
  nit: "nit",
};

const STATUS_LABELS: Record<FindingStatus, string> = {
  open: "未対応",
  fixed: "直したと報告",
  declined: "直さないと報告",
  deferred: "別の Issue に持ち越すと報告",
  resolved: "解消済み",
};

function location(f: Pick<Finding, "file" | "line">): string {
  if (f.file === null) return "";
  return `${f.file}${f.line !== null ? `:${String(f.line)}` : ""} `;
}

function findingLine(f: Finding, withStatus: boolean): string {
  const status = withStatus
    ? `\n  状態: ${STATUS_LABELS[f.status]}${f.note ? `（${f.note}）` : ""}`
    : "";
  return `- #${String(f.number)} [${SEVERITY_LABELS[f.severity]}] ${location(f)}${f.problem}\n  直し方: ${f.suggestion}${status}`;
}

/** まだ片付いていない指摘（解消済み以外）を重要度ごとに数える */
export function countOpen(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    blocker: 0,
    major: 0,
    minor: 0,
    nit: 0,
  };
  for (const f of findings) {
    if (f.status === "open" || f.status === "fixed") counts[f.severity]++;
  }
  return counts;
}

/** レビュアーへの指示書に添える、これまでのレビューの経緯 */
export function reviewContext(
  headSha: string,
  reviews: Review[],
  findings: Finding[],
): string {
  const next = Math.max(0, ...findings.map((f) => f.number)) + 1;
  const numbering = `新しい指摘には、#${String(next)} から順に番号を振ります（結果の findings に並べた順が番号になります）。`;
  const last = reviews.at(-1);
  if (!last) {
    return `## レビューの経緯\n\nこの PR の 1 回目のレビューです。PR 全体を見ます。${numbering}`;
  }
  const round = last.round + 1;
  const lines = [
    "## レビューの経緯",
    "",
    `この PR の ${String(round)} 回目のレビューです。前回（${String(last.round)} 回目）はコミット ${last.sha} をレビューし、判定は ${last.verdict} でした。`,
  ];
  if (last.sha === headSha) {
    lines.push(
      "前回から新しいコミットはありません。下の対応の報告を確かめて、解消判定を返します。",
    );
  } else {
    lines.push(
      `今回は、前回からの差分だけを見ます（\`git diff ${last.sha}..HEAD\`。PR 全体は見直しません）。`,
    );
  }
  const pending = findings.filter((f) => f.status !== "resolved");
  if (pending.length > 0) {
    lines.push(
      "",
      "### これまでの指摘と、その後の対応",
      "",
      ...pending.map((f) => findingLine(f, true)),
      "",
      "- 「直したと報告」「未対応」の指摘は、差分を見て解消判定（resolved / unresolved / worsened）を resolutions に返します。",
      "- 「直さないと報告」「持ち越すと報告」の指摘は、理由に納得できれば resolved とし、蒸し返しません。納得できないものだけ unresolved とし、理由を書きます。",
    );
  }
  lines.push("", numbering);
  return lines.join("\n");
}

/** 修正する役への指示書に添える、片付いていない指摘の一覧。無ければ空 */
export function fixContext(findings: Finding[]): string {
  const open = findings.filter((f) => f.status === "open");
  if (open.length === 0) return "";
  const required = open.filter(
    (f) => f.severity === "blocker" || f.severity === "major",
  );
  const optional = open.filter(
    (f) => f.severity === "minor" || f.severity === "nit",
  );
  const lines = ["## レビューの指摘（番号つき）", ""];
  if (required.length > 0) {
    lines.push(
      "### 直す必要がある指摘（blocker / major）",
      "",
      ...required.map((f) => findingLine(f, false)),
      "",
    );
  }
  if (optional.length > 0) {
    lines.push(
      "### 任意の指摘（minor / nit）",
      "",
      ...optional.map((f) => findingLine(f, false)),
      "",
    );
  }
  lines.push(
    "結果の responses に、上の指摘の番号ごとに対応（fixed / declined / deferred）を返します。",
  );
  return lines.join("\n");
}

export interface ReviewState {
  /** レビューした回数 */
  rounds: number;
  lastVerdict: Review["verdict"];
  /** 最後にレビューしたコミットが、今の先頭と同じか */
  reviewedHead: boolean;
  /** 片付いていない指摘の数 */
  open: Record<Severity, number>;
}

/** 司令塔に渡す、PR のレビューの様子。まだレビューしていなければ null */
export function reviewState(
  headSha: string,
  reviews: Review[],
  findings: Finding[],
): ReviewState | null {
  const last = reviews.at(-1);
  if (!last) return null;
  return {
    rounds: last.round,
    lastVerdict: last.verdict,
    reviewedHead: last.sha === headSha,
    open: countOpen(findings),
  };
}

export function describeReviewState(state: ReviewState | null): string {
  if (state === null) return "レビューはまだ";
  const open = SEVERITIES.filter((s) => state.open[s] > 0).map(
    (s) => `${s} ${String(state.open[s])}`,
  );
  return `レビュー ${String(state.rounds)} 回（最後の判定 ${state.lastVerdict}、${
    state.reviewedHead
      ? "今の先頭をレビュー済み"
      : "レビューのあとにコミットが足されている"
  }、片付いていない指摘 ${open.length > 0 ? open.join("・") : "なし"}）`;
}

/**
 * レビューの記録から見て、マージできない理由。マージしてよければ undefined。
 * レビューの記録が無い PR は、ここでは止めない（レビューするかどうかは司令塔が決める）。
 */
export function mergeReviewProblem(
  headSha: string,
  reviews: Review[],
): string | undefined {
  const last = reviews.at(-1);
  if (!last) return undefined;
  if (last.verdict !== "approve") {
    return `最後のレビュー（${String(last.round)} 回目）の判定が request_changes です`;
  }
  if (last.sha !== headSha) {
    return `レビューで approve されたコミット（${last.sha.slice(0, 7)}）のあとに、コミットが足されています。足された分をレビューしてからマージします`;
  }
  return undefined;
}

/** 新しい指摘の数を、司令塔への要約に添える文にする */
export function describeNewFindings(
  findings: NewFinding[],
  firstNumber: number,
): string {
  if (findings.length === 0) return "新しい指摘: なし";
  const counts = SEVERITIES.map((s) => ({
    s,
    n: findings.filter((f) => f.severity === s).length,
  }))
    .filter((c) => c.n > 0)
    .map((c) => `${c.s} ${String(c.n)}`);
  const last = firstNumber + findings.length - 1;
  return `新しい指摘: ${counts.join("・")}（#${String(firstNumber)}${last > firstNumber ? `〜#${String(last)}` : ""}）`;
}
