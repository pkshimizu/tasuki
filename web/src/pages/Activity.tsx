/**
 * 活動の履歴。Tasuki が何を見て、どう判断し、何をしたか。
 */
import { Fragment, useState } from "react";
import type {
  ActivityData,
  Directive,
  TimelineItem,
} from "../../../src/admin/types.js";
import type { RunStatus, WorkerRole } from "../../../src/domain/types.js";
import { useLive } from "../api.js";
import { RunStatusBadge } from "../components/Badges.js";
import {
  DirectiveChip,
  directiveLabel,
  outcomeLabel,
  RoleChip,
} from "../components/Chips.js";
import { Icon, ICONS } from "../components/Icon.js";
import { MarkdownBox } from "../components/Markdown.js";
import { splitEventText } from "../components/Timeline.js";
import { dateTime, duration } from "../format.js";
import { type Messages, targetLabel } from "../i18n.js";

type Tab = "decisions" | "runs" | "events";
type DecisionItem = Extract<TimelineItem, { kind: "decision" }>;
type RunItem = Extract<TimelineItem, { kind: "run" }>;
type EventItem = Extract<TimelineItem, { kind: "event" }>;

const names = new Map<string, string>();
const DIRECTIVE_TYPES: Directive["type"][] = [
  "run_agent",
  "ask_human",
  "notify",
  "merge_pr",
  "complete_requirement",
  "wait",
];
const ROLES: WorkerRole[] = [
  "spec-master",
  "planner",
  "designer",
  "programmer",
  "reviewer",
];
const RUN_STATUSES: (RunStatus | "running")[] = [
  "running",
  "done",
  "question",
  "failed",
  "error",
  "limit",
  "interrupted",
];

function Expander({ open }: { open: boolean }) {
  return (
    <Icon d={open ? ICONS.chevronUp : ICONS.chevronDown} size={14} stroke={2} />
  );
}

