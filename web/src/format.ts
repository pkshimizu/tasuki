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
