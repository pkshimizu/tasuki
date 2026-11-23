/**
 * 画面の道（URL）と、メニューの項目。
 */
export const PAGES = [
  "dashboard",
  "requirements",
  "prs",
  "activity",
  "questions",
  "product",
  "settings",
  "system",
] as const;
export type Page = (typeof PAGES)[number];

/** 今いる場所。id は、詳細の画面で開いているもの（PR の番号など） */
export interface Route {
  page: Page;
  id: string | null;
}

export function pathOf(page: Page, id: string | null = null): string {
  const base = page === "dashboard" ? "/" : `/${page}`;
  return id === null ? base : `${base}/${encodeURIComponent(id)}`;
}

/** 道から画面を決める。知らない道はダッシュボード */
export function routeOf(path: string): Route {
  const [first, second] = path.split("/").filter(Boolean);
  const page = PAGES.find((p) => p === first);
  if (!page) return { page: "dashboard", id: null };
  let id: string | null = null;
  if (second !== undefined && page !== "dashboard") {
    try {
      id = decodeURIComponent(second);
    } catch {
      id = null;
    }
  }
  return { page, id };
}
