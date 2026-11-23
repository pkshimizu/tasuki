/**
 * 経過の時系列。出来事・司令塔の判断・エージェントの実行を 1 本に並べる。
 */
import type { CSSProperties } from "react";
import type { TimelineItem } from "../../../src/admin/types.js";
import { clock, dayLabel, duration } from "../format.js";
import { type Messages, targetLabel } from "../i18n.js";
import { RunStatusBadge } from "./Badges.js";
import { DirectiveChip, RoleChip } from "./Chips.js";
import { MarkdownBox } from "./Markdown.js";

/** 出来事の内容を、見出し（1 行目）と本文（2 行目から）に分ける */
export function splitEventText(text: string): { title: string; body: string } {
  const [first = "", ...rest] = text.split("\n");
  return { title: first.replace(/:$/, ""), body: rest.join("\n").trim() };
}

function markStyle(item: TimelineItem): CSSProperties {
  if (item.kind === "event") {
    return { background: "var(--panel)", border: "2px solid var(--faint)" };
  }
  const color =
    item.kind === "decision" ? "var(--r-dispatcher)" : `var(--r-${item.role})`;
  return { background: color, border: `2px solid ${color}` };
}

function Body({
  item,
  t,
  names,
}: {
  item: TimelineItem;
  t: Messages;
  names: ReadonlyMap<string, string>;
}) {
  if (item.kind === "event") {
    const { title, body } = splitEventText(item.text);
    return (
      <>
        <div className="tl-head">
          <span className="tl-kind">{t.timeline.event}</span>
          <span className="tl-meta">{t.eventTypes[item.type]}</span>
        </div>
        <div className="tl-title">{title}</div>
        {body && <div className="tl-body">{body}</div>}
      </>
    );
  }
  if (item.kind === "decision") {
    return (
      <>
        <div className="tl-head">
          <span className="tl-kind">{t.timeline.decision}</span>
          <RoleChip t={t} role="dispatcher" />
        </div>
        {item.events.length > 0 && (
          <div className="tl-body">
            {item.events.map((e, i) => (
              <div key={i} className="ellipsis">
                {t.dashboard.event} · {e}
              </div>
            ))}
          </div>
        )}
        {item.directives.length > 0 && (
          <span className="chips">
            {item.directives.map((x, i) => (
              <DirectiveChip
                key={i}
                t={t}
                directive={x}
                requirementNames={names}
              />
            ))}
          </span>
        )}
        <MarkdownBox t={t} text={item.reasoning} />
      </>
    );
  }
  return (
    <>
      <div className="tl-head">
        <span className="tl-kind">{t.timeline.run}</span>
        <RoleChip t={t} role={item.role} />
        <span className="num">{targetLabel(t, item.target, names)}</span>
        <RunStatusBadge t={t} status={item.status} />
        {item.finishedAt && (
          <span className="tl-meta">{duration(item.at, item.finishedAt)}</span>
        )}
      </div>
      <MarkdownBox t={t} text={item.summary} />
    </>
  );
}

export function Timeline({
  t,
  items,
  names = new Map(),
}: {
  t: Messages;
  items: TimelineItem[];
  names?: ReadonlyMap<string, string>;
}) {
  if (items.length === 0) {
    return <div className="card empty">{t.timeline.empty}</div>;
  }
  return (
    <ol className="tl">
      {items.map((item, i) => (
        <li key={item.id} className="tl-item">
          <div className="tl-time">
            <span>{clock(item.at)}</span>
            <small>{dayLabel(t, item.at)}</small>
          </div>
          <div className="tl-rail">
            {i < items.length - 1 && <span className="tl-line" />}
            <span className="tl-mark" style={markStyle(item)} />
          </div>
          <div className="tl-cell">
            <div className={`tl-card ${item.kind}`}>
              <Body item={item} t={t} names={names} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
