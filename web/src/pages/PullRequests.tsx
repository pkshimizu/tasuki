/**
 * PR とレビュー。一覧と、PR ごとの詳細（マージできない理由・レビューの回・指摘・経過）。
 */
import { useState } from "react";
import type {
  Finding,
  MergeBlocker,
  PullRequestDetail,
  PullRequestList,
  PullRequestRow,
  ReviewRound,
  Severity,
} from "../../../src/admin/types.js";
import { useLive, useNow } from "../api.js";
import {
  CiBadge,
  FindingStatusBadge,
  OpenFindings,
  ReviewSummary,
  SeverityBadge,
  StageBadge,
  StateBadge,
  VerdictBadge,
} from "../components/Badges.js";
import { RoleChip } from "../components/Chips.js";
import { Icon, ICONS } from "../components/Icon.js";
import { MarkdownBox } from "../components/Markdown.js";
import { linkProps, type Navigate } from "../components/Shell.js";
import { Timeline } from "../components/Timeline.js";
import { ago, dateTime } from "../format.js";
import type { Messages } from "../i18n.js";

const SEVERITIES: Severity[] = ["blocker", "major", "minor", "nit"];
const STATUSES: Finding["status"][] = [
  "open",
  "fixed",
  "declined",
  "deferred",
  "resolved",
];

