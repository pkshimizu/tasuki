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

export function pathOf(page: Page): string {
  return page === "dashboard" ? "/" : `/${page}`;
}

/** 道から画面を決める。知らない道はダッシュボード */
export function pageOf(path: string): Page {
  const first = path.split("/").filter(Boolean)[0];
  return PAGES.find((p) => p === first) ?? "dashboard";
}
