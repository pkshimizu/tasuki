/**
 * ダッシュボード。上から、要対応・動いているエージェント・進行中の要件・最近の司令塔の判断。
 */
import type {
  AwaitingMerge,
  AwaitingReply,
  DashboardData,
  DecisionSummary,
  Notice,
  RunningAgent,
} from "../../../src/admin/types.js";
import type { Stage } from "../../../src/config/config.js";
import { useLive, useNow } from "../api.js";
import { DirectiveChip, RoleChip } from "../components/Chips.js";
import { Icon, ICONS } from "../components/Icon.js";
import { linkProps, type Navigate } from "../components/Shell.js";
import { ago, clock, elapsed } from "../format.js";
import { type Messages, requirementName, targetLabel } from "../i18n.js";

/** 判断が出てから「新着」と示す時間 */
const FRESH_MS = 60_000;

const STAGE_ICONS: Record<Stage, string> = {
  spec: ICONS.spec,
  design: ICONS.design,
  implementation: ICONS.code,
};

interface Common {
  t: Messages;
  now: number;
  names: ReadonlyMap<string, string>;
  navigate: Navigate;
}

function ReplyRow({
  q,
  t,
  now,
  names,
  navigate,
}: Common & { q: AwaitingReply }) {
  return (
    <div className="turn-row">
      <span className="turn-icon">
        <Icon d={ICONS.question} size={17} />
      </span>
      <div className="turn-main">
        <a
          className="turn-title ellipsis"
          {...linkProps("questions", navigate)}
        >
          {q.title}
        </a>
        <div className="meta">
          {q.origin && <RoleChip t={t} role={q.origin} />}
          {q.target && (
            <>
              <span>
                {t.dashboard.targetLabel}: {targetLabel(t, q.target, names)}
              </span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>{t.dashboard.since(ago(t, q.createdAt, now))}</span>
        </div>
        {q.excerpt && <div className="excerpt ellipsis">{q.excerpt}</div>}
      </div>
      {q.url && (
        <a
          className="button primary"
          href={q.url}
          target="_blank"
          rel="noreferrer"
        >
          {t.dashboard.answerDiscord}
          <Icon d={ICONS.external} size={13} stroke={2} />
        </a>
      )}
    </div>
  );
}

function MergeRow({ pr, t, now, navigate }: Common & { pr: AwaitingMerge }) {
  return (
    <div className="turn-row center">
      <span className="turn-icon ok">
        <Icon d={ICONS.mergeWait} size={17} />
      </span>
      <div className="turn-main">
        <a className="turn-pr" {...linkProps("prs", navigate)}>
          <span className="num">#{pr.number}</span>
          <span className="turn-title ellipsis">{pr.title}</span>
        </a>
        <div className="meta tight">
          <span className="badge outline">
            <Icon d={STAGE_ICONS[pr.stage]} size={12} stroke={2} />
            {t.stages[pr.stage]}
          </span>
          <span className="badge ok">
            <Icon d={ICONS.check} size={12} stroke={2.2} />
            approve
          </span>
          <span className="badge ok">
            <Icon d={ICONS.checkCircle} size={12} stroke={2.2} />
            {t.dashboard.ciPass}
          </span>
          <span>
            {t.dashboard.humanMerge} ·{" "}
            {t.dashboard.updated(ago(t, pr.updatedAt, now))}
          </span>
        </div>
      </div>
      <a className="button" href={pr.url} target="_blank" rel="noreferrer">
        {t.dashboard.openGithub}
        <Icon d={ICONS.external} size={13} stroke={2} />
      </a>
    </div>
  );
}

function NoticeRow({ notice, t }: { notice: Notice; t: Messages }) {
  const [title, help] =
    notice.kind === "dispatcher_failing"
      ? [
          t.dashboard.dispatcherFailing(notice.failures),
          t.dashboard.lastError(notice.error),
        ]
      : [t.dashboard.dirtyWorktree(notice.name), t.dashboard.dirtyWorktreeHelp];
  return (
    <div className="turn-row center">
      <span className="turn-icon warn">
        <Icon d={ICONS.alert} size={17} />
      </span>
      <div className="turn-main">
        <span className="turn-title">{title}</span>
        <span className="notice-text">{help}</span>
      </div>
    </div>
  );
}

function NeedsAction({ data, ...common }: Common & { data: DashboardData }) {
  const { t } = common;
  const total =
    data.awaitingReply.length + data.awaitingMerge.length + data.notices.length;
  if (total === 0) {
    return (
      <section className="card turn-card quiet" aria-labelledby="turn">
        <div className="turn-head">
          <Icon d={ICONS.check} stroke={2} />
          <h2 id="turn" style={{ fontWeight: 500, color: "inherit" }}>
            {t.dashboard.nothing}
          </h2>
        </div>
      </section>
    );
  }
  return (
    <section className="card turn-card" aria-labelledby="turn">
      <div className="turn-head">
        <Icon d={ICONS.clock} stroke={2} />
        <h2 id="turn">{t.needsAction}</h2>
        <span className="count">{total}</span>
      </div>
      {data.awaitingReply.length > 0 && (
        <>
          <div className="turn-group">
            {t.dashboard.awaitingReply} · {data.awaitingReply.length}
          </div>
          {data.awaitingReply.map((q) => (
            <ReplyRow key={q.threadId} q={q} {...common} />
          ))}
        </>
      )}
      {data.awaitingMerge.length > 0 && (
        <>
          <div className="turn-group">
            {t.dashboard.awaitingMerge} · {data.awaitingMerge.length}
          </div>
          {data.awaitingMerge.map((pr) => (
            <MergeRow key={pr.number} pr={pr} {...common} />
          ))}
        </>
      )}
      {data.notices.length > 0 && (
        <>
          <div className="turn-group">
            {t.dashboard.otherNotices} · {data.notices.length}
          </div>
          {data.notices.map((n) => (
            <NoticeRow
              key={n.kind === "dirty_worktree" ? n.name : n.kind}
              notice={n}
              t={t}
            />
          ))}
        </>
      )}
    </section>
  );
}

function AgentCard({
  a,
  t,
  now,
  names,
  navigate,
}: Common & { a: RunningAgent }) {
  return (
    <article className="card agent">
      <div className="agent-top">
        <RoleChip t={t} role={a.role} large />
        <span className="badge ok pill">
          <i />
          {t.dashboard.stRunning}
        </span>
        <span className="elapsed">{elapsed(a.startedAt, now)}</span>
      </div>
      <div className="agent-target">
        <span className="num">{targetLabel(t, a.target, names)}</span>
        {a.targetTitle && <strong className="ellipsis">{a.targetTitle}</strong>}
      </div>
      {a.instruction && (
        <div className="brief">
          <div className="brief-label">{t.dashboard.brief}</div>
          <div className="brief-text clamp3">{a.instruction}</div>
        </div>
      )}
      <div className="agent-foot">
        <span>
          {[
            t.dashboard.startedAt(clock(a.startedAt)),
            a.worktree ? t.dashboard.worktree(a.worktree) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <a className="button sm" {...linkProps("activity", navigate)}>
          {t.dashboard.viewBrief}
        </a>
      </div>
    </article>
  );
}

function DecisionRow({
  d,
  t,
  now,
  names,
  navigate,
}: Common & { d: DecisionSummary }) {
  const fresh = now - new Date(d.at).getTime() < FRESH_MS;
  return (
    <li className={fresh ? "decision fresh" : "decision"}>
      <div className="decision-time">
        <span>{clock(d.at)}</span>
        {fresh && <span className="new">{t.dashboard.fresh}</span>}
      </div>
      <a className="decision-body" {...linkProps("activity", navigate)}>
        <span className="decision-event ellipsis">
          <span>{t.dashboard.event} · </span>
          {d.event}
          {d.moreEvents > 0 && (
            <span> · {t.dashboard.moreEvents(d.moreEvents)}</span>
          )}
        </span>
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
      </a>
    </li>
  );
}

export function Dashboard({
  t,
  navigate,
}: {
  t: Messages;
  navigate: Navigate;
}) {
  const { data } = useLive<DashboardData>("/api/dashboard");
  const now = useNow();
  if (!data) return <main className="page" />;

  const names = new Map(
    data.requirements.map((r) => [r.id, requirementName(r.content)]),
  );
  const common: Common = { t, now, names, navigate };
  const d = t.dashboard;

  return (
    <main className="page">
      <div className="page-title">
        <h1>{d.title}</h1>
        <span>{d.subtitle}</span>
      </div>

      <NeedsAction data={data} {...common} />

      <section aria-labelledby="agents">
        <div className="section-head">
          <h2 id="agents">{d.running}</h2>
          {data.agents.length > 0 && (
            <span className="n">{data.agents.length}</span>
          )}
        </div>
        {data.agents.length === 0 ? (
          <div className="card empty">{d.noAgents}</div>
        ) : (
          <div className="grid-agents">
            {data.agents.map((a) => (
              <AgentCard key={a.runId} a={a} {...common} />
            ))}
          </div>
        )}
      </section>

      <div className="grid-two">
        <section aria-labelledby="reqs">
          <div className="section-head">
            <h2 id="reqs">{d.activeReqs}</h2>
            <span className="n">{data.requirements.length}</span>
            <a {...linkProps("requirements", navigate)}>{d.viewAll} →</a>
          </div>
          {data.requirements.length === 0 ? (
            <div className="card empty">{d.noReqs}</div>
          ) : (
            <div className="stack">
              {data.requirements.map((r) => (
                <a
                  key={r.id}
                  className="card req"
                  {...linkProps("requirements", navigate)}
                >
                  <div className="req-text clamp2">{r.content}</div>
                  <div className="meta">
                    <span className="avatar">
                      {r.author.slice(0, 1).toUpperCase()}
                    </span>
                    <span>{r.author}</span>
                    <span aria-hidden="true">·</span>
                    <span>{ago(t, r.createdAt, now)}</span>
                  </div>
                  {r.questions > 0 && (
                    <div className="chips">
                      <span className="badge accent md">
                        {d.questions} {r.questions}
                      </span>
                    </div>
                  )}
                </a>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="decisions">
          <div className="section-head">
            <h2 id="decisions">{d.decisions}</h2>
            <a {...linkProps("activity", navigate)}>{d.viewHistory} →</a>
          </div>
          {data.decisions.length === 0 ? (
            <div className="card empty">{d.noDecisions}</div>
          ) : (
            <ol className="card decisions">
              {data.decisions.map((x) => (
                <DecisionRow key={x.id} d={x} {...common} />
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
