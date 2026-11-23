/**
 * 要件。一覧（進行中／完了の絞り込み）と、要件ごとの詳細（本文・関連するもの・経過）。
 */
import { useState } from "react";
import type {
  RelatedItem,
  RequirementDetail,
  RequirementRow,
} from "../../../src/admin/types.js";
import { useLive, useNow } from "../api.js";
import { StageBadge, StateBadge } from "../components/Badges.js";
import { RoleChip } from "../components/Chips.js";
import { Icon, ICONS } from "../components/Icon.js";
import { Markdown } from "../components/Markdown.js";
import { linkProps, type Navigate } from "../components/Shell.js";
import { Timeline } from "../components/Timeline.js";
import { ago, dateTime } from "../format.js";
import { type Messages, requirementName } from "../i18n.js";

type Filter = "all" | "open" | "done";
type Kind = "all" | RelatedItem["kind"];

export function RequirementBadge({
  t,
  status,
}: {
  t: Messages;
  status: RequirementRow["status"];
}) {
  return status === "open" ? (
    <span className="badge pill accent">
      <i />
      {t.requirements.open}
    </span>
  ) : (
    <span className="badge pill neutral">{t.requirements.done}</span>
  );
}

/** 関連するものの 1 行 */
function RelatedRow({
  t,
  item,
  navigate,
  now,
}: {
  t: Messages;
  item: RelatedItem;
  navigate: Navigate;
  now: number;
}) {
  const at = item.at === null ? "" : ago(t, item.at, now);
  if (item.kind === "question") {
    return (
      <li>
        <a className="rel" {...linkProps("questions", navigate)}>
          <span className="rel-kind">{t.menu.questions}</span>
          <strong>{item.title}</strong>
          {item.origin && <RoleChip t={t} role={item.origin} />}
          <span className={item.done ? "badge neutral" : "badge accent"}>
            {item.done ? t.questions.answered : t.questions.waiting}
          </span>
          <span className="rel-at">{at}</span>
        </a>
      </li>
    );
  }
  if (item.kind === "issue") {
    return (
      <li>
        <a className="rel" href={item.url} target="_blank" rel="noreferrer">
          <span className="rel-kind">Issue</span>
          <span className="num">#{item.number}</span>
          <strong>{item.title ?? t.requirements.noTitle}</strong>
          {item.state && (
            <span
              className={item.state === "open" ? "badge ok" : "badge neutral"}
            >
              {t.requirements.issueState[item.state]}
            </span>
          )}
          <span className="rel-at">{at}</span>
          <Icon d={ICONS.external} size={13} stroke={2} />
        </a>
      </li>
    );
  }
  return (
    <li>
      <a className="rel" {...linkProps("prs", navigate, String(item.number))}>
        <span className="rel-kind">PR</span>
        <span className="num">#{item.number}</span>
        <strong>{item.title ?? t.requirements.noTitle}</strong>
        {item.stage && <StageBadge t={t} stage={item.stage} />}
        {item.state && <StateBadge t={t} state={item.state} />}
        <span className="rel-at">{at}</span>
      </a>
    </li>
  );
}

