/**
 * 監視スレッドの「実行する」部分。司令塔が決めた指示を実行する。
 * - エージェントは裏で動かし、終わったら出来事として記録する
 * - マージは、設定が auto で CI が合格しているときだけ行う（プログラムで必ず守る）
 * - 実行できなかった指示は理由を返す（自動ではやり直さない。やり直すかは司令塔が決める）
 */
import type { RunAgent } from "../agents/agent.js";
import { type LoadedConfig, ROLE_LABELS } from "../config/config.js";
import type { Action } from "../dispatcher/dispatcher.js";
import type { KnowledgeProvider } from "../knowledge/knowledge.js";
import type { Chat } from "../integrations/discord.js";
import {
  type GitHub,
  type PullRequest,
  stageOf,
} from "../integrations/github.js";
import {
  ROLE_ACCESS,
  rolePrompt,
  type WorkerOutput,
  workerOutputSchema,
} from "../agents/roles.js";
import {
  describeNewFindings,
  fixContext,
  mergeReviewProblem,
  reviewContext,
} from "../domain/review.js";
import { type Clock, type Store, systemClock } from "../store/store.js";
import {
  type RunStatus,
  type Target,
  targetKey,
  targetLabel,
  type WorkerRole,
} from "../domain/types.js";
import {
  describeWorkspace,
  parseEntryName,
  type Workspace,
} from "../agents/workspace.js";

export interface ExecutorDeps {
  loaded: LoadedConfig;
  defaultBranch: string;
  store: Store;
  chat: Chat;
  github: GitHub;
  runAgent: RunAgent;
  workspace: Workspace;
  knowledge: KnowledgeProvider;
  log: (text: string) => void;
  clock?: Clock;
  /** エージェントが終わったときに呼ぶ（次の確認を早めるため） */
  onFinish?: () => void;
}

/** 利用上限の回復時刻が分からないときに待つ時間 */
export const DEFAULT_LIMIT_WAIT_MS = 15 * 60 * 1000;
/** 回復の直後は混み合うので少し余裕を持たせる */
const LIMIT_MARGIN_MS = 60 * 1000;

interface Running {
  runId: number;
  role: WorkerRole;
  target: Target;
  key: string;
  /** 作業フォルダ。用意できるまでは undefined */
  cwd: string | undefined;
  done: Promise<void>;
}

export class Executor {
  private readonly running = new Map<number, Running>();
  private limitUntil: Date | null = null;
  private readonly abort = new AbortController();
  /** 変更が残っていて消さなかった作業フォルダ（同じ知らせを繰り返さないため） */
  private readonly keptDirty = new Set<string>();
  private readonly clock: Clock;

