/**
 * 設定。既定のブランチの .tasuki/config.yaml をフォームで変え、保存すると PR を作る。
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type {
  DiffLine,
  SettingsData,
  SettingsPreview,
  SettingsProblem,
  SettingsSaveResult,
  SettingsValues,
} from "../../../src/admin/types.js";
import type { Role } from "../../../src/config/config.js";
import { postJson } from "../api.js";
import { RoleChip } from "../components/Chips.js";
import { ConfirmDialog } from "../components/Dialog.js";
import { Icon, ICONS } from "../components/Icon.js";
import type { Messages } from "../i18n.js";
import { ALL_ROLES } from "../roles.js";
import {
  changedPaths,
  type FieldValue,
  getAt,
  problemsFor,
  resetPaths,
  sameValue,
  type Section,
  SECTIONS,
  sectionOf,
  setAt,
} from "../settings.js";

const STAGES = ["spec", "design", "implementation"] as const;
const CHANNELS = ["requirements", "questions", "notices"] as const;
const PATHS = ["specs", "design", "design_system"] as const;
/** 入力が止まってから点検するまでの時間 */
const CHECK_DELAY_MS = 400;

/** フォームの部品に渡す、今の様子 */
interface Form {
  t: Messages;
  base: SettingsValues;
  draft: SettingsValues;
  problems: readonly SettingsProblem[];
  set: (path: string, value: FieldValue) => void;
}

function display(t: Messages, value: FieldValue): string {
  if (Array.isArray(value)) {
    const items = value.map((x) => x.trim()).filter(Boolean);
    return items.length > 0 ? items.join(" , ") : t.common.none;
  }
  if (typeof value === "boolean") return value ? t.settings.on : t.settings.off;
  if (value === null || value === "") return t.common.none;
  return String(value);
}

function Field({
  form,
  path,
  label,
  help,
  children,
}: {
  form: Form;
  path: string;
  label: ReactNode;
  help?: string;
  children: ReactNode;
}) {
  const { t } = form;
  const before = getAt(form.base, path);
  const changed = !sameValue(before, getAt(form.draft, path));
  const errors = problemsFor(form.problems, path);
  return (
    <div className={errors.length > 0 ? "set-row invalid" : "set-row"}>
      <div className="set-label">
        <div className="inline wrap">
          <label htmlFor={`f-${path}`}>{label}</label>
          {changed && <span className="badge warn">{t.settings.changed}</span>}
        </div>
        <code>{path}</code>
        {help && <p>{help}</p>}
        {changed && (
          <p className="dim">{t.settings.before(display(t, before))}</p>
        )}
      </div>
      <div className="set-input">
        {children}
        {errors.map((e, i) => (
          <p key={i} className="set-error" role="alert">
            {e}
          </p>
        ))}
      </div>
    </div>
  );
}

function TextInput({
  form,
  path,
  placeholder,
  mono = false,
  list,
}: {
  form: Form;
  path: string;
  placeholder?: string;
  mono?: boolean;
  list?: string;
}) {
  return (
    <input
      id={`f-${path}`}
      type="text"
      className={mono ? "input mono" : "input"}
      value={getAt(form.draft, path) as string}
      placeholder={placeholder}
      list={list}
      onChange={(e) => {
        form.set(path, e.target.value);
      }}
    />
  );
}

function NumberInput({
  form,
  path,
  unit,
}: {
  form: Form;
  path: string;
  unit: string;
}) {
  const value = getAt(form.draft, path) as number | null;
  return (
    <span className="inline">
      <input
        id={`f-${path}`}
        type="number"
        className="input num"
        value={value ?? ""}
        onChange={(e) => {
          const n = e.target.value === "" ? NaN : Number(e.target.value);
          form.set(path, Number.isFinite(n) ? n : null);
        }}
      />
      <span className="dim">{unit}</span>
    </span>
  );
}

