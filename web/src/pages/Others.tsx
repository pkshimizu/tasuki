/**
 * 質問・プロダクトの情報・システムの画面。どれも見るだけ。
 */
import { useState } from "react";
import type {
  ProductData,
  ProductKind,
  QuestionItem,
  SystemData,
} from "../../../src/admin/types.js";
import type { Role } from "../../../src/config/config.js";
import { useLive, useNow } from "../api.js";
import { RoleChip } from "../components/Chips.js";
import { Icon, ICONS } from "../components/Icon.js";
import { Markdown } from "../components/Markdown.js";
import { ago, clock, dateTime } from "../format.js";
import { type Messages, targetLabel } from "../i18n.js";
import { ALL_ROLES } from "../roles.js";

// ---------- 質問

export function Questions({ t }: { t: Messages }) {
  const { data } = useLive<QuestionItem[]>("/api/questions");
  const [selected, setSelected] = useState<string | null>(null);
  const now = useNow();
  if (!data) return <main className="page" />;
  const waiting = data.filter((q) => !q.answered);
  const answered = data.filter((q) => q.answered);
  const current = data.find((q) => q.threadId === selected) ?? data[0];

  const group = (label: string, items: QuestionItem[]) =>
    items.length > 0 && (
      <>
        <div className="list-group">
          {label} · {items.length}
        </div>
        {items.map((q) => (
          <button
            key={q.threadId}
            type="button"
            className="list-item"
            aria-current={q.threadId === current?.threadId}
            onClick={() => {
              setSelected(q.threadId);
            }}
          >
            <strong className="clamp2">{q.title}</strong>
            <span className="meta tight">
              {q.origin && <RoleChip t={t} role={q.origin} />}
              <span>{ago(t, q.createdAt, now)}</span>
            </span>
          </button>
        ))}
      </>
    );

  return (
    <main className="page tight">
      <div className="page-title">
        <h1>{t.menu.questions}</h1>
        <span>{t.questions.subtitle}</span>
      </div>
      {data.length === 0 ? (
        <div className="card empty">{t.questions.none}</div>
      ) : (
        <div className="split">
          <div className="card list">
            {group(t.questions.waiting, waiting)}
            {group(t.questions.answered, answered)}
          </div>
          {current && (
            <article className="card detail-card">
              <div className="detail-head">
                <span
                  className={
                    current.answered
                      ? "badge pill neutral"
                      : "badge pill accent"
                  }
                >
                  {!current.answered && <i />}
                  {current.answered
                    ? t.questions.answered
                    : t.questions.waiting}
                </span>
                <h2>{current.title}</h2>
                <span className="dim">
                  {[
                    current.target
                      ? `${t.dashboard.targetLabel}: ${targetLabel(t, current.target)}`
                      : "",
                    t.questions.createdAt(dateTime(t, current.createdAt)),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <div className="detail-body">
                <Markdown text={current.body} />
              </div>
              <div className="detail-foot">
                {current.url ? (
                  <a
                    className="button primary"
                    href={current.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t.questions.answer}
                    <Icon d={ICONS.external} size={13} stroke={2} />
                  </a>
                ) : (
                  <span className="dim">{t.questions.noLink}</span>
                )}
                <span className="dim">{t.questions.howTo}</span>
              </div>
            </article>
          )}
        </div>
      )}
    </main>
  );
}

// ---------- プロダクトの情報

function chars(kinds: ProductKind[]): number {
  return kinds.reduce(
    (n, k) => n + k.docs.reduce((m, d) => m + d.content.length, 0),
    0,
  );
}

function KindCard({ t, kind }: { t: Messages; kind: ProductKind }) {
  const [open, setOpen] = useState<string | null>(null);
  const label = t.knowledge[kind.kind as keyof Messages["knowledge"]];
  return (
    <section className="card kind">
      <div className="kind-head">
        <h2>{label}</h2>
        <span className="inline wrap">
          {kind.roles.length === ALL_ROLES.length ? (
            <span className="badge neutral">{t.product.allRoles}</span>
          ) : (
            kind.roles.map((r) => <RoleChip key={r} t={t} role={r} />)
          )}
        </span>
      </div>
      {kind.docs.length === 0 ? (
        <div className="kind-missing">
          <span className="badge warn">{t.product.missing}</span>
          <span className="dim">
            {t.product.missingHelp}{" "}
            <span className="mono">{kind.paths.join(" , ")}</span>
          </span>
        </div>
      ) : (
        <ul className="docs">
          {kind.docs.map((d) => {
            const isOpen = open === d.path;
            return (
              <li key={d.path}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => {
                    setOpen(isOpen ? null : d.path);
                  }}
                >
                  <Icon d={ICONS.spec} size={14} />
                  <span className="mono">{d.path}</span>
                  <span className="dim">
                    {t.product.chars(d.content.length)}
                  </span>
                  <Icon
                    d={isOpen ? ICONS.chevronUp : ICONS.chevronDown}
                    size={14}
                    stroke={2}
                  />
                </button>
                {isOpen && (
                  <div className="doc-body">
                    <Markdown text={d.content} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Product({ t }: { t: Messages }) {
  const { data } = useLive<ProductData>("/api/product");
  const [role, setRole] = useState<Role | "all">("all");
  if (!data) return <main className="page" />;
  const kinds =
    role === "all"
      ? data.kinds
      : data.kinds.filter((k) => k.roles.includes(role));
  const docs = kinds.reduce((n, k) => n + k.docs.length, 0);
  return (
    <main className="page tight">
      <div className="page-title">
        <h1>{t.menu.product}</h1>
        <span>{t.product.subtitle}</span>
      </div>
      <div className="bar">
        <span className="dim">
          {data.commit ? `${t.prs.commit} ` : t.product.notLoaded}
          {data.commit && (
            <span className="mono">{data.commit.slice(0, 7)}</span>
          )}
          {data.loadedAt &&
            ` · ${t.product.loadedAt(dateTime(t, data.loadedAt))}`}
        </span>
        <label className="filters">
          {t.product.byRole}
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as Role | "all");
            }}
          >
            <option value="all">{t.common.all}</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {t.roles[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {role !== "all" && (
        <div className="card role-sum">
          <RoleChip t={t} role={role} large />
          <span>{t.product.roleDocs(docs)}</span>
          <strong>{t.product.chars(chars(kinds))}</strong>
        </div>
      )}
      <div className="stack">
        {kinds.map((k) => (
          <KindCard key={k.kind} t={t} kind={k} />
        ))}
      </div>
    </main>
  );
}

// ---------- システム

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function System({ t }: { t: Messages }) {
  const { data } = useLive<SystemData>("/api/system");
  const now = useNow();
  if (!data) return <main className="page" />;
  const s = t.system;
  return (
    <main className="page tight">
      <div className="page-title">
        <h1>{t.menu.system}</h1>
      </div>
      <div className="grid-two">
        <section className="card panel">
          <h2>{s.process}</h2>
          <dl>
            <Field label={s.version}>
              <span className="mono">{data.version}</span>
            </Field>
            <Field label={s.startedAt}>
              {dateTime(t, data.startedAt)}（{ago(t, data.startedAt, now)}）
            </Field>
            <Field label={s.pid}>
              <span className="mono">{data.pid}</span>
            </Field>
            {data.adminUrl && (
              <Field label={s.adminUrl}>
                <span className="mono">{data.adminUrl}</span>
              </Field>
            )}
          </dl>
        </section>
        <section className="card panel">
          <h2>{s.limit}</h2>
          {data.limitUntil ? (
            <p>
              <span className="badge pill warn">{t.status.limited}</span>{" "}
              {t.resumesAt(clock(data.limitUntil))}
            </p>
          ) : (
            <p>
              <span className="badge pill ok">{s.limitNormal}</span>
            </p>
          )}
          <p className="dim">{s.limitHelp}</p>
          <h2>{s.shell}</h2>
          <p>
            <strong>
              {data.shell.name === "bash" ? "Bash" : "PowerShell"}
            </strong>{" "}
            {data.shell.path && (
              <span className="mono dim">{data.shell.path}</span>
            )}
          </p>
          {data.shell.warning && (
            <p className="warn-text">{data.shell.warning}</p>
          )}
        </section>
      </div>

      <section className="card panel">
        <h2>{s.paths}</h2>
        <dl>
          <Field label={s.pathRepo}>
            <span className="mono">{data.paths.repo}</span>
          </Field>
          <Field label={s.pathState}>
            <span className="mono">{data.paths.state}</span>
          </Field>
          <Field label={s.pathWorktrees}>
            <span className="mono">{data.paths.worktrees}</span>
          </Field>
        </dl>
      </section>

      <section>
        <div className="section-head">
          <h2>{s.worktrees}</h2>
          <span className="n">{s.worktreesNote(data.worktrees.length)}</span>
        </div>
        {data.worktrees.length === 0 ? (
          <div className="card empty">{s.noWorktrees}</div>
        ) : (
          <div className="card table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{s.wtName}</th>
                  <th>{t.activity.target}</th>
                  <th>{s.wtBranch}</th>
                  <th>{s.wtDirty}</th>
                  <th>{s.wtSetup}</th>
                </tr>
              </thead>
              <tbody>
                {data.worktrees.map((w) => (
                  <tr key={w.name}>
                    <td className="mono">{w.name}</td>
                    <td>{w.target ? targetLabel(t, w.target) : "—"}</td>
                    <td className="mono dim">{w.branch ?? "—"}</td>
                    <td>
                      {w.dirty ? (
                        <span className="badge warn">{s.wtDirtyYes}</span>
                      ) : (
                        <span className="dim">{t.common.none}</span>
                      )}
                    </td>
                    <td>
                      {w.setupDone === null ? (
                        <span className="dim">—</span>
                      ) : w.setupDone ? (
                        <span className="badge ok">{s.wtSetupDone}</span>
                      ) : (
                        <span className="badge neutral">{s.wtSetupNotYet}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>{s.logs}</h2>
          <span className="n">{s.logsNote}</span>
        </div>
        <pre className="card logs">{data.logs.join("\n")}</pre>
      </section>
    </main>
  );
}
