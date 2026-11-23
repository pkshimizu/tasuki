/**
 * 監視スレッドの「実行する」部分。司令塔が決めた指示を実行する。
 * - エージェントは裏で動かし、終わったら出来事として記録する
 * - マージは、設定が auto で CI が合格しているときだけ行う（プログラムで必ず守る）
 * - 実行できなかった指示は理由を返す（自動ではやり直さない。やり直すかは司令塔が決める）
 */
import type { RunAgent } from "../agents/agent.js";
import { type LoadedConfig, ROLE_LABELS } from "../config/config.js";
import type { Action } from "../dispatcher/dispatcher.js";
import type { Chat } from "../integrations/discord.js";
import { type GitHub, stageOf } from "../integrations/github.js";
import {
  ROLE_ACCESS,
  rolePrompt,
  workerOutputSchema,
} from "../agents/roles.js";
import { type Clock, type Store, systemClock } from "../store/store.js";
import {
  type RunStatus,
  type Target,
  targetKey,
  targetLabel,
  type WorkerRole,
} from "../domain/types.js";
import { describeWorkspace, type Workspace } from "../agents/workspace.js";

export interface ExecutorDeps {
  loaded: LoadedConfig;
  defaultBranch: string;
  store: Store;
  chat: Chat;
  github: GitHub;
  runAgent: RunAgent;
  workspace: Workspace;
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
      const prBranch =
        target.kind === "pr"
          ? (await github.pullRequest(target.number)).branch
          : undefined;
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
          loaded.instructions[role],
        ),
        prompt: `${instruction}\n\n---\n対象: ${targetLabel(target)}\n${describeWorkspace(prepared, defaultBranch)}`,
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
        output.verdict !== null
          ? `判定: ${output.verdict === "approve" ? "approve（マージしてよい）" : "request_changes（直す必要がある）"}\n${output.summary}`
          : output.summary,
        questions,
        output.pr,
      );
    } catch (e) {
      finish("error", e instanceof Error ? e.message : String(e));
    }
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
