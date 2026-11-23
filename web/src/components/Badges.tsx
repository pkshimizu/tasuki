/**
 * 状態を示す印（CI・工程・判定・指摘の重要度と状態・実行の状態）。
 */
import type {
  Finding,
  PullRequestRow,
  ReviewState,
  Severity,
} from "../../../src/admin/types.js";
import type { Stage } from "../../../src/config/config.js";
import type { RunStatus } from "../../../src/domain/types.js";
import type { Messages } from "../i18n.js";
import { Icon, ICONS } from "./Icon.js";

const STAGE_ICONS: Record<Stage, string> = {
  spec: ICONS.spec,
  design: ICONS.design,
  implementation: ICONS.code,
};

export function StageBadge({ t, stage }: { t: Messages; stage: Stage }) {
  return (
    <span className="badge outline">
      <Icon d={STAGE_ICONS[stage]} size={12} stroke={2} />
      {t.stages[stage]}
    </span>
  );
}

export function CiBadge({ t, ci }: { t: Messages; ci: PullRequestRow["ci"] }) {
  if (ci === null) return <span className="dim">—</span>;
  const tone = { pass: "ok", fail: "err", pending: "warn", none: "neutral" }[
    ci
  ];
  return (
    <span className={`badge pill ${tone}`}>
      <i />
      {t.ci[ci]}
    </span>
  );
}

export function VerdictBadge({
  verdict,
}: {
  verdict: "approve" | "request_changes";
}) {
  return (
    <span className={verdict === "approve" ? "badge ok" : "badge err"}>
      {verdict}
    </span>
  );
}

export function StateBadge({
  t,
  state,
}: {
  t: Messages;
  state: PullRequestRow["state"];
}) {
  const tone = { open: "ok", merged: "accent", closed: "neutral" }[state];
  return <span className={`badge ${tone}`}>{t.prState[state]}</span>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge sev ${severity}`}>{severity}</span>;
}

const FINDING_TONE: Record<Finding["status"], string> = {
  open: "warn",
  fixed: "info",
  declined: "neutral",
  deferred: "neutral",
  resolved: "ok",
};

export function FindingStatusBadge({
  t,
  status,
}: {
  t: Messages;
  status: Finding["status"];
}) {
  return (
    <span className={`badge pill ${FINDING_TONE[status]}`}>
      {status === "open" && <i />}
      {t.findingStatus[status]}
    </span>
  );
}

const RUN_TONE: Record<RunStatus | "running", string> = {
  running: "ok",
  done: "neutral",
  question: "accent",
  failed: "warn",
  error: "err",
  limit: "warn",
  interrupted: "neutral",
};

export function RunStatusBadge({
  t,
  status,
}: {
  t: Messages;
  status: RunStatus | "running";
}) {
  return (
    <span className={`badge pill ${RUN_TONE[status]}`}>
      {status === "running" && <i />}
      {t.runStatus[status]}
    </span>
  );
}

/** レビューの回数と最後の判定 */
export function ReviewSummary({
  t,
  review,
}: {
  t: Messages;
  review: ReviewState | null;
}) {
  if (review === null) return <span className="dim">{t.prs.notReviewed}</span>;
  return (
    <span className="inline">
      <span>{t.prs.rounds(review.rounds)}</span>
      <VerdictBadge verdict={review.lastVerdict} />
    </span>
  );
}

/** 片付いていない指摘の数（重要度ごと） */
export function OpenFindings({
  t,
  review,
}: {
  t: Messages;
  review: ReviewState | null;
}) {
  const severities: Severity[] = ["blocker", "major", "minor", "nit"];
  const open = severities.filter((s) => (review?.open[s] ?? 0) > 0);
  if (open.length === 0) return <span className="dim">{t.common.none}</span>;
  return (
    <span className="inline">
      {open.map((s) => (
        <span key={s} className={`badge sev ${s}`}>
          {s} {review!.open[s]}
        </span>
      ))}
    </span>
  );
}
