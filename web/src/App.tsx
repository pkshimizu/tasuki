/**
 * 管理画面の入口。左のメニュー・画面ヘッダーと、道（URL）に合った画面を並べる。
 */
import { useCallback, useEffect, useState } from "react";
import type { AppInfo } from "../../src/admin/types.js";
import { useLive } from "./api.js";
import { Header, Sidebar } from "./components/Shell.js";
import { type Lang, loadLang, MESSAGES, saveLang } from "./i18n.js";
import { Dashboard } from "./pages/Dashboard.js";
import { type Page, pageOf, pathOf } from "./routes.js";

export function App() {
  const [lang, setLangState] = useState<Lang>(loadLang);
  const [page, setPage] = useState<Page>(() => pageOf(location.pathname));
  const { data: app, offline } = useLive<AppInfo>("/api/app");
  const t = MESSAGES[lang];

  const setLang = useCallback((next: Lang) => {
    saveLang(next);
    setLangState(next);
  }, []);

  const navigate = useCallback((next: Page) => {
    history.pushState(null, "", pathOf(next));
    setPage(next);
    window.scrollTo(0, 0);
  }, []);

  // ブラウザの「戻る」「進む」に合わせる
  useEffect(() => {
    const onPop = () => {
      setPage(pageOf(location.pathname));
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${t.menu[page]} — Tasuki`;
  }, [lang, page, t]);

  return (
    <div className="app">
      <div className="app-side">
        <Sidebar t={t} active={page} app={app} navigate={navigate} />
      </div>
      <div className="app-body">
        <Header
          t={t}
          lang={lang}
          setLang={setLang}
          app={app}
          offline={offline}
          navigate={navigate}
        />
        {offline && <div className="banner">{t.offlineBanner}</div>}
        {page === "dashboard" ? (
          <Dashboard t={t} navigate={navigate} />
        ) : (
          <main className="page">
            <div className="page-title">
              <h1>{t.menu[page]}</h1>
            </div>
            <div className="card placeholder">{t.placeholder}</div>
          </main>
        )}
      </div>
    </div>
  );
}
