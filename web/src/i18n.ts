/**
 * 画面の文言（日本語と英語）。
 * エージェントが書いた文章（判断の理由、要約など）は、ここでは訳さない。
 */
import type { AppStatus, Directive } from "../../src/admin/types.js";
import type { Role, Stage } from "../../src/config/config.js";
import type { Target } from "../../src/domain/types.js";

export type Lang = "ja" | "en";

const ja = {
  navLabel: "メインメニュー",
  langLabel: "表示の言語",
  menu: {
    dashboard: "ダッシュボード",
    requirements: "要件",
    prs: "PR とレビュー",
    activity: "活動の履歴",
    questions: "質問",
    product: "プロダクトの情報",
    settings: "設定",
    system: "システム",
  },
  needsAction: "要対応",
  needsActionCount: (n: number) => `要対応 ${String(n)} 件`,
  status: {
    running: "動作中",
    idle: "待機中",
    limited: "利用上限で待機中",
    stopped: "停止中",
    offline: "接続できません",
  } satisfies Record<AppStatus | "offline", string>,
  resumesAt: (time: string) => `${time} に再開`,
  lastCheck: (time: string) => `最後の確認 ${time}`,
  nextCheck: (sec: number) => `次の確認まで ${String(sec)} 秒`,
  checking: "確認中",
  offlineBanner:
    "Tasuki に接続できません。tasuki start が動いているか確かめてください。つながると自動で表示が戻ります。",
  roles: {
    dispatcher: "司令塔",
    "spec-master": "仕様マスター",
    planner: "プランナー",
    designer: "UIデザイナー",
    programmer: "プログラマー",
    reviewer: "レビュアー",
  } satisfies Record<Role, string>,
  stages: {
    spec: "仕様",
    design: "デザイン",
    implementation: "実装",
  } satisfies Record<Stage, string>,
  target: {
    requirement: (name: string) => `要件「${name}」`,
    requirementUnknown: "要件",
    issue: (n: number) => `Issue #${String(n)}`,
    pr: (n: number) => `PR #${String(n)}`,
    repo: "リポジトリ全体",
  },
  dashboard: {
    title: "ダッシュボード",
    subtitle: "表示は自動で更新されます",
    nothing: "要対応のものはありません",
    awaitingReply: "返信待ちの質問",
    awaitingMerge: "マージ待ちの PR",
    otherNotices: "そのほかの知らせ",
    targetLabel: "対象",
    since: (ago: string) => `${ago}から`,
    answerDiscord: "Discord で回答",
    openGithub: "GitHub で開く",
    ciPass: "CI 合格",
    humanMerge: "人がマージ",
    updated: (ago: string) => `${ago}に更新`,
    dispatcherFailing: (n: number) =>
      `司令塔の実行に ${String(n)} 回続けて失敗しています`,
    lastError: (text: string) => `最後のエラー: ${text}`,
    dirtyWorktree: (name: string) => `消せない作業フォルダがあります: ${name}`,
    dirtyWorktreeHelp:
      "コミットしていない変更が残っています。中身を確かめてから手で消してください",
    running: "動いているエージェント",
    stRunning: "実行中",
    noAgents: "動いているエージェントはありません。次の出来事を待っています",
    brief: "指示書",
    viewBrief: "指示書を見る",
    startedAt: (time: string) => `${time} に開始`,
    worktree: (name: string) => `作業フォルダ ${name}`,
    activeReqs: "進行中の要件",
    noReqs: "進行中の要件はありません",
    viewAll: "すべて見る",
    questions: "質問",
    decisions: "最近の司令塔の判断",
    noDecisions: "司令塔の判断はまだありません",
    viewHistory: "活動の履歴",
    fresh: "新着",
    event: "出来事",
    moreEvents: (n: number) => `ほか ${String(n)} 件`,
  },
  directive: {
    launch: (role: string, target: string) => `${role}を起動（${target}）`,
    ask: "人に質問",
    notify: "お知らせ",
    merge: (target: string) => `マージ（${target}）`,
    complete: "要件を完了",
    wait: "待つ",
  },
  outcome: {
    run_agent: "起動した",
    ask_human: "投稿した",
    notify: "書いた",
    merge_pr: "マージした",
    complete_requirement: "完了にした",
    wait: "待った",
    skipped: "見送り",
    failed: "失敗",
  } satisfies Record<Directive["type"] | "skipped" | "failed", string>,
  ago: {
    now: "たった今",
    minutes: (n: number) => `${String(n)} 分前`,
    hours: (n: number) => `${String(n)} 時間前`,
    days: (n: number) => `${String(n)} 日前`,
  },
  placeholder: "この画面は準備中です。",
};

export type Messages = typeof ja;

