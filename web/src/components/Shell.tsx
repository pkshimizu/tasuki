/**
 * 画面の枠組み: 左のメニューと、画面ヘッダー。
 */
import { type MouseEvent, useState } from "react";
import type { AppInfo, DashboardData } from "../../../src/admin/types.js";
import { useLive, useNow } from "../api.js";
import { clock, clockWithSeconds, elapsed, secondsUntil } from "../format.js";
import { type Lang, type Messages, targetLabel } from "../i18n.js";
import { type Page, PAGES, pathOf } from "../routes.js";
import { ConfirmDialog } from "./Dialog.js";
import { Icon, ICONS, Logo, MENU_ICONS } from "./Icon.js";

export type Navigate = (page: Page, id?: string | null) => void;

/** ふつうのクリックだけ画面の中で切り替える（別のタブで開く操作はブラウザに任せる） */
export function linkProps(
  page: Page,
  navigate: Navigate,
  id: string | null = null,
) {
  return {
    href: pathOf(page, id),
    onClick: (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(page, id);
    },
  };
}

/** メニューに出す、人の番の件数 */
function badgeOf(page: Page, app: AppInfo | undefined): number {
  if (!app) return 0;
  if (page === "questions") return app.needsAction.questions;
  if (page === "prs") return app.needsAction.pullRequests;
  return 0;
}

export function Sidebar({
  t,
  active,
  app,
  navigate,
}: {
  t: Messages;
  active: Page;
  app: AppInfo | undefined;
  navigate: Navigate;
}) {
  return (
    <nav className="side" aria-label={t.navLabel}>
      <a className="side-brand" {...linkProps("dashboard", navigate)}>
        <Logo />
        <span>Tasuki</span>
      </a>
      {PAGES.map((page) => {
        const badge = badgeOf(page, app);
        return (
          <div key={page}>
            {page === "settings" && <div className="side-gap" />}
            <a
              className="side-item"
              aria-current={page === active ? "page" : undefined}
              {...linkProps(page, navigate)}
            >
              <Icon d={MENU_ICONS[page]} />
              <span className="label ellipsis">{t.menu[page]}</span>
              {badge > 0 && (
                <span className="count" aria-label={t.needsActionCount(badge)}>
                  {badge}
                </span>
              )}
            </a>
          </div>
        );
      })}
    </nav>
  );
}

function checkText(t: Messages, app: AppInfo, now: number): string {
  const parts: string[] = [];
  if (app.lastCheckAt)
    parts.push(t.lastCheck(clockWithSeconds(app.lastCheckAt)));
  if (app.nextCheckAt) {
    const sec = secondsUntil(app.nextCheckAt, now);
    parts.push(sec > 0 ? t.nextCheck(sec) : t.checking);
  }
  return parts.join(" · ");
}

/** 停止の確認。動いているエージェントを並べる */
function StopDialog({ t, onClose }: { t: Messages; onClose: () => void }) {
  const { data } = useLive<DashboardData>("/api/dashboard");
  const now = useNow();
  const agents = data?.agents ?? [];
  return (
    <ConfirmDialog
      t={t}
      title={t.ops.stopTitle}
      confirm={t.ops.stopConfirm}
      danger
      path="/api/ops/stop"
      onClose={onClose}
    >
      <p>
        {agents.length > 0 ? t.ops.stopBody(agents.length) : t.ops.stopBodyNone}
      </p>
      {agents.length > 0 && (
        <ul className="dialog-list">
          {agents.map((a) => (
            <li key={a.runId}>
              {t.roles[a.role]} · {targetLabel(t, a.target)} ·{" "}
              <span className="mono">{elapsed(a.startedAt, now)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="dim">{t.ops.stopAfter}</p>
    </ConfirmDialog>
  );
}

export function Header({
  t,
  lang,
  setLang,
  app,
  offline,
  navigate,
}: {
  t: Messages;
  lang: Lang;
  setLang: (lang: Lang) => void;
  app: AppInfo | undefined;
  offline: boolean;
  navigate: Navigate;
}) {
  const now = useNow();
  const status = offline ? "offline" : (app?.status ?? "offline");
  const total = app
    ? app.needsAction.questions +
      app.needsAction.pullRequests +
      app.needsAction.notices
    : 0;
  const [dialog, setDialog] = useState<"stop" | "restart" | null>(null);
  const pending = offline ? null : (app?.pending ?? null);
  const close = () => {
    setDialog(null);
  };
  const statusLabel =
    pending === "stop"
      ? t.ops.pendingStop
      : pending === "restart"
        ? t.ops.pendingRestart
        : status === "limited" && app?.limitUntil
          ? `${t.status.limited} · ${t.resumesAt(clock(app.limitUntil))}`
          : t.status[status];

  return (
    <header className="header">
      <div className="header-repo">
        <Icon d={ICONS.repo} />
        <span className="mono ellipsis">{app?.repo ?? ""}</span>
      </div>
      <span className={`status ${pending ? "pending" : status}`}>
        <i />
        {statusLabel}
      </span>
      {app && !offline && (
        <span className="header-check ellipsis">{checkText(t, app, now)}</span>
      )}
      <span className="spacer" />
      <a
        className={total > 0 ? "turn" : "turn none"}
        {...linkProps("dashboard", navigate)}
      >
        <Icon d={ICONS.clock} size={14} stroke={2} />
        {t.needsAction}
        <span className="count">{total}</span>
      </a>
      <div className="lang" role="group" aria-label={t.langLabel}>
        <button
          type="button"
          aria-pressed={lang === "ja"}
          onClick={() => {
            setLang("ja");
          }}
        >
          日本語
        </button>
        <button
          type="button"
          aria-pressed={lang === "en"}
          onClick={() => {
            setLang("en");
          }}
        >
          English
        </button>
      </div>
      {app && !offline && (
        <div className="header-ops">
          <button
            type="button"
            className="button sm"
            disabled={pending !== null}
            onClick={() => {
              setDialog("restart");
            }}
          >
            {t.ops.restart}
          </button>
          <button
            type="button"
            className="button sm"
            disabled={pending === "stop"}
            onClick={() => {
              setDialog("stop");
            }}
          >
            {t.ops.stop}
          </button>
        </div>
      )}
      {app && <span className="version mono">v{app.version}</span>}
      {dialog === "stop" && <StopDialog t={t} onClose={close} />}
      {dialog === "restart" && (
        <ConfirmDialog
          t={t}
          title={t.ops.restartTitle}
          confirm={t.ops.restartConfirm}
          path="/api/ops/restart"
          onClose={close}
        >
          <p>{t.ops.restartBody}</p>
        </ConfirmDialog>
      )}
    </header>
  );
}
