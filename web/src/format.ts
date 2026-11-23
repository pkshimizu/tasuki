/**
 * 時刻と経過時間の表示。
 */
import type { Messages } from "./i18n.js";

/** 時:分（例: 17:48） */
export function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 時:分:秒（例: 17:52:08） */
export function clockWithSeconds(iso: string): string {
  const d = new Date(iso);
  return `${clock(iso)}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/** 「12 分前」のような、今からの隔たり */
export function ago(t: Messages, iso: string, now: number): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return t.ago.now;
  if (minutes < 60) return t.ago.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t.ago.hours(hours);
  return t.ago.days(Math.floor(hours / 24));
}

/** 動き出してからの時間（例: 4:12、1:02:05） */
export function elapsed(iso: string, now: number): string {
  const total = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0
    ? `${String(h)}:${String(m).padStart(2, "0")}:${s}`
    : `${String(m)}:${s}`;
}

/** 次の確認までの秒数。過ぎていれば 0 */
export function secondsUntil(iso: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}

/** 日付の見出し（今日・昨日・月/日） */
export function dayLabel(t: Messages, iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const start = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date(now)) - start(d)) / 86_400_000);
  if (days === 0) return t.day.today;
  if (days === 1) return t.day.yesterday;
  return t.day.date(d.getMonth() + 1, d.getDate());
}

/** 日付と時刻（例: 今日 17:44、11/22 09:05） */
export function dateTime(t: Messages, iso: string, now = Date.now()): string {
  return `${dayLabel(t, iso, now)} ${clock(iso)}`;
}

/** 始まりから終わりまでの時間（例: 2:05） */
export function duration(startIso: string, endIso: string): string {
  return elapsed(startIso, new Date(endIso).getTime());
}
