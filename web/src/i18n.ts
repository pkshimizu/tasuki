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
  common: {
    all: "すべて",
    none: "なし",
    details: "詳しく見る",
    breadcrumb: "パンくず",
    collapse: "たたむ",
    showAll: (lines: number) => `すべて表示（${String(lines)} 行）`,
  },
  merge: { auto: "Tasuki がマージ", human: "人がマージ" },
  ci: {
    pass: "CI 合格",
    fail: "CI 失敗",
    pending: "CI 実行中",
    none: "CI なし",
  },
  prState: { open: "開いている", merged: "マージ済み", closed: "閉じた" },
  findingStatus: {
    open: "未対応",
    fixed: "直したと報告",
    declined: "直さないと報告",
    deferred: "持ち越すと報告",
    resolved: "解消済み",
  },
  runStatus: {
    running: "実行中",
    done: "終えた",
    question: "人への質問を返した",
    failed: "進められないと返した",
    error: "エラー",
    limit: "利用上限で終わった",
    interrupted: "中断",
  },
  eventTypes: {
    requirement_posted: "新しい要件",
    question_answered: "質問への返信",
    docs_changed: "仕様・デザインの変更",
    issue_changed: "Issue の変化",
    pr_changed: "PR の変化",
    ci_changed: "CI の結果",
    pr_comment: "PR へのコメント",
    agent_finished: "エージェントの終了",
    merge_refused: "マージの見送り",
    limit_recovered: "利用上限からの回復",
  },
  directiveTypes: {
    run_agent: "エージェントの起動",
    ask_human: "人への質問",
    notify: "お知らせ",
    merge_pr: "マージ",
    complete_requirement: "要件の完了",
    wait: "待つ",
  },
  day: {
    today: "今日",
    yesterday: "昨日",
    date: (month: number, day: number) => `${String(month)}/${String(day)}`,
  },
  timeline: {
    event: "出来事",
    decision: "司令塔の判断",
    run: "エージェントの実行",
    empty: "まだ何もありません",
  },
  prs: {
    openCount: (n: number) => `開いている PR ${String(n)} 件`,
    showClosed: "マージ済み・閉じたものも表示",
    noOpen: "開いている PR はありません",
    closedTitle: "マージ済み・閉じた PR",
    noClosed: "マージ済み・閉じた PR はまだありません",
    stage: "工程",
    conflict: "衝突",
    conflicting: "衝突あり",
    mergeSetting: "マージの設定",
    review: "レビュー",
    openFindings: "片付いていない指摘",
    updated: "更新",
    notReviewed: "まだ",
    rounds: (n: number) => `${String(n)} 回`,
    round: (n: number) => `${String(n)} 回目`,
    staleReview: "レビューのあとにコミットあり",
    staleNote:
      "「レビューのあとにコミットあり」の PR は、もう一度 approve されるまでマージされません。",
    cannotMerge: "まだマージできません",
    canMerge: "マージできます",
    canMergeNoReview:
      "レビューはまだです。レビューするかどうかは司令塔が判断します",
    waitingHuman: "あなたが GitHub でマージするのを待っています",
    waitingAuto: "司令塔がマージを指示すると、Tasuki がマージします",
    commit: "コミット",
    noFindings: "指摘なし",
    findingsCount: (n: number) => `指摘 ${String(n)}`,
    notReviewedYet: "まだレビューしていません",
    findings: "指摘",
    findingsSummary: (total: number, pending: number) =>
      `${String(total)} 件 · 片付いていない ${String(pending)}`,
    noFindingsYet: "指摘はありません",
    noMatch: "当てはまる指摘はありません",
    severity: "重要度",
    status: "状態",
    location: "場所",
    problem: "問題",
    suggestion: "直し方",
    statusNote: "状態の説明",
    timeline: "この PR の経過",
    notFound: "この PR は見つかりません",
  },
  blockers: {
    ciPending: "CI が実行中です",
    ciFail: (checks: string) => `CI が失敗しています（${checks}）`,
    ciNone: "CI の結果がまだありません",
    conflict: "既定のブランチと衝突しています",
    draft: "PR が下書きです",
    reviewChanges: "最後のレビューが request_changes です",
    reviewStale: (sha: string) =>
      `レビューしたコミット ${sha} のあとに、コミットが足されています`,
  },
  activity: {
    subtitle: "Tasuki が何を見て、どう判断し、何をしたか",
    tabDecisions: "司令塔の判断",
    tabRuns: "エージェントの実行",
    tabEvents: "出来事",
    filterDirective: "指示で絞り込み",
    at: "日時",
    sourceEvents: "もとになった出来事",
    directives: "出した指示",
    reasoning: "判断の理由",
    directiveResults: "指示ごとの中身と結果",
    agent: "エージェント",
    target: "対象",
    state: "状態",
    started: "開始",
    duration: "所要時間",
    summary: "要約",
    instruction: "指示書（司令塔が書いたもの）",
    resultSummary: "結果の要約",
    noSummary: "まだ結果はありません",
    type: "種類",
    content: "内容",
    handled: "司令塔に渡した",
    handledYes: "渡した",
    handledNo: "まだ",
    noDecisions: "司令塔の判断はまだありません",
    noRuns: "エージェントの実行はまだありません",
    noEvents: "出来事はまだありません",
  },
  questions: {
    subtitle:
      "エージェントと司令塔から人への質問。回答は Discord のスレッドで行います",
    none: "質問はまだありません",
    waiting: "返信待ち",
    answered: "返信あり",
    createdAt: (time: string) => `${time} に作成`,
    answer: "Discord で回答する",
    noLink:
      "Discord のスレッドの場所がまだ分かりません（次の確認のあとに出ます）",
    howTo:
      "スレッドに返信すると、次の確認で司令塔に渡ります。「1: A」のように番号と選択肢で答えられます",
  },
  knowledge: {
    context: "コンテキスト",
    architecture: "アーキテクチャ",
    spec_rules: "仕様作成ルール",
    implementation_rules: "実装ルール",
    review_perspectives: "レビュー観点",
    commit_rules: "コミットルール",
    task_rules: "タスク作成ルール",
    pr_rules: "プルリクルール",
    merge_rules: "マージルール",
  },
  product: {
    subtitle:
      "エージェントに渡している文書（見るだけ。直すときはリポジトリの PR で）",
    notLoaded:
      "まだ読み込んでいません（エージェントを起動するときに読み込みます）",
    loadedAt: (time: string) => `${time} に読み込み`,
    byRole: "エージェントで見る",
    allRoles: "すべてのエージェント",
    missing: "未作成",
    missingHelp: "次の場所に置くと渡ります:",
    chars: (n: number) => `${n.toLocaleString()} 文字`,
    roleDocs: (n: number) => `に渡る文書 ${String(n)} 件`,
  },
  system: {
    process: "プロセス",
    version: "バージョン",
    startedAt: "起動した日時",
    pid: "プロセスの番号",
    adminUrl: "管理画面",
    limit: "利用上限",
    limitNormal: "通常",
    limitHelp:
      "上限に達すると「待機中」になり、再開の時刻をここと画面ヘッダーに表示します",
    shell: "エージェントが使うシェル",
    paths: "置き場",
    pathRepo: "対象リポジトリ",
    pathState: "記録",
    pathWorktrees: "作業フォルダ",
    worktrees: "作業フォルダ",
    worktreesNote: (n: number) =>
      `${String(n)} つ · 対象が終わったものは自動で消えます`,
    noWorktrees: "作業フォルダはありません",
    wtName: "名前",
    wtBranch: "取り出しているブランチ",
    wtDirty: "コミットしていない変更",
    wtDirtyYes: "あり",
    wtSetup: "準備コマンド",
    wtSetupDone: "実行済み",
    wtSetupNotYet: "まだ",
    logs: "最近のログ",
    logsNote: "新しいものが下に足されます",
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
  common: {
    all: "All",
    none: "None",
    details: "Details",
    breadcrumb: "Breadcrumb",
    collapse: "Collapse",
    showAll: (lines) => `Show all (${String(lines)} lines)`,
  },
  merge: { auto: "Tasuki merges", human: "Human merges" },
  ci: {
    pass: "CI passed",
    fail: "CI failed",
    pending: "CI running",
    none: "No CI",
  },
  prState: { open: "Open", merged: "Merged", closed: "Closed" },
  findingStatus: {
    open: "Open",
    fixed: "Reported fixed",
    declined: "Declined",
    deferred: "Deferred",
    resolved: "Resolved",
  },
  runStatus: {
    running: "Running",
    done: "Done",
    question: "Asked a human",
    failed: "Could not proceed",
    error: "Error",
    limit: "Stopped by usage limit",
    interrupted: "Interrupted",
  },
  eventTypes: {
    requirement_posted: "New requirement",
    question_answered: "Reply to a question",
    docs_changed: "Spec or design changed",
    issue_changed: "Issue changed",
    pr_changed: "Pull request changed",
    ci_changed: "CI result",
    pr_comment: "Pull request comment",
    agent_finished: "Agent finished",
    merge_refused: "Merge skipped",
    limit_recovered: "Usage limit recovered",
  },
  directiveTypes: {
    run_agent: "Launch an agent",
    ask_human: "Ask a human",
    notify: "Notify",
    merge_pr: "Merge",
    complete_requirement: "Complete requirement",
    wait: "Wait",
  },
  day: {
    today: "Today",
    yesterday: "Yesterday",
    date: (month, day) => `${String(month)}/${String(day)}`,
  },
  timeline: {
    event: "Event",
    decision: "Dispatcher decision",
    run: "Agent run",
    empty: "Nothing yet",
  },
  prs: {
    openCount: (n) => `${String(n)} open`,
    showClosed: "Also show merged and closed",
    noOpen: "No open pull requests",
    closedTitle: "Merged and closed pull requests",
    noClosed: "No merged or closed pull requests yet",
    stage: "Stage",
    conflict: "Conflict",
    conflicting: "Conflicting",
    mergeSetting: "Merge setting",
    review: "Review",
    openFindings: "Open findings",
    updated: "Updated",
    notReviewed: "Not yet",
    rounds: (n) => (n === 1 ? "1 round" : `${String(n)} rounds`),
    round: (n) => `Round ${String(n)}`,
    staleReview: "Commits after review",
    staleNote:
      "A pull request with commits after review is not merged until it is approved again.",
    cannotMerge: "Cannot merge yet",
    canMerge: "Ready to merge",
    canMergeNoReview:
      "Not reviewed yet. The dispatcher decides whether to review",
    waitingHuman: "Waiting for you to merge on GitHub",
    waitingAuto: "Tasuki merges when the dispatcher asks for it",
    commit: "Commit",
    noFindings: "No findings",
    findingsCount: (n) => (n === 1 ? "1 finding" : `${String(n)} findings`),
    notReviewedYet: "Not reviewed yet",
    findings: "Findings",
    findingsSummary: (total, pending) =>
      `${String(total)} total · ${String(pending)} open`,
    noFindingsYet: "No findings",
    noMatch: "No findings match",
    severity: "Severity",
    status: "Status",
    location: "Location",
    problem: "Problem",
    suggestion: "Suggestion",
    statusNote: "Status note",
    timeline: "History of this pull request",
    notFound: "This pull request was not found",
  },
  blockers: {
    ciPending: "CI is running",
    ciFail: (checks) => `CI failed (${checks})`,
    ciNone: "No CI result yet",
    conflict: "Conflicts with the default branch",
    draft: "The pull request is a draft",
    reviewChanges: "The last review requested changes",
    reviewStale: (sha) => `Commits were added after the reviewed commit ${sha}`,
  },
  activity: {
    subtitle: "What Tasuki saw, how it decided, and what it did",
    tabDecisions: "Dispatcher decisions",
    tabRuns: "Agent runs",
    tabEvents: "Events",
    filterDirective: "Filter by directive",
    at: "Time",
    sourceEvents: "Source events",
    directives: "Directives",
    reasoning: "Reasoning",
    directiveResults: "Directives and results",
    agent: "Agent",
    target: "Target",
    state: "Status",
    started: "Started",
    duration: "Duration",
    summary: "Summary",
    instruction: "Instructions (written by the dispatcher)",
    resultSummary: "Result summary",
    noSummary: "No result yet",
    type: "Type",
    content: "Content",
    handled: "Passed to dispatcher",
    handledYes: "Passed",
    handledNo: "Not yet",
    noDecisions: "No dispatcher decisions yet",
    noRuns: "No agent runs yet",
    noEvents: "No events yet",
  },
  questions: {
    subtitle:
      "Questions from agents and the dispatcher. Answer in the Discord thread",
    none: "No questions yet",
    waiting: "Awaiting reply",
    answered: "Replied",
    createdAt: (time) => `created ${time}`,
    answer: "Answer on Discord",
    noLink:
      "The Discord thread link is not known yet (it appears after the next check)",
    howTo:
      "Reply in the thread and it reaches the dispatcher at the next check. You can answer like “1: A”",
  },
  knowledge: {
    context: "Context",
    architecture: "Architecture",
    spec_rules: "Spec rules",
    implementation_rules: "Implementation rules",
    review_perspectives: "Review perspectives",
    commit_rules: "Commit rules",
    task_rules: "Task rules",
    pr_rules: "Pull request rules",
    merge_rules: "Merge rules",
  },
  product: {
    subtitle:
      "Documents given to agents (read only. Change them with a pull request)",
    notLoaded: "Not loaded yet (loaded when an agent is launched)",
    loadedAt: (time) => `loaded ${time}`,
    byRole: "View by agent",
    allRoles: "All agents",
    missing: "Missing",
    missingHelp: "Put a file here to provide it:",
    chars: (n) => `${n.toLocaleString()} chars`,
    roleDocs: (n) => `receives ${String(n)} documents`,
  },
  system: {
    process: "Process",
    version: "Version",
    startedAt: "Started",
    pid: "Process ID",
    adminUrl: "Admin UI",
    limit: "Usage limit",
    limitNormal: "Normal",
    limitHelp:
      "When the limit is reached, the status becomes paused and the resume time is shown here and in the header",
    shell: "Shell used by agents",
    paths: "Locations",
    pathRepo: "Target repository",
    pathState: "State file",
    pathWorktrees: "Work folders",
    worktrees: "Work folders",
    worktreesNote: (n) =>
      `${String(n)} · removed automatically when the target is finished`,
    noWorktrees: "No work folders",
    wtName: "Name",
    wtBranch: "Checked-out branch",
    wtDirty: "Uncommitted changes",
    wtDirtyYes: "Yes",
    wtSetup: "Setup commands",
    wtSetupDone: "Done",
    wtSetupNotYet: "Not yet",
    logs: "Recent log",
    logsNote: "New lines are added at the bottom",
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
