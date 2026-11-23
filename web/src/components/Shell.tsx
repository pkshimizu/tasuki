/**
 * 画面の枠組み: 左のメニューと、画面ヘッダー。
 */
import type { MouseEvent } from "react";
import type { AppInfo } from "../../../src/admin/types.js";
import { useNow } from "../api.js";
import { clock, clockWithSeconds, secondsUntil } from "../format.js";
import type { Lang, Messages } from "../i18n.js";
import { type Page, PAGES, pathOf } from "../routes.js";
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
  const statusLabel =
    status === "limited" && app?.limitUntil
      ? `${t.status.limited} · ${t.resumesAt(clock(app.limitUntil))}`
      : t.status[status];

  return (
    <header className="header">
      <div className="header-repo">
        <Icon d={ICONS.repo} />
        <span className="mono ellipsis">{app?.repo ?? ""}</span>
      </div>
      <span className={`status ${status}`}>
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
      {app && <span className="version mono">v{app.version}</span>}
    </header>
  );
}