function Decisions({ t, items }: { t: Messages; items: DecisionItem[] }) {
  const [type, setType] = useState<Directive["type"] | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const shown = items.filter(
    (d) => type === "all" || d.directives.some((x) => x.type === type),
  );
  return (
    <>
      <div className="filters end">
        <label>
          {t.activity.filterDirective}
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as Directive["type"] | "all");
            }}
          >
            <option value="all">{t.common.all}</option>
            {DIRECTIVE_TYPES.map((x) => (
              <option key={x} value={x}>
                {t.directiveTypes[x]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {shown.length === 0 ? (
        <div className="card empty">{t.activity.noDecisions}</div>
      ) : (
        <div className="card table-wrap">
          <table className="table rows">
            <thead>
              <tr>
                <th>{t.activity.at}</th>
                <th>{t.activity.sourceEvents}</th>
                <th>{t.activity.directives}</th>
                <th aria-label={t.common.details} />
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const isOpen = open === d.id;
                return (
                  <Fragment key={d.id}>
                    <tr
                      className={isOpen ? "open" : undefined}
                      onClick={() => {
                        setOpen(isOpen ? null : d.id);
                      }}
                    >
                      <td className="nowrap mono dim">{dateTime(t, d.at)}</td>
                      <td>
                        {d.events.map((e, i) => (
                          <div key={i} className="clamp1">
                            {e}
                          </div>
                        ))}
                      </td>
                      <td>
                        <span className="chips">
                          {d.directives.map((x, i) => (
                            <DirectiveChip
                              key={i}
                              t={t}
                              directive={x}
                              requirementNames={names}
                            />
                          ))}
                        </span>
                      </td>
                      <td className="expander">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={t.common.details}
                        >
                          <Expander open={isOpen} />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="detail">
                        <td colSpan={4}>
                          <div className="detail-grid">
                            <div>
                              <h3>{t.activity.reasoning}</h3>
                              <MarkdownBox
                                t={t}
                                text={d.reasoning}
                                collapsible={false}
                              />
                            </div>
                            <div>
                              <h3>{t.activity.directiveResults}</h3>
                              <ul className="results">
                                {d.directives.map((x, i) => (
                                  <li key={i}>
                                    <strong>
                                      {directiveLabel(t, x, names).label}
                                    </strong>
                                    <span className={`result ${x.outcome}`}>
                                      {outcomeLabel(t, x)}
                                    </span>
                                    {x.detail && <p>{x.detail}</p>}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Runs({ t, items }: { t: Messages; items: RunItem[] }) {
  const [role, setRole] = useState<WorkerRole | "all">("all");
  const [status, setStatus] = useState<RunStatus | "running" | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const shown = items.filter(
    (r) =>
      (role === "all" || r.role === role) &&
      (status === "all" || r.status === status),
  );
  return (
    <>
      <div className="filters end">
        <label>
          {t.activity.agent}
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as WorkerRole | "all");
            }}
          >
            <option value="all">{t.common.all}</option>
            {ROLES.map((x) => (
              <option key={x} value={x}>
                {t.roles[x]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.activity.state}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as RunStatus | "running" | "all");
            }}
          >
            <option value="all">{t.common.all}</option>
            {RUN_STATUSES.map((x) => (
              <option key={x} value={x}>
                {t.runStatus[x]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {shown.length === 0 ? (
        <div className="card empty">{t.activity.noRuns}</div>
      ) : (
        <div className="card table-wrap">
          <table className="table rows">
            <thead>
              <tr>
                <th>{t.activity.agent}</th>
                <th>{t.activity.target}</th>
                <th>{t.activity.state}</th>
                <th>{t.activity.started}</th>
                <th>{t.activity.duration}</th>
                <th>{t.activity.summary}</th>
                <th aria-label={t.common.details} />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const isOpen = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className={isOpen ? "open" : undefined}
                      onClick={() => {
                        setOpen(isOpen ? null : r.id);
                      }}
                    >
                      <td>
                        <RoleChip t={t} role={r.role} />
                      </td>
                      <td className="nowrap num">
                        {targetLabel(t, r.target, names)}
                      </td>
                      <td>
                        <RunStatusBadge t={t} status={r.status} />
                      </td>
                      <td className="nowrap mono dim">{dateTime(t, r.at)}</td>
                      <td className="nowrap mono dim">
                        {r.finishedAt ? duration(r.at, r.finishedAt) : "—"}
                      </td>
                      <td>
                        <div className="clamp1 dim">
                          {r.summary.split("\n")[0]}
                        </div>
                      </td>
                      <td className="expander">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={t.common.details}
                        >
                          <Expander open={isOpen} />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="detail">
                        <td colSpan={7}>
                          <div className="detail-grid">
                            <div>
                              <h3>{t.activity.instruction}</h3>
                              <MarkdownBox t={t} text={r.instruction} />
                            </div>
                            <div>
                              <h3>{t.activity.resultSummary}</h3>
                              {r.summary ? (
                                <MarkdownBox
                                  t={t}
                                  text={r.summary}
                                  collapsible={false}
                                />
                              ) : (
                                <p className="dim">{t.activity.noSummary}</p>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Events({ t, items }: { t: Messages; items: EventItem[] }) {
  if (items.length === 0) {
    return <div className="card empty">{t.activity.noEvents}</div>;
  }
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t.activity.at}</th>
            <th>{t.activity.type}</th>
            <th>{t.activity.content}</th>
            <th>{t.activity.handled}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => {
            const { title, body } = splitEventText(e.text);
            return (
              <tr key={e.id}>
                <td className="nowrap mono dim">{dateTime(t, e.at)}</td>
                <td className="nowrap">{t.eventTypes[e.type]}</td>
                <td>
                  <div>{title}</div>
                  {body && <div className="dim clamp2">{body}</div>}
                </td>
                <td>
                  {e.handled ? (
                    <span className="badge ok">
                      <Icon d={ICONS.check} size={12} stroke={2.2} />
                      {t.activity.handledYes}
                    </span>
                  ) : (
                    <span className="badge warn">{t.activity.handledNo}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Activity({ t }: { t: Messages }) {
  const { data } = useLive<ActivityData>("/api/activity");
  const [tab, setTab] = useState<Tab>("decisions");
  if (!data) return <main className="page" />;
  const tabs: [Tab, string, number][] = [
    ["decisions", t.activity.tabDecisions, data.decisions.length],
    ["runs", t.activity.tabRuns, data.runs.length],
    ["events", t.activity.tabEvents, data.events.length],
  ];
  return (
    <main className="page tight">
      <div className="page-title">
        <h1>{t.menu.activity}</h1>
        <span>{t.activity.subtitle}</span>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
            }}
          >
            {label}
            <span className="n">{count}</span>
          </button>
        ))}
      </div>
      {tab === "decisions" && <Decisions t={t} items={data.decisions} />}
      {tab === "runs" && <Runs t={t} items={data.runs} />}
      {tab === "events" && <Events t={t} items={data.events} />}
    </main>
  );
}
