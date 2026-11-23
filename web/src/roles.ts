/**
 * 役の一覧。サーバーの設定（src/config/config.ts）と同じ並びにする。
 * 画面はサーバーのコードを取り込まないので、ここに持つ。
 */
import type { Role } from "../../src/config/config.js";

export const ALL_ROLES: Role[] = [
  "dispatcher",
  "spec-master",
  "planner",
  "designer",
  "programmer",
  "reviewer",
];
