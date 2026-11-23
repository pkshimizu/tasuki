/**
 * 管理画面の入口。左のメニュー・画面ヘッダーと、道（URL）に合った画面を並べる。
 */
import { useCallback, useEffect, useState } from "react";
import type { AppInfo } from "../../src/admin/types.js";
import { useLive } from "./api.js";
import { Header, type Navigate, Sidebar } from "./components/Shell.js";
import {
  type Lang,
  loadLang,
  type Messages,
  MESSAGES,
  saveLang,
} from "./i18n.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Activity } from "./pages/Activity.js";
import { Product, Questions, System } from "./pages/Others.js";
import { PullRequestPage, PullRequests } from "./pages/PullRequests.js";
import { Requirements } from "./pages/Requirements.js";
import { type Page, pathOf, type Route, routeOf } from "./routes.js";

function Screen({
  t,
  route,
  navigate,
}: {
  t: Messages;
  route: Route;
  navigate: Navigate;
}) {
  switch (route.page) {
    case "dashboard":
      return <Dashboard t={t} navigate={navigate} />;
    case "requirements":
      return <Requirements t={t} id={route.id} navigate={navigate} />;
    case "prs":
      return route.id === null ? (
        <PullRequests t={t} navigate={navigate} />
      ) : (
        <PullRequestPage
          key={route.id}
          t={t}
          number={route.id}
          navigate={navigate}
        />
      );
    case "activity":
      return <Activity t={t} />;
    case "questions":
      return <Questions t={t} />;
    case "product":
      return <Product t={t} />;
    case "system":
      return <System t={t} />;
    default:
      return (
        <main className="page">
          <div className="page-title">
            <h1>{t.menu[route.page]}</h1>
          </div>
          <div className="card placeholder">{t.placeholder}</div>
        </main>
      );
  }
}

export function App() {
  const [lang, setLangState] = useState<Lang>(loadLang);
  const [route, setRoute] = useState<Route>(() => routeOf(location.pathname));
  const page = route.page;
  const { data: app, offline } = useLive<AppInfo>("/api/app");
  const t = MESSAGES[lang];

  const setLang = useCallback((next: Lang) => {
    saveLang(next);
    setLangState(next);
  }, []);

  const navigate = useCallback((next: Page, id: string | null = null) => {
    history.pushState(null, "", pathOf(next, id));
    setRoute({ page: next, id });
    window.scrollTo(0, 0);
  }, []);

  // ブラウザの「戻る」「進む」に合わせる
  useEffect(() => {
    const onPop = () => {
      setRoute(routeOf(location.pathname));
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
        <Screen t={t} route={route} navigate={navigate} />
      </div>
    </div>
  );
}