  constructor(private readonly deps: ExecutorDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  get runningCount(): number {
    return this.running.size;
  }

  /** 利用上限で起動を止めているときの回復時刻 */
  get limit(): Date | null {
    return this.limitUntil;
  }

  /** 利用上限に達した。回復時刻まで新しいエージェントを起動しない */
  setLimit(resetsAt: Date | undefined): void {
    const until = new Date(
      (resetsAt?.getTime() ??
        this.clock.now().getTime() + DEFAULT_LIMIT_WAIT_MS) + LIMIT_MARGIN_MS,
    );
    if (this.limitUntil === null || until > this.limitUntil) {
      this.limitUntil = until;
      this.deps.log(
        `利用上限に達しました。${until.toISOString()} まで新しいエージェントを起動しません`,
      );
    }
  }

  /** 回復時刻を過ぎていたら、出来事にして起動を再開する */
  checkLimit(): void {
    if (this.limitUntil === null || this.clock.now() < this.limitUntil) return;
    this.deps.store.addEvent(`limit:${this.limitUntil.toISOString()}`, {
      type: "limit_recovered",
    });
    this.limitUntil = null;
    this.deps.log("利用上限から回復しました");
  }

  /** 前回 Tasuki が止まったときに動いていた実行を、途中で終わったものとして司令塔に伝える */
  recoverInterrupted(): void {
    const { store } = this.deps;
    for (const run of store.runningRuns()) {
      const summary =
        "Tasuki が止まったため、途中で終わりました。作業フォルダに途中の変更が残っているかもしれません";
      store.finishRun(run.id, "interrupted", summary);
      store.addEvent(`run:${String(run.id)}`, {
        type: "agent_finished",
        runId: run.id,
        role: run.role,
        target: run.target,
        status: "interrupted",
        summary,
        questions: [],
        pr: null,
      });
    }
  }

  /** 指示を順に実行し、それぞれの結果（実行した／見送った理由）を返す */
  async execute(actions: Action[]): Promise<string[]> {
    const results: string[] = [];
    for (const action of actions) {
      try {
        results.push(await this.executeOne(action));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.deps.log(`指示の実行に失敗しました（${action.type}）: ${message}`);
        results.push(`失敗: ${message}`);
      }
    }
    return results;
  }

  private async executeOne(action: Action): Promise<string> {
    const { store, chat } = this.deps;
    switch (action.type) {
      case "run_agent":
        return this.start(action.role, action.target, action.instruction);
      case "ask_human": {
        const threadId = await chat.createQuestionThread(
          action.title,
          action.question,
        );
        store.addQuestion({
          threadId,
          title: action.title,
          body: action.question,
          target: action.target,
        });
        return "質問チャンネルに投稿した";
      }
      case "notify":
        await chat.notify(action.message);
        return "お知らせチャンネルに書いた";
      case "merge_pr":
        return this.merge(action.number);
      case "complete_requirement": {
        if (!store.completeRequirement(action.requirementId)) {
          return `見送り: 要件 ${action.requirementId} がありません`;
        }
        await chat.notify(action.message);
        return "要件を完了にして、お知らせチャンネルに書いた";
      }
      case "wait":
        return "何もしない";
    }
  }

  /** マージの門番。設定が auto で、CI が合格しているときだけマージする */
  private async merge(number: number): Promise<string> {
    const { github, store, loaded } = this.deps;
    const { config } = loaded;
    const pr = await github.pullRequest(number);
    const stage = stageOf(pr.files, config.paths);
    const refuse = (reason: string) => {
      store.addEvent(
        `merge-refused:${String(number)}:${pr.headSha}:${this.clock.now().toISOString()}`,
        { type: "merge_refused", number, reason },
      );
      return `見送り: ${reason}`;
    };
    if (config.merge[stage] === "human") {
      return refuse(
        "この工程のマージの設定は human です。人が GitHub でマージするのを待ちます",
      );
    }
    // レビューした PR は、approve されたコミットが今の先頭と同じときだけマージする
    const reviewProblem = mergeReviewProblem(pr.headSha, store.reviews(number));
    if (reviewProblem) return refuse(reviewProblem);
    const result = await github.mergePullRequest(
      number,
      config.merge.require_ci,
    );
    if (!result.merged) return refuse(result.reason);
    this.deps.log(`PR #${String(number)} をマージしました`);
    return "マージした";
  }

  /** エージェントを裏で起動する。起動できなければ理由を返す */
  private start(role: WorkerRole, target: Target, instruction: string): string {
    const { store, loaded } = this.deps;
    this.checkLimit();
    if (this.abort.signal.aborted) return "見送り: Tasuki を止めています";
    if (this.limitUntil !== null) {
      return `見送り: 利用上限のため ${this.limitUntil.toISOString()} まで起動できません`;
    }
    const key = targetKey(target);
    const busy = [...this.running.values()].find((r) => r.key === key);
    if (busy) {
      return `見送り: 同じ対象で${ROLE_LABELS[busy.role]}が動いています`;
    }
    if (this.running.size >= loaded.config.limits.agents) {
      return `見送り: 同時に動かせる数（${String(loaded.config.limits.agents)}）に達しています`;
    }
    const runId = store.startRun({ role, target, instruction });
    const entry: Running = {
      runId,
      role,
      target,
      key,
      cwd: undefined,
      done: Promise.resolve(),
    };
    this.running.set(runId, entry);
    entry.done = this.work(entry, instruction).finally(() => {
      this.running.delete(runId);
      this.deps.onFinish?.();
    });
    this.deps.log(
      `${ROLE_LABELS[role]}を起動しました（${targetLabel(target)}、実行 ${String(runId)}）`,
    );
    return `起動した（実行 ${String(runId)}）`;
  }

  private async work(entry: Running, instruction: string): Promise<void> {
    const { store, loaded, github, workspace, runAgent, defaultBranch } =
      this.deps;
    const { role, target, runId } = entry;
    const finish = (
      status: RunStatus,
      summary: string,
      questions: string[] = [],
      pr: number | null = null,
    ) => {
      store.finishRun(runId, status, summary);
      store.addEvent(`run:${String(runId)}`, {
        type: "agent_finished",
        runId,
        role,
        target,
        status,
        summary,
        questions,
        pr,
      });
      this.deps.log(
        `${ROLE_LABELS[role]}が終わりました（${targetLabel(target)}、実行 ${String(runId)}、${status}）`,
      );
    };

    try {
      const access = ROLE_ACCESS[role];
      const pr =
        target.kind === "pr"
          ? await github.pullRequest(target.number)
          : undefined;
      const prBranch = pr?.branch;
      const prepared = await workspace.prepare(target, access, prBranch);
      // 同じ作業フォルダで別の役が書いている間は、書く役を重ねない
      const sharing = [...this.running.values()].find(
        (r) => r.runId !== runId && r.cwd === prepared.cwd,
      );
      if (sharing && access === "write") {
        finish(
          "error",
          `同じ作業フォルダで${ROLE_LABELS[sharing.role]}（${targetLabel(sharing.target)}）が動いているため、起動しませんでした。終わってから改めて指示してください`,
        );
        return;
      }
      entry.cwd = prepared.cwd;

      const outcome = await runAgent({
        name: role,
        systemPrompt: rolePrompt(
          role,
          loaded.config,
          await this.deps.knowledge.load(),
        ),
        prompt: `${instruction}${this.reviewNotes(role, pr)}\n\n---\n対象: ${targetLabel(target)}\n${describeWorkspace(prepared, defaultBranch)}`,
        schema: workerOutputSchema,
        guard: { cwd: prepared.cwd, defaultBranch, access },
        model: loaded.config.agents[role]?.model,
        signal: this.abort.signal,
      });

      if (outcome.kind === "limit") {
        this.setLimit(outcome.resetsAt);
        finish(
          "limit",
          "利用上限で終わりました。作業フォルダに途中の変更が残っているかもしれません",
        );
        return;
      }
      if (outcome.kind === "error") {
        finish("error", outcome.message);
        return;
      }
      const output = outcome.output;
      const questions = output.status === "question" ? output.questions : [];
      if (questions.length > 0)
        await this.postQuestions(entry, output.summary, questions);
      finish(
        output.status,
        this.recordReview(runId, role, pr, output),
        questions,
        output.pr,
      );
    } catch (e) {
      finish("error", e instanceof Error ? e.message : String(e));
    }
  }

  /** PR が対象のとき、指示書に添えるレビューの経緯（レビュアー）か、指摘の一覧（直す役） */
  private reviewNotes(role: WorkerRole, pr: PullRequest | undefined): string {
    if (!pr) return "";
    const { store } = this.deps;
    const findings = store.findings(pr.number);
    const notes =
      role === "reviewer"
        ? reviewContext(pr.headSha, store.reviews(pr.number), findings)
        : fixContext(findings);
    return notes ? `\n\n${notes}` : "";
  }

  /** レビューの結果と、指摘への対応を記録し、司令塔に渡す要約を返す */
  private recordReview(
    runId: number,
    role: WorkerRole,
    pr: PullRequest | undefined,
    output: WorkerOutput,
  ): string {
    const { store } = this.deps;
    const lines: string[] = [];
    if (pr && role === "reviewer" && output.verdict !== null) {
      const { firstNumber } = store.addReview({
        pr: pr.number,
        sha: pr.headSha,
        verdict: output.verdict,
        runId,
        findings: output.findings,
        resolutions: output.resolutions,
      });
      lines.push(
        `判定: ${output.verdict === "approve" ? "approve（マージしてよい）" : "request_changes（直す必要がある）"}`,
        describeNewFindings(output.findings, firstNumber),
      );
      if (output.resolutions.length > 0) {
        const count = (s: string) =>
          output.resolutions.filter((r) => r.status === s).length;
        lines.push(
          `これまでの指摘の判定: 解消 ${String(count("resolved"))}・未解消 ${String(count("unresolved"))}・悪化 ${String(count("worsened"))}`,
        );
      }
    } else if (output.verdict !== null) {
      lines.push(`判定: ${output.verdict}`);
    } else if (pr && output.responses.length > 0) {
      store.applyResponses(pr.number, output.responses);
      const count = (a: string) =>
        output.responses.filter((r) => r.action === a).length;
      lines.push(
        `指摘への対応: 直した ${String(count("fixed"))}・直さない ${String(count("declined"))}・持ち越す ${String(count("deferred"))}`,
      );
    }
    lines.push(output.summary);
    if (output.rule_proposals.length > 0) {
      lines.push(
        "",
        "ルールの文書に足す提案:",
        ...output.rule_proposals.map((p) => `- ${p}`),
      );
    }
    return lines.join("\n");
  }

  /** エージェントが返した質問を、質問チャンネルのスレッドに書く */
  private async postQuestions(
    entry: Running,
    summary: string,
    questions: string[],
  ): Promise<void> {
    const { chat, store } = this.deps;
    const title = `${ROLE_LABELS[entry.role]}からの質問（${targetLabel(entry.target)}）`;
    const body = `${questions.join("\n\n")}\n\n---\n${summary}`;
    try {
      const threadId = await chat.createQuestionThread(title, body);
      store.addQuestion({ threadId, title, body, target: entry.target });
    } catch (e) {
      // 投稿できなくても質問は出来事に残るので、司令塔が ask_human で出し直せる
      this.deps.log(
        `質問の投稿に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * 対象が終わった作業フォルダ（閉じた Issue・開いていない PR・完了した要件）を消す。
   * エージェントが動いているフォルダ、開いている PR のブランチを取り出しているフォルダ、
   * コミットしていない変更が残っているフォルダは消さない。
   */
  async cleanup(github: {
    issues: { number: number }[];
    pullRequests: { number: number; branch: string }[];
  }): Promise<void> {
    const { workspace, store, log } = this.deps;
    const openIssues = new Set(github.issues.map((i) => i.number));
    const openPrs = new Set(github.pullRequests.map((p) => p.number));
    const openBranches = new Set(github.pullRequests.map((p) => p.branch));
    const openRequirements = new Set(
      store.requirements("open").map((r) => r.id),
    );
    const busy = new Set(
      [...this.running.values()].map((r) => r.cwd).filter(Boolean),
    );
    // これから作業フォルダを用意する実行があるときは、取り違えないよう見送る
    if ([...this.running.values()].some((r) => r.cwd === undefined)) return;

    for (const entry of await workspace.entries()) {
      const parsed = parseEntryName(entry.name);
      if (!parsed || busy.has(entry.cwd)) continue;
      const { target, read } = parsed;
      const finished =
        (target.kind === "issue" && !openIssues.has(target.number)) ||
        (target.kind === "pr" && !openPrs.has(target.number)) ||
        (target.kind === "requirement" && !openRequirements.has(target.id));
      if (!finished) continue;
      if (entry.branch !== null && openBranches.has(entry.branch)) continue;
      // 読むだけの役のフォルダには、残すべき変更は無い
      if (entry.dirty && !read) {
        if (!this.keptDirty.has(entry.name)) {
          this.keptDirty.add(entry.name);
          log(
            `作業フォルダ ${entry.cwd} は対象が終わっていますが、コミットしていない変更があるので残します`,
          );
        }
        continue;
      }
      try {
        await workspace.remove(entry);
        this.keptDirty.delete(entry.name);
        log(`終わった作業フォルダを消しました: ${entry.name}`);
      } catch (e) {
        log(
          `作業フォルダ ${entry.name} を消せませんでした: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /** 動いているエージェントがすべて終わるのを待つ */
  async idle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.allSettled([...this.running.values()].map((r) => r.done));
    }
  }

  /** 新しい起動を止め、動いているエージェントを中断する */
  stopNow(): void {
    this.abort.abort();
  }
}