/** 行を足したり消したりできる、文字の一覧 */
function ListInput({
  form,
  path,
  add,
  placeholder,
}: {
  form: Form;
  path: string;
  add: string;
  placeholder?: string;
}) {
  const { t } = form;
  const items = getAt(form.draft, path) as string[];
  return (
    <div className="set-list">
      {items.map((item, i) => (
        <span key={i} className="inline">
          <input
            id={i === 0 ? `f-${path}` : undefined}
            type="text"
            className="input mono"
            value={item}
            placeholder={placeholder}
            aria-label={`${path} ${String(i + 1)}`}
            onChange={(e) => {
              form.set(
                path,
                items.map((x, k) => (k === i ? e.target.value : x)),
              );
            }}
          />
          <button
            type="button"
            className="button sm icon"
            aria-label={t.settings.remove}
            title={t.settings.remove}
            onClick={() => {
              form.set(
                path,
                items.filter((_, k) => k !== i),
              );
            }}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        className="button sm"
        id={items.length === 0 ? `f-${path}` : undefined}
        onClick={() => {
          form.set(path, [...items, ""]);
        }}
      >
        ＋ {add}
      </button>
    </div>
  );
}

function SectionCard({
  form,
  id,
  changed,
  children,
}: {
  form: Form;
  id: Section;
  /** このまとまりの、変更のある項目 */
  changed: string[];
  children: ReactNode;
}) {
  const { t } = form;
  return (
    <section className="card set-section" aria-labelledby={`s-${id}`}>
      <div className="set-head">
        <h2 id={`s-${id}`}>{t.settings.sections[id]}</h2>
        {changed.length > 0 && (
          <>
            <span className="badge warn">{t.settings.changed}</span>
            <button
              type="button"
              className="button sm"
              onClick={() => {
                for (const p of changed) form.set(p, getAt(form.base, p));
              }}
            >
              {t.settings.resetSection}
            </button>
          </>
        )}
      </div>
      {children}
    </section>
  );
}

function ReadOnly({
  label,
  name,
  help,
  children,
}: {
  label: string;
  name: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span className="set-name">{label}</span>
        <code>{name}</code>
        <p>{help}</p>
      </div>
      <div className="set-input">{children}</div>
    </div>
  );
}

function Diff({ t, lines }: { t: Messages; lines: DiffLine[] }) {
  return (
    <pre className="diff">
      {lines.map((line, i) =>
        line.kind === "gap" ? (
          <span key={i} className="gap">
            {t.settings.diffGap}
          </span>
        ) : (
          <span key={i} className={line.kind}>
            {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
            {line.text}
          </span>
        ),
      )}
    </pre>
  );
}

function Sections({
  form,
  data,
  changed,
}: {
  form: Form;
  data: SettingsData;
  changed: string[];
}) {
  const { t, draft } = form;
  const s = t.settings;
  const of = (id: Section) => changed.filter((p) => sectionOf(p) === id);
  return (
    <>
      <SectionCard form={form} id="basic" changed={of("basic")}>
        <ReadOnly label={s.repo} name="github.repo" help={s.repoHelp}>
          <span className="mono">{data.repo}</span>
        </ReadOnly>
        <Field
          form={form}
          path="poll_interval"
          label={s.fields.poll_interval}
          help={s.help.poll_interval(data.defaults.poll_interval ?? 60)}
        >
          <NumberInput form={form} path="poll_interval" unit={s.seconds} />
        </Field>
        <Field
          form={form}
          path="limits.agents"
          label={s.fields.agents}
          help={s.help.agents(data.defaults.limits.agents ?? 2)}
        >
          <NumberInput form={form} path="limits.agents" unit={s.upTo} />
        </Field>
        <Field
          form={form}
          path="language"
          label={s.fields.language}
          help={s.help.language}
        >
          <TextInput form={form} path="language" list="languages" />
          <datalist id="languages">
            <option value="日本語" />
            <option value="English" />
          </datalist>
        </Field>
      </SectionCard>

      <SectionCard form={form} id="merge" changed={of("merge")}>
        {STAGES.map((stage) => {
          const path = `merge.${stage}`;
          const value = draft.merge[stage];
          return (
            <Field
              key={stage}
              form={form}
              path={path}
              label={s.mergeOf(t.stages[stage])}
              help={value === "auto" ? s.mergeAutoHelp : s.mergeHumanHelp}
            >
              <div className="seg" role="group" id={`f-${path}`}>
                {(["auto", "human"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={value === mode}
                    onClick={() => {
                      form.set(path, mode);
                    }}
                  >
                    {mode === "auto" ? s.mergeAuto : s.mergeHuman}
                  </button>
                ))}
              </div>
            </Field>
          );
        })}
        <Field
          form={form}
          path="merge.require_ci"
          label={s.fields.require_ci}
          help={s.help.require_ci}
        >
          <label className="inline">
            <input
              id="f-merge.require_ci"
              type="checkbox"
              checked={draft.merge.require_ci}
              onChange={(e) => {
                form.set("merge.require_ci", e.target.checked);
              }}
            />
            {draft.merge.require_ci ? s.on : s.off}
          </label>
          {!draft.merge.require_ci && (
            <p className="warn-text">{s.ciOffWarning}</p>
          )}
        </Field>
      </SectionCard>

      <SectionCard form={form} id="discord" changed={of("discord")}>
        {CHANNELS.map((c) => (
          <Field
            key={c}
            form={form}
            path={`discord.channels.${c}`}
            label={s.channels[c]}
            help={s.help.channels[c]}
          >
            <TextInput form={form} path={`discord.channels.${c}`} mono />
          </Field>
        ))}
        {form.problems
          .filter((p) => p.path === "discord.channels")
          .map((p, i) => (
            <p key={i} className="set-error block" role="alert">
              {p.message}
            </p>
          ))}
        <Field
          form={form}
          path="discord.allowed_users"
          label={s.fields.allowed_users}
          help={s.help.allowed_users}
        >
          <ListInput form={form} path="discord.allowed_users" add={s.addUser} />
        </Field>
        <ReadOnly
          label={s.token}
          name="TASUKI_DISCORD_TOKEN"
          help={s.tokenHelp}
        >
          <span className="inline wrap">
            <span className={data.tokenSet ? "badge ok" : "badge warn"}>
              {data.tokenSet ? s.tokenSet : s.tokenUnset}
            </span>
            <span className="dim">{s.tokenHidden}</span>
          </span>
        </ReadOnly>
      </SectionCard>

      <SectionCard form={form} id="docs" changed={of("docs")}>
        {PATHS.map((p) => (
          <Field
            key={p}
            form={form}
            path={`paths.${p}`}
            label={s.paths[p]}
            help={s.defaultIs(data.defaults.paths[p])}
          >
            <TextInput form={form} path={`paths.${p}`} mono />
          </Field>
        ))}
        <div className="set-sub">
          <h3>{s.knowledge}</h3>
          <p>{s.knowledgeHelp}</p>
        </div>
        {Object.keys(draft.knowledge).map((kind) => (
          <Field
            key={kind}
            form={form}
            path={`knowledge.${kind}`}
            label={t.knowledge[kind as keyof Messages["knowledge"]]}
            help={
              sameValue(
                draft.knowledge[kind] ?? [],
                data.defaults.knowledge[kind] ?? [],
              )
                ? s.isDefault
                : s.defaultIs(display(t, data.defaults.knowledge[kind] ?? []))
            }
          >
            <ListInput form={form} path={`knowledge.${kind}`} add={s.addPath} />
          </Field>
        ))}
      </SectionCard>

      <SectionCard form={form} id="workspace" changed={of("workspace")}>
        <Field
          form={form}
          path="workspace.setup"
          label={s.fields.setup}
          help={s.help.setup}
        >
          <ListInput
            form={form}
            path="workspace.setup"
            add={s.addCommand}
            placeholder="npm ci"
          />
        </Field>
        <Field
          form={form}
          path="workspace.setup_on_change"
          label={s.fields.setup_on_change}
          help={s.help.setup_on_change}
        >
          <ListInput
            form={form}
            path="workspace.setup_on_change"
            add={s.addFile}
            placeholder="package-lock.json"
          />
        </Field>
      </SectionCard>

      <SectionCard form={form} id="models" changed={of("models")}>
        <p className="set-note">{s.modelHelp}</p>
        {ALL_ROLES.map((role: Role) => (
          <Field
            key={role}
            form={form}
            path={`agents.${role}`}
            label={<RoleChip t={t} role={role} />}
          >
            <TextInput
              form={form}
              path={`agents.${role}`}
              mono
              placeholder={s.modelDefault}
            />
          </Field>
        ))}
      </SectionCard>
    </>
  );
}

export function Settings({ t }: { t: Messages }) {
  const s = t.settings;
  const [data, setData] = useState<SettingsData | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<SettingsValues | null>(null);
  /** 点検の結果と、それがどの入力についてのものか */
  const [checked, setChecked] = useState<{
    of: SettingsValues;
    result: SettingsPreview;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState<{ number: number; url: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as SettingsData;
      setData(next);
      setDraft(next.values);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const base = data?.values ?? null;
  const sha = data?.sha ?? null;
  const changed = base && draft ? changedPaths(base, draft) : [];
  const dirty = changed.length > 0;

  // 入力が止まったら、サーバーで点検する（設定の読み込みと同じ決まり）
  useEffect(() => {
    if (!dirty || !draft || sha === null) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void postJson<SettingsPreview>("/api/settings/preview", {
        sha,
        values: draft,
      }).then((result) => {
        if (!cancelled && result) setChecked({ of: draft, result });
      });
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dirty, draft, sha]);

  const preview = dirty && checked?.of === draft ? checked.result : null;
  const problems = preview?.problems ?? [];
  const checking = dirty && preview === null;

  const save = async (): Promise<string | null> => {
    const result = await postJson<SettingsSaveResult>("/api/settings/save", {
      sha,
      values: draft,
    });
    if (result?.ok) {
      setSaved({ number: result.number, url: result.url });
      await load();
      return null;
    }
    if (!result) return t.ops.errors.failed;
    const text = s.saveErrors[result.reason];
    return result.detail ? `${text}\n${result.detail}` : text;
  };

  const title = (
    <div className="page-title">
      <h1>{t.menu.settings}</h1>
      <span>{s.subtitle}</span>
    </div>
  );
  if (!data) {
    return (
      <main className="page tight">
        {title}
        <div className="card empty">{failed ? s.loadFailed : s.loading}</div>
      </main>
    );
  }

  const form: Form | null =
    base && draft
      ? {
          t,
          base,
          draft,
          problems,
          set: (path, value) => {
            setDraft((d) => (d ? setAt(d, path, value) : d));
          },
        }
      : null;
  const sections = SECTIONS.filter((id) =>
    changed.some((p) => sectionOf(p) === id),
  ).map((id) => s.sections[id]);
  // 項目の横に出せない誤り（全体についてのもの）
  const general = problems.filter((p) => p.path === "");

  return (
    <main className="page tight">
      {title}
      {saved && (
        <div className="card set-banner ok" role="status">
          <strong>{s.saved(saved.number)}</strong>
          <span>{s.savedHelp}</span>
          <a
            className="button sm"
            href={saved.url}
            target="_blank"
            rel="noreferrer"
          >
            {s.openPr(saved.number)}
            <Icon d={ICONS.external} size={13} stroke={2} />
          </a>
        </div>
      )}
      {data.error !== null && (
        <div className="card set-banner err" role="alert">
          <strong>
            {data.error === "not_found"
              ? s.notFound(data.file, data.branch)
              : s.cannotRead(data.file, data.branch)}
          </strong>
          {data.error !== "not_found" && (
            <span className="pre">{data.error}</span>
          )}
          <button
            type="button"
            className="button sm"
            onClick={() => void load()}
          >
            {s.reload}
          </button>
        </div>
      )}
      {data.differsFromRunning && (
        <div className="card set-banner" role="note">
          <span>{s.differs(data.branch)}</span>
        </div>
      )}
      {form && (
        <>
          <div className="card set-bar">
            <div className="set-bar-text">
              <strong>
                {dirty
                  ? s.changes(changed.length, sections.join("・"))
                  : s.noChanges}
              </strong>
              {problems.length > 0 && (
                <span className="set-error">{s.problems(problems.length)}</span>
              )}
              {general.map((p, i) => (
                <span key={i} className="set-error">
                  {p.message}
                </span>
              ))}
            </div>
            <button
              type="button"
              className="button sm"
              disabled={!dirty}
              onClick={() => {
                setDraft(resetPaths(form.base, form.draft, changed));
              }}
            >
              {s.resetAll}
            </button>
            <button
              type="button"
              className="button primary sm"
              disabled={!dirty || checking || problems.length > 0}
              onClick={() => {
                setConfirming(true);
              }}
            >
              {s.review}
            </button>
          </div>
          <Sections form={form} data={data} changed={changed} />
        </>
      )}
      {confirming && preview && (
        <ConfirmDialog
          t={t}
          wide
          title={s.confirmTitle(data.file)}
          confirm={s.confirmSave}
          run={save}
          onClose={() => {
            setConfirming(false);
          }}
        >
          <p>{s.confirmBody(preview.changed.length)}</p>
          <Diff t={t} lines={preview.diff} />
        </ConfirmDialog>
      )}
    </main>
  );
}
