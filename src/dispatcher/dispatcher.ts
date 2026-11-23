/**
 * 司令塔。新しい出来事と今の状況を受け取り、次に誰へ何を指示するかを決める。
 * 段階の順番や回数の上限はプログラムで決めず、ここ（LLM）の判断に任せる。
 */
import { z } from "zod";
import type { AgentOutcome, RunAgent } from "../agents/agent.js";
import {
  type Config,
  type LoadedConfig,
  ROLE_LABELS,
  type Stage,
} from "../config/config.js";
import type { Issue, PullRequest } from "../integrations/github.js";
import { languageRule } from "../agents/roles.js";
import {
  type EventPayload,
  type RunStatus,
  type Target,
  targetKey,
  targetLabel,
  targetSchema,
  type TasukiEvent,
  type WorkerRole,
  workerRoleSchema,
} from "../domain/types.js";

export const actionSchema = z.union([
  z.strictObject({
    type: z.literal("run_agent"),
    role: workerRoleSchema,
    target: targetSchema,
    instruction: z
      .string()
      .describe(
        "指示書。新しく起動されるエージェントが、これだけで作業を始められるように書く",
      ),
  }),
  z.strictObject({
    type: z.literal("ask_human"),
    title: z.string().describe("質問スレッドの題名（短く）"),
    question: z.string().describe("質問の本文。番号・選択肢・おすすめを添える"),
    target: targetSchema.nullable().describe("質問の対象。無ければ null"),
  }),
  z.strictObject({
    type: z.literal("notify"),
    message: z.string().describe("お知らせチャンネルに書く文"),
  }),
  z.strictObject({
    type: z.literal("merge_pr"),
    number: z.number().int().describe("マージする PR の番号"),
  }),
  z.strictObject({
    type: z.literal("complete_requirement"),
    requirementId: z.string(),
    message: z.string().describe("お知らせチャンネルに書く完了の知らせ"),
  }),
  z.strictObject({
    type: z.literal("wait"),
    reason: z.string().describe("今は何もしない理由"),
  }),
]);
export type Action = z.infer<typeof actionSchema>;

export const decisionSchema = z.strictObject({
  reasoning: z.string().describe("状況の見立てと、指示を決めた理由"),
  actions: z.array(actionSchema).describe("指示の一覧。実行する順に並べる"),
});
export type DispatchDecision = z.infer<typeof decisionSchema>;

export interface SituationPullRequest extends PullRequest {
  stage: Stage;
  /** この工程のマージの設定 */
  merge: "auto" | "human";
}

/** 今の状況。毎回 GitHub・Discord・記録から読み直す */
export interface Situation {
  requirements: { id: string; author: string; content: string }[];
  /** 質問スレッド。answered は人の返信を 1 度でも読んだか */
  questions: {
    threadId: string;
    title: string;
    target: Target | null;
    answered: boolean;
  }[];
  issues: Issue[];
  pullRequests: SituationPullRequest[];
  running: { role: WorkerRole; target: Target; startedAt: string }[];
  recentRuns: {
    role: WorkerRole;
    target: Target;
    status: RunStatus;
    summary: string;
    finishedAt: string;
  }[];
  recentDecisions: {
    at: string;
    events: string[];
    reasoning: string;
    actions: unknown[];
  }[];
  /** 利用上限で起動を止めているときの回復時刻 */
  limitUntil: string | null;
}

const BODY_LIMIT = 1500;

function clip(text: string, limit = BODY_LIMIT): string {
  const t = text.trim();
  return t.length <= limit ? t : `${t.slice(0, limit)}…（以下略）`;
}

const STAGE_LABELS: Record<Stage, string> = {
  spec: "仕様",
  design: "デザイン",
  implementation: "実装",
};

const STATUS_LABELS: Record<RunStatus, string> = {
  done: "終えた",
  question: "人への質問を返した",
  failed: "進められないと返した",
  error: "実行そのものが失敗した",
  limit: "利用上限で終わった",
  interrupted: "Tasuki が止まったため途中で終わった",
};