const en: Messages = {
  navLabel: "Main menu",
  langLabel: "Display language",
  menu: {
    dashboard: "Dashboard",
    requirements: "Requirements",
    prs: "Pull requests & reviews",
    activity: "Activity history",
    questions: "Questions",
    product: "Product knowledge",
    settings: "Settings",
    system: "System",
  },
  needsAction: "Needs action",
  needsActionCount: (n) => `${String(n)} need action`,
  status: {
    running: "Running",
    idle: "Idle",
    limited: "Paused by usage limit",
    stopped: "Stopped",
    offline: "Disconnected",
  },
  resumesAt: (time) => `resumes ${time}`,
  lastCheck: (time) => `Last checked ${time}`,
  nextCheck: (sec) => `next check in ${String(sec)}s`,
  checking: "checking",
  offlineBanner:
    "Cannot reach Tasuki. Make sure tasuki start is running. The page reconnects automatically.",
  roles: {
    dispatcher: "Dispatcher",
    "spec-master": "Spec Master",
    planner: "Planner",
    designer: "UI Designer",
    programmer: "Programmer",
    reviewer: "Reviewer",
  },
  stages: { spec: "Spec", design: "Design", implementation: "Implementation" },
  target: {
    requirement: (name) => `Requirement “${name}”`,
    requirementUnknown: "Requirement",
    issue: (n) => `Issue #${String(n)}`,
    pr: (n) => `PR #${String(n)}`,
    repo: "Whole repository",
  },
  dashboard: {
    title: "Dashboard",
    subtitle: "Updates automatically",
    nothing: "Nothing needs your action",
    awaitingReply: "Questions awaiting your reply",
    awaitingMerge: "Pull requests awaiting your merge",
    otherNotices: "Other notices",
    targetLabel: "Target",
    since: (ago) => `waiting since ${ago}`,
    answerDiscord: "Answer on Discord",
    openGithub: "Open on GitHub",
    ciPass: "CI passed",
    humanMerge: "Human merges",
    updated: (ago) => `updated ${ago}`,
    dispatcherFailing: (n) =>
      `The dispatcher has failed ${String(n)} times in a row`,
    lastError: (text) => `Last error: ${text}`,
    dirtyWorktree: (name) => `A work folder could not be removed: ${name}`,
    dirtyWorktreeHelp:
      "It has uncommitted changes. Check its contents, then remove it by hand",
    running: "Running agents",
    stRunning: "Running",
    noAgents: "No agents are running. Waiting for the next event",
    brief: "Instructions",
    viewBrief: "View instructions",
    startedAt: (time) => `Started ${time}`,
    worktree: (name) => `work folder ${name}`,
    activeReqs: "Requirements in progress",
    noReqs: "No requirements in progress",
    viewAll: "View all",
    questions: "Questions",
    decisions: "Recent dispatcher decisions",
    noDecisions: "No dispatcher decisions yet",
    viewHistory: "Activity history",
    fresh: "NEW",
    event: "Event",
    moreEvents: (n) => `+${String(n)} more`,
  },
  directive: {
    launch: (role, target) => `Launch ${role} (${target})`,
    ask: "Ask a human",
    notify: "Notify",
    merge: (target) => `Merge (${target})`,
    complete: "Complete requirement",
    wait: "Wait",
  },
  outcome: {
    run_agent: "Launched",
    ask_human: "Posted",
    notify: "Posted",
    merge_pr: "Merged",
    complete_requirement: "Completed",
    wait: "Waiting",
    skipped: "Skipped",
    failed: "Failed",
  },
  ago: {
    now: "just now",
    minutes: (n) => `${String(n)} min ago`,
    hours: (n) => (n === 1 ? "1 hour ago" : `${String(n)} hours ago`),
    days: (n) => (n === 1 ? "1 day ago" : `${String(n)} days ago`),
  },
  placeholder: "This screen is not ready yet.",
};

export const MESSAGES: Record<Lang, Messages> = { ja, en };

const STORAGE_KEY = "tasuki.lang";

/** 初めて開いたときの言語。ブラウザが日本語なら日本語、それ以外は英語 */
export function defaultLang(browserLanguage: string | undefined): Lang {
  return browserLanguage?.toLowerCase().startsWith("ja") ? "ja" : "en";
}

export function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ja" || saved === "en") return saved;
  } catch {
    // 覚えておけない環境では、ブラウザの言語に合わせる
  }
  return defaultLang(navigator.language);
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 覚えておけなくても、表示は切り替える
  }
}

/** 対象を、人が読む名前にする。要件は、本文の冒頭を名前として添える */
export function targetLabel(
  t: Messages,
  target: Target | null,
  requirementNames: ReadonlyMap<string, string> = new Map(),
): string {
  if (target === null) return "";
  switch (target.kind) {
    case "requirement": {
      const name = requirementNames.get(target.id);
      return name ? t.target.requirement(name) : t.target.requirementUnknown;
    }
    case "issue":
      return t.target.issue(target.number);
    case "pr":
      return t.target.pr(target.number);
    case "repo":
      return t.target.repo;
  }
}

/** 要件の本文から、短い名前を作る */
export function requirementName(content: string, max = 16): string {
  const line = content.split("\n")[0]?.trim() ?? "";
  return line.length <= max ? line : `${line.slice(0, max)}…`;
}