function Related({
  t,
  items,
  done,
  navigate,
}: {
  t: Messages;
  items: RelatedItem[];
  /** 完了した要件か。終わったものを最初から表示する */
  done: boolean;
  navigate: Navigate;
}) {
  const [kind, setKind] = useState<Kind>("all");
  const [showDone, setShowDone] = useState(done);
  const now = useNow();
  const r = t.requirements;
  const visible = items.filter((x) => showDone || !x.done);
  const count = (k: Kind) =>
    visible.filter((x) => k === "all" || x.kind === k).length;
  const tabs: [Kind, string][] = [
    ["all", t.common.all],
    ["question", t.menu.questions],
    ["issue", "Issue"],
    ["pr", "PR"],
  ];
  const shown = visible.filter((x) => kind === "all" || x.kind === kind);
  return (
    <section aria-labelledby="related">
      <div className="section-head wrap">
        <h2 id="related">{r.related}</h2>
        <span className="n">
          {r.relatedSummary(items.length, items.filter((x) => !x.done).length)}
        </span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => {
              setShowDone(e.target.checked);
            }}
          />
          {r.showDone}
        </label>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={kind === id}
            onClick={() => {
              setKind(id);
            }}
          >
            {label}
            <span className="n">{count(id)}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="card empty">
          {items.length === 0 ? r.noRelated : r.noRelatedShown}
        </div>
      ) : (
        <ul className="card rel-list">
          {shown.map((x) => (
            <RelatedRow
              key={x.id}
              t={t}
              item={x}
              navigate={navigate}
              now={now}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Detail({
  t,
  id,
  navigate,
}: {
  t: Messages;
  id: string;
  navigate: Navigate;
}) {
  const { data, offline } = useLive<RequirementDetail>(
    `/api/requirements/${encodeURIComponent(id)}`,
  );
  const [oldestFirst, setOldestFirst] = useState(false);
  const now = useNow();
  const r = t.requirements;
  if (!data) {
    return offline ? <div className="card empty">{r.notFound}</div> : <div />;
  }
  const req = data.requirement;
  const names = new Map([[req.id, requirementName(req.content)]]);
  const timeline = oldestFirst ? [...data.timeline].reverse() : data.timeline;
  return (
    <div className="stack wide">
      <article className="card detail-card">
        <div className="detail-head">
          <RequirementBadge t={t} status={req.status} />
          <span className="dim">
            {req.author} · {dateTime(t, req.createdAt)}（
            {ago(t, req.createdAt, now)}）
          </span>
        </div>
        <div className="detail-body req-body">
          <Markdown text={req.content} />
        </div>
        {req.url && (
          <div className="detail-foot">
            <a
              className="button sm"
              href={req.url}
              target="_blank"
              rel="noreferrer"
            >
              {r.openDiscord}
              <Icon d={ICONS.external} size={13} stroke={2} />
            </a>
          </div>
        )}
      </article>

      <Related
        key={req.id}
        t={t}
        items={data.related}
        done={req.status === "done"}
        navigate={navigate}
      />

      <section aria-labelledby="req-timeline">
        <div className="section-head wrap">
          <h2 id="req-timeline">{r.timeline}</h2>
          <span className="n">{r.timelineCount(data.timeline.length)}</span>
          <label className="filters">
            <select
              aria-label={r.order}
              value={oldestFirst ? "old" : "new"}
              onChange={(e) => {
                setOldestFirst(e.target.value === "old");
              }}
            >
              <option value="new">{r.newestFirst}</option>
              <option value="old">{r.oldestFirst}</option>
            </select>
          </label>
        </div>
        <Timeline t={t} items={timeline} names={names} />
      </section>
    </div>
  );
}

export function Requirements({
  t,
  id,
  navigate,
}: {
  t: Messages;
  id: string | null;
  navigate: Navigate;
}) {
  const { data } = useLive<RequirementRow[]>("/api/requirements");
  const [filter, setFilter] = useState<Filter>("all");
  const now = useNow();
  const r = t.requirements;
  if (!data) return <main className="page" />;
  const count = (f: Filter) =>
    data.filter((x) => f === "all" || x.status === f).length;
  const filters: [Filter, string][] = [
    ["all", t.common.all],
    ["open", r.open],
    ["done", r.done],
  ];
  const rows = data.filter((x) => filter === "all" || x.status === filter);
  // 道で選ばれた要件。無ければ、一覧の先頭
  const current = id ?? rows[0]?.id ?? null;

  return (
    <main className="page tight">
      <div className="page-title">
        <h1>{t.menu.requirements}</h1>
        <span>{r.subtitle}</span>
      </div>
      {data.length === 0 ? (
        <div className="card empty">{r.none}</div>
      ) : (
        <div className="split">
          <div className="card list">
            <div className="tabs pad" role="tablist">
              {filters.map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => {
                    setFilter(f);
                  }}
                >
                  {label}
                  <span className="n">{count(f)}</span>
                </button>
              ))}
            </div>
            {rows.length === 0 && <div className="empty">{r.noneShown}</div>}
            {rows.map((x) => (
              <a
                key={x.id}
                className="list-item"
                aria-current={x.id === current}
                {...linkProps("requirements", navigate, x.id)}
              >
                <strong className="clamp2">{x.content}</strong>
                <span className="meta tight">
                  <RequirementBadge t={t} status={x.status} />
                  <span>{x.author}</span>
                  <span aria-hidden="true">·</span>
                  <span>{ago(t, x.createdAt, now)}</span>
                </span>
                {x.counts.waiting > 0 && (
                  <span className="chips">
                    <span className="badge accent md">
                      {r.waiting(x.counts.waiting)}
                    </span>
                  </span>
                )}
              </a>
            ))}
          </div>
          {current !== null && (
            <Detail key={current} t={t} id={current} navigate={navigate} />
          )}
        </div>
      )}
    </main>
  );
}