/** 出来事を 1〜数行の文にする（司令塔への入力と、判断の記録に使う） */
export function describeEvent(p: EventPayload): string {
  switch (p.type) {
    case "requirement_posted":
      return `新しい要件（ID ${p.requirementId}、${p.author}）:\n${clip(p.content)}`;
    case "question_answered":
      return `質問「${p.title}」（${targetLabel(p.target)}、スレッド ${p.threadId}）に返信があった:\n${p.replies
        .map((r) => `- ${r.author}: ${clip(r.content)}`)
        .join("\n")}`;
    case "docs_changed":
      return `${STAGE_LABELS[p.stage]}が既定のブランチで変わった（コミット ${p.commit.slice(0, 7)}）: ${p.files.join("、")}`;
    case "issue_changed":
      return `Issue #${String(p.number)}「${p.title}」が${
        {
          opened: "作成された",
          updated: "更新された",
          closed: "閉じられた",
          reopened: "開き直された",
        }[p.change]
      }`;
    case "pr_changed":
      return `PR #${String(p.number)}「${p.title}」（${STAGE_LABELS[p.stage]}、ブランチ ${p.branch}）が${
        {
          opened: "作成された",
          updated: "更新された",
          merged: "マージされた",
          closed: "マージされずに閉じられた",
        }[p.change]
      }`;
    case "ci_changed":
      return `PR #${String(p.number)} の CI が${p.status === "pass" ? "合格した" : "失敗した"}`;
    case "pr_comment":
      return `PR #${String(p.number)} に ${p.author} のコメント${
        p.path ? `（${p.path}）` : ""
      }:\n${clip(p.body)}`;
    case "agent_finished": {
      const lines = [
        `${ROLE_LABELS[p.role]}（${targetLabel(p.target)}、実行 ${String(p.runId)}）が${STATUS_LABELS[p.status]}${
          p.pr !== null ? `（PR #${String(p.pr)}）` : ""
        }:`,
        clip(p.summary),
      ];
      if (p.questions.length > 0) {
        lines.push(
          "質問（質問チャンネルに投稿済み。返信を待つ）:",
          ...p.questions.map((q) => `- ${clip(q, 300)}`),
        );
      }
      return lines.join("\n");
    }
    case "merge_refused":
      return `PR #${String(p.number)} のマージを Tasuki が見送った: ${p.reason}`;
    case "limit_recovered":
      return "利用上限から回復した。エージェントを起動できる";
  }
}

function section(title: string, lines: string[]): string {
  return `## ${title}\n\n${lines.length > 0 ? lines.join("\n") : "（なし）"}`;
}

/** 司令塔に渡す依頼文を組み立てる */
export function buildDispatchPrompt(
  events: TasukiEvent[],
  s: Situation,
  config: Config,
): string {
  const parts = [
    "新しい出来事と今の状況です。次に行う指示を決めてください。",
    section(
      "新しい出来事",
      events.map((e, i) => `${String(i + 1)}. ${describeEvent(e.payload)}`),
    ),
    section(
      "進行中の要件",
      s.requirements.map(
        (r) => `- ID ${r.id}（${r.author}）: ${clip(r.content, 500)}`,
      ),
    ),
    section(
      "質問スレッド",
      s.questions.map(
        (q) =>
          `- 「${q.title}」（${targetLabel(q.target)}、スレッド ${q.threadId}）: ${q.answered ? "返信あり" : "返信待ち"}`,
      ),
    ),
    section(
      "開いている Issue",
      s.issues.map(
        (i) =>
          `### #${String(i.number)} ${i.title}${
            i.labels.length > 0 ? `（${i.labels.join("、")}）` : ""
          }\n${clip(i.body)}`,
      ),
    ),
    section(
      "開いている PR",
      s.pullRequests.map(
        (p) =>
          `- #${String(p.number)}「${p.title}」: ${STAGE_LABELS[p.stage]}、ブランチ ${p.branch}、作成者 ${p.author}、CI ${
            {
              pass: "合格",
              fail: `失敗（${p.failedChecks.join("、")}）`,
              pending: "実行中",
              none: "なし",
            }[p.ci]
          }、${
            {
              mergeable: "衝突なし",
              conflicting: `${p.base} と衝突`,
              unknown: "衝突は未判定",
            }[p.mergeable]
          }${p.draft ? "、下書き" : ""}、マージの設定 ${p.merge === "auto" ? "auto（Tasuki がマージ）" : "human（人がマージ）"}`,
      ),
    ),
    section(
      "動いているエージェント",
      s.running.map(
        (r) =>
          `- ${ROLE_LABELS[r.role]}（${targetLabel(r.target)}、${r.startedAt} から）`,
      ),
    ),
    section(
      "最近終わった実行（古い順）",
      s.recentRuns.map(
        (r) =>
          `- ${r.finishedAt} ${ROLE_LABELS[r.role]}（${targetLabel(r.target)}）${STATUS_LABELS[r.status]}: ${clip(r.summary, 400)}`,
      ),
    ),
    section(
      "最近の自分の判断（古い順）",
      s.recentDecisions.map(
        (d) =>
          `- ${d.at} 出来事: ${d.events.map((e) => clip(e, 80).replaceAll("\n", " ")).join(" / ")}\n  理由: ${clip(d.reasoning, 400)}\n  指示: ${clip(JSON.stringify(d.actions), 600)}`,
      ),
    ),
    section("設定", [
      `- 同時に動かせる作業エージェント: ${String(config.limits.agents)}（今 ${String(s.running.length)} 動いている）`,
      `- マージ: 仕様 ${config.merge.spec}、デザイン ${config.merge.design}、実装 ${config.merge.implementation}`,
      `- 置き場: 仕様 ${config.paths.specs}/、デザイン ${config.paths.design}/、デザインシステム ${config.paths.design_system}/`,
      ...(s.limitUntil
        ? [
            `- 利用上限のため、${s.limitUntil} まで新しいエージェントは起動されない`,
          ]
        : []),
    ]),
  ];
  return parts.join("\n\n");
}

export function dispatcherPrompt(loaded: LoadedConfig): string {
  const { config } = loaded;
  return [
    `あなたは、ソフトウェア開発を複数のエージェントで進める仕組み「Tasuki」の司令塔です。
対象のリポジトリは ${config.github.repo} です。

監視スレッド（プログラム）が、Discord と GitHub から新しい出来事を集めてあなたに渡します。あなたは状況を見て、どのエージェントに何を指示するかを決めます。監視スレッドはあなたの指示をそのまま実行します。開発を前に進められるかどうかは、あなたの判断にかかっています。

## エージェント

- 仕様マスター（spec-master）: 要件を確かめ、不明点を質問し、仕様を ${config.paths.specs}/ に書いて PR を作る。対象は要件（その PR の修正なら PR）
- プランナー（planner）: 仕様・デザインと今の Issue を見比べ、Issue を作成・更新する。対象はリポジトリ全体
- UIデザイナー（designer）: 仕様に UI が要るとき、デザインシステムに沿って HTML モックを ${config.paths.design}/ に作り、PR を作る。対象は Issue（その PR の修正なら PR）
- プログラマー（programmer）: Issue に従って実装とテストコードを書き、PR を作る。レビューの指摘・CI の失敗・衝突を直す。対象は Issue（その PR の修正なら PR）
- レビュアー（reviewer）: PR を確かめ、指摘を PR にコメントし、判定（approve／request_changes）を返す。対象は PR

エージェントは毎回新しく起動され、前の経緯を覚えていません。

## 標準の流れ

1. 新しい要件 → 仕様マスターに仕様の作成を指示する
2. 仕様マスターが質問を返す → 監視スレッドが質問チャンネルに投稿する → 人の返信が出来事として届く → 回答を添えて仕様マスターに改めて指示する。仕様が要件を満たすまで繰り返す
3. 仕様の PR → 必要ならレビュー → マージ
4. 仕様・デザインが既定のブランチで変わった → プランナーに Issue の作成・更新を指示する
5. 進められる Issue がある → デザインが要れば UIデザイナーに、実装はプログラマーに指示する
6. PR が作成・更新された → 必要ならレビュアーに指示する
7. レビューの指摘・人のコメント・CI の失敗 → 直す必要があれば、その PR を作った役に修正を指示する
8. マージしてよい PR → merge_pr を出す
9. 要件の作業がすべて終わった → complete_requirement を出す

これは標準であって決まりではありません。状況に合わせて順番を変え、省き、やり直してかまいません。

## 判断の指針

- 出来事の 1 つ 1 つについて、何かする必要があるかを考えます。何もしなくてよければ wait を返します（自分の指示の結果として起きた出来事には、たいてい追加の指示は要りません）。
- 指示書（instruction）には、目的、対象（Issue・PR の番号、要件の本文、質問と回答）、これまでの経緯、期待する成果を書きます。エージェントはそれと、リポジトリ・GitHub に残っていることしか知りません。
- 同じ対象のエージェントが動いている間は、その対象に新しい指示を出しません。終われば出来事として届くので、そのとき判断します。
- 同時に動かせる数を超える指示は出さず、大事なものから出します。残りは次の出来事のときに出します。
- 実行できなかった指示（同時に動かせる数を超えた、同じ対象が動いている、利用上限など）は、最近の判断に「見送り」と理由が残ります。自動ではやり直されないので、必要なら改めて出します。
- Issue の「先に済ませる Issue」を読み、先の Issue が閉じてから着手します。
- うまくいかないときは、同じ指示を繰り返しません。結果の要約と最近の判断を読み、原因に合わせて指示の中身を変える、別の役に頼む、Issue を分ける・直すようプランナーに頼む、のどれかを選びます。それでも進まないとき、または人にしか決められないときに ask_human を出します。
- 人への質問は、答えやすいように番号・選択肢・おすすめを添えます。エージェントが返した質問は監視スレッドが投稿済みなので、同じ質問を ask_human で重ねません。
- PR への人のコメントは、指摘か指示として扱います。
- 必要なら、リポジトリのファイルや GitHub（gh pr view・gh pr diff・gh issue view など読むだけのコマンド）を自分で確かめてから決めます。

## マージ

- merge_pr を出すのは、内容に問題がないと判断できたときです（ふつうはレビュアーが approve を返し、直すべき指摘が残っていないとき）。
- 監視スレッドは、マージの設定が auto で、CI がすべて合格しているときだけマージします。それ以外は見送り、理由が出来事として届きます。
- マージの設定が human の PR には merge_pr を出しません。人が GitHub でマージするのを待ちます。
- CI が実行中なら待ちます。結果は出来事として届きます。
- PR の作成とマージは、監視スレッドがお知らせチャンネルに自動で書きます。同じ内容を notify で重ねません。

## 結果

reasoning に状況の見立てと理由を書き、actions に指示を実行する順に並べます。何もしないときは wait を 1 つだけ返します。`,
    loaded.instructions.dispatcher &&
      `## このリポジトリでの追加の指示\n\n${loaded.instructions.dispatcher}`,
    languageRule(config.language),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface DispatchInput {
  loaded: LoadedConfig;
  defaultBranch: string;
  events: TasukiEvent[];
  situation: Situation;
  signal?: AbortSignal | undefined;
}

/** 司令塔に判断を頼む */
export function dispatch(
  runAgent: RunAgent,
  input: DispatchInput,
): Promise<AgentOutcome<DispatchDecision>> {
  const { loaded } = input;
  return runAgent({
    name: "dispatcher",
    systemPrompt: dispatcherPrompt(loaded),
    prompt: buildDispatchPrompt(input.events, input.situation, loaded.config),
    schema: decisionSchema,
    guard: {
      cwd: loaded.dir,
      defaultBranch: input.defaultBranch,
      access: "inspect",
    },
    model: loaded.config.agents.dispatcher?.model,
    signal: input.signal,
  });
}

/** 指示を 1 行の文にする（ログ用） */
export function describeAction(a: Action): string {
  switch (a.type) {
    case "run_agent":
      return `${ROLE_LABELS[a.role]}を起動（${targetKey(a.target)}）`;
    case "ask_human":
      return `人に質問「${a.title}」`;
    case "notify":
      return "お知らせ";
    case "merge_pr":
      return `PR #${String(a.number)} をマージ`;
    case "complete_requirement":
      return `要件 ${a.requirementId} を完了`;
    case "wait":
      return `待つ（${a.reason}）`;
  }
}