function Rows({
  t,
  rows,
  navigate,
  now,
}: {
  t: Messages;
  rows: PullRequestRow[];
  navigate: Navigate;
  now: number;
}) {
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>PR</th>
            <th>{t.prs.stage}</th>
            <th>CI</th>
            <th>{t.prs.conflict}</th>
            <th>{t.prs.mergeSetting}</th>
            <th>{t.prs.review}</th>
            <th>{t.prs.openFindings}</th>
            <th>{t.prs.updated}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((pr) => (
            <tr key={pr.number}>
              <td className="cell-title">
                <a {...linkProps("prs", navigate, String(pr.number))}>
                  <span className="num">#{pr.number}</span>
                  <strong>{pr.title}</strong>
                </a>
                <span className="inline wrap">
                  {pr.state !== "open" && <StateBadge t={t} state={pr.state} />}
                  {pr.review &&
                    !pr.review.reviewedHead &&
                    pr.state === "open" && (
                      <span className="badge warn">{t.prs.staleReview}</span>
                    )}
                </span>
              </td>
              <td>
                <StageBadge t={t} stage={pr.stage} />
              </td>
              <td>
                <CiBadge t={t} ci={pr.ci} />
              </td>
              <td>
                {pr.conflicting === null ? (
                  <span className="dim">—</span>
                ) : pr.conflicting ? (
                  <span className="badge err">{t.prs.conflicting}</span>
                ) : (
                  <span className="dim">{t.common.none}</span>
                )}
              </td>
              <td className="nowrap">{t.merge[pr.merge]}</td>
              <td>
                <ReviewSummary t={t} review={pr.review} />
              </td>
              <td>
                <OpenFindings t={t} review={pr.review} />
              </td>
              <td className="nowrap dim">
                {pr.updatedAt ? ago(t, pr.updatedAt, now) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PullRequests({
  t,
  navigate,
}: {
  t: Messages;
  navigate: Navigate;
}) {
  const { data } = useLive<PullRequestList>("/api/prs");
  const [showClosed, setShowClosed] = useState(false);
  const now = useNow();
  if (!data) return <main className="page" />;
  const stale = data.open.some((p) => p.review && !p.review.reviewedHead);
  return (
    <main className="page">
      <div className="page-title">
        <h1>{t.menu.prs}</h1>
        <span>{t.prs.openCount(data.open.length)}</span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => {
              setShowClosed(e.target.checked);
            }}
          />
          {t.prs.showClosed}
        </label>
      </div>
      {data.open.length === 0 ? (
        <div className="card empty">{t.prs.noOpen}</div>
      ) : (
        <Rows t={t} rows={data.open} navigate={navigate} now={now} />
      )}
      {stale && <p className="note">{t.prs.staleNote}</p>}
      {showClosed && (
        <section>
          <div className="section-head">
            <h2>{t.prs.closedTitle}</h2>
            <span className="n">{data.closed.length}</span>
          </div>
          {data.closed.length === 0 ? (
            <div className="card empty">{t.prs.noClosed}</div>
          ) : (
            <Rows t={t} rows={data.closed} navigate={navigate} now={now} />
          )}
        </section>
      )}
    </main>
  );
}

function blockerText(t: Messages, b: MergeBlocker): string {
  switch (b.kind) {
    case "ci_pending":
      return t.blockers.ciPending;
    case "ci_fail":
      return t.blockers.ciFail(b.checks.join(", "));
    case "ci_none":
      return t.blockers.ciNone;
    case "conflict":
      return t.blockers.conflict;
    case "draft":
      return t.blockers.draft;
    case "review_changes":
      return t.blockers.reviewChanges;
    case "review_stale":
      return t.blockers.reviewStale(b.sha.slice(0, 7));
  }
}

function MergeState({ t, detail }: { t: Messages; detail: PullRequestDetail }) {
  const { pr, blockers } = detail;
  if (pr.state !== "open") return null;
  if (blockers.length > 0) {
    return (
      <div className="pr-merge">
        <span className="badge err lg">
          <Icon d={ICONS.blocked} size={13} stroke={2.2} />
          {t.prs.cannotMerge}
        </span>
        <ol className="pr-blockers">
          {blockers.map((b, i) => (
            <li key={i}>
              <span>{i + 1}.</span>
              {blockerText(t, b)}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <div className="pr-merge">
      <span className="badge ok lg">
        <Icon d={ICONS.check} size={13} stroke={2.2} />
        {t.prs.canMerge}
      </span>
      <span className="pr-merge-note">
        {pr.review === null
          ? t.prs.canMergeNoReview
          : pr.merge === "human"
            ? t.prs.waitingHuman
            : t.prs.waitingAuto}
      </span>
    </div>
  );
}

function Review({ t, r }: { t: Messages; r: ReviewRound }) {
  const total = SEVERITIES.reduce((n, s) => n + r.findings[s], 0);
  const parts = SEVERITIES.filter((s) => r.findings[s] > 0).map(
    (s) => `${s} ${String(r.findings[s])}`,
  );
  return (
    <article className="card review">
      <div className="review-head">
        <strong>{t.prs.round(r.round)}</strong>
        <RoleChip t={t} role="reviewer" />
        <VerdictBadge verdict={r.verdict} />
        <span className="dim">
          {t.prs.commit} <span className="mono">{r.sha.slice(0, 7)}</span> ·{" "}
          {dateTime(t, r.at)}
        </span>
        <span className="review-count">
          {total === 0
            ? t.prs.noFindings
            : `${t.prs.findingsCount(total)}（${parts.join(" · ")}）`}
        </span>
      </div>
      <MarkdownBox t={t} text={r.summary} />
    </article>
  );
}

function Findings({ t, findings }: { t: Messages; findings: Finding[] }) {
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [status, setStatus] = useState<Finding["status"] | "all">("all");
  const shown = findings.filter(
    (f) =>
      (severity === "all" || f.severity === severity) &&
      (status === "all" || f.status === status),
  );
  const pending = findings.filter(
    (f) => f.status === "open" || f.status === "fixed",
  ).length;
  return (
    <section aria-labelledby="findings">
      <div className="section-head wrap">
        <h2 id="findings">{t.prs.findings}</h2>
        <span className="n">
          {t.prs.findingsSummary(findings.length, pending)}
        </span>
        <span className="filters">
          <label>
            {t.prs.severity}
            <select
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value as Severity | "all");
              }}
            >
              <option value="all">{t.common.all}</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.prs.status}
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as Finding["status"] | "all");
              }}
            >
              <option value="all">{t.common.all}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t.findingStatus[s]}
                </option>
              ))}
            </select>
          </label>
        </span>
      </div>
      {shown.length === 0 ? (
        <div className="card empty">
          {findings.length === 0 ? t.prs.noFindingsYet : t.prs.noMatch}
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table findings">
            <thead>
              <tr>
                <th>#</th>
                <th>{t.prs.severity}</th>
                <th>{t.prs.location}</th>
                <th>{t.prs.problem}</th>
                <th>{t.prs.suggestion}</th>
                <th>{t.prs.status}</th>
                <th>{t.prs.statusNote}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr
                  key={f.number}
                  className={f.status === "resolved" ? "resolved" : undefined}
                >
                  <td className="num">#{f.number}</td>
                  <td>
                    <SeverityBadge severity={f.severity} />
                  </td>
                  <td className="mono loc">
                    {f.file
                      ? `${f.file}${f.line !== null ? `:${String(f.line)}` : ""}`
                      : "—"}
                  </td>
                  <td>{f.problem}</td>
                  <td className="dim">{f.suggestion}</td>
                  <td>
                    <FindingStatusBadge t={t} status={f.status} />
                  </td>
                  <td className="dim">{f.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function PullRequestPage({
  t,
  number,
  navigate,
}: {
  t: Messages;
  number: string;
  navigate: Navigate;
}) {
  const { data, offline } = useLive<PullRequestDetail>(
    `/api/prs/${encodeURIComponent(number)}`,
  );
  const crumbs = (
    <nav className="crumbs" aria-label={t.common.breadcrumb}>
      <a {...linkProps("prs", navigate)}>{t.menu.prs}</a>
      <span aria-hidden="true">/</span>
      <span>#{number}</span>
    </nav>
  );
  if (!data) {
    return (
      <main className="page tight">
        {crumbs}
        {offline && <div className="card empty">{t.prs.notFound}</div>}
      </main>
    );
  }
  const { pr } = data;
  return (
    <main className="page tight">
      {crumbs}
      <section className="card pr-head" aria-labelledby="pr-title">
        <div className="pr-head-main">
          <div className="pr-head-title">
            <h1 id="pr-title">
              <span className="num">#{pr.number}</span> {pr.title}
            </h1>
            <a
              className="button sm"
              href={pr.url}
              target="_blank"
              rel="noreferrer"
            >
              {t.dashboard.openGithub}
              <Icon d={ICONS.external} size={12} stroke={2} />
            </a>
          </div>
          <div className="meta">
            <StageBadge t={t} stage={pr.stage} />
            <span className="mono branch">{pr.branch}</span>
            {pr.state === "open" ? (
              <CiBadge t={t} ci={pr.ci} />
            ) : (
              <StateBadge t={t} state={pr.state} />
            )}
            <span>{t.merge[pr.merge]}</span>
          </div>
        </div>
        <MergeState t={t} detail={data} />
      </section>

      <section aria-labelledby="reviews">
        <div className="section-head">
          <h2 id="reviews">{t.prs.review}</h2>
          <span className="n">{t.prs.rounds(data.reviews.length)}</span>
        </div>
        {data.reviews.length === 0 ? (
          <div className="card empty">{t.prs.notReviewedYet}</div>
        ) : (
          <div className="stack">
            {data.reviews.map((r) => (
              <Review key={r.round} t={t} r={r} />
            ))}
          </div>
        )}
      </section>

      <Findings t={t} findings={data.findings} />

      <section aria-labelledby="pr-timeline">
        <div className="section-head">
          <h2 id="pr-timeline">{t.prs.timeline}</h2>
        </div>
        <Timeline t={t} items={data.timeline} />
      </section>
    </main>
  );
}
