/**
 * 監視スレッド。集める → 司令塔に判断を頼む → 指示を実行する、を繰り返す。
 * 次に何をするかはここでは決めない。
 */
import type { RunAgent } from "../agents/agent.js";
import type { Collector } from "./collector.js";
import type { LoadedConfig } from "../config/config.js";
import {
  type Action,
  describeAction,
  describeEvent,
  dispatch,
  type Situation,
} from "../dispatcher/dispatcher.js";
import type { KnowledgeProvider } from "../knowledge/knowledge.js";
import type { Chat } from "../integrations/discord.js";
import type { Executor } from "./executor.js";
import {
  type Issue,
  type PullRequest,
  stageOf,
} from "../integrations/github.js";
import { reviewState } from "../domain/review.js";
import type { RunStatus } from "../domain/types.js";
import { type Clock, type Store, systemClock } from "../store/store.js";
import type { MonitorSnapshot } from "../admin/dashboard.js";

export interface MonitorDeps {
  loaded: LoadedConfig;
  store: Store;
  chat: Chat;
  collector: Collector;
  executor: Executor;
  runAgent: RunAgent;
  knowledge: KnowledgeProvider;
  log: (text: string) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  clock?: Clock;
  /** 管理画面に出す内容が変わったときに呼ぶ */
  onChange?: () => void;
}

const RECENT_RUNS = 15;
const RECENT_DECISIONS = 10;
/** 司令塔の失敗が続いたときに人に知らせる回数 */
const NOTIFY_FAILURES = 3;
/** 司令塔の失敗が続いたときに、判断を頼む間隔を空ける上限（確認の回数） */
const MAX_BACKOFF_TICKS = 30;

/** 指示書は長いので、判断の記録には先頭だけを残す */
function compact(action: Action, result: string): Record<string, unknown> {
  const { type } = action;
  switch (type) {
    case "run_agent":
      return {
        type,
        role: action.role,
        target: action.target,
        instruction: action.instruction.slice(0, 200),
        requirement: action.requirement ?? null,
        result,
      };
    case "ask_human":
      return { type, title: action.title, target: action.target, result };
    case "notify":
      return { type, message: action.message.slice(0, 100), result };
    case "merge_pr":
      return { type, number: action.number, result };
    case "complete_requirement":
      return { type, requirementId: action.requirementId, result };
    case "wait":
      return { type, reason: action.reason };
  }
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export class Monitor {
  private failures = 0;
  private skipTicks = 0;
  private wake = new AbortController();
  /** 確認の途中で起こされたら、次の待ちを飛ばす */
  private woken = false;
  /** 管理画面に出す、今の様子 */
  private readonly state: MonitorSnapshot = {
    lastCheckAt: null,
    nextCheckAt: null,
    dispatching: false,
    stopped: false,
    dispatcherFailures: 0,
    lastDispatchError: null,
    github: null,
  };

  constructor(private readonly deps: MonitorDeps) {}

  snapshot(): MonitorSnapshot {
    return { ...this.state };
  }

  private now(): Date {
    return (this.deps.clock ?? systemClock).now();
  }

  private changed(): void {
    this.deps.onChange?.();
  }

  /** エージェントが終わったときなどに、次の確認を待たずに進める */
  wakeUp(): void {
    this.woken = true;
    this.wake.abort();
  }

  private situation(github: {
    issues: Issue[];
    pullRequests: PullRequest[];
  }): Situation {
    const { store, loaded, executor } = this.deps;
    const { config } = loaded;
    const runs = store.recentRuns(RECENT_RUNS + config.limits.agents);
    return {
      requirements: store.requirements("open").map((r) => ({
        id: r.id,
        author: r.author,
        content: r.content,
      })),
      questions: store.questions().map((q) => ({
        threadId: q.threadId,
        title: q.title,
        target: q.target,
        answered: q.answered,
      })),
      issues: github.issues,
      pullRequests: github.pullRequests.map((pr) => {
        const stage = stageOf(pr.files, config.paths);
        return {
          ...pr,
          stage,
          merge: config.merge[stage],
          review: reviewState(
            pr.headSha,
            store.reviews(pr.number),
            store.findings(pr.number),
          ),
        };
      }),
      running: store.runningRuns().map((r) => ({
        role: r.role,
        target: r.target,
        startedAt: r.startedAt,
      })),
      recentRuns: runs
        .filter((r) => r.status !== "running")
        .slice(-RECENT_RUNS)
        .map((r) => ({
          role: r.role,
          target: r.target,
          status: r.status as RunStatus,
          summary: r.summary ?? "",
          finishedAt: r.finishedAt ?? "",
        })),
      recentDecisions: store.recentDecisions(RECENT_DECISIONS).map((d) => ({
        at: d.createdAt,
        events: d.events,
        reasoning: d.reasoning,
        actions: d.actions,
      })),
      limitUntil: executor.limit?.toISOString() ?? null,
    };
  }

  /** 1 回分の確認 */
  async tick(defaultBranch: string): Promise<void> {
    const { store, collector, executor, loaded, log } = this.deps;
    const collected = await collector.collect();
    executor.checkLimit();
    if (collected.github) await executor.cleanup(collected.github);
    this.state.lastCheckAt = this.now().toISOString();
    if (collected.github) {
      this.state.github = {
        issues: collected.github.issues,
        pullRequests: this.situation(collected.github).pullRequests,
      };
    }
    this.changed();

    const events = store.pendingEvents();
    if (events.length === 0) return;
    // GitHub が読めなかったときは、今の状況が分からないので判断を頼まない
    if (!collected.github) return;
    if (executor.limit !== null) return;
    if (this.skipTicks > 0) {
      this.skipTicks--;
      return;
    }

    log(`新しい出来事 ${String(events.length)} 件。司令塔に判断を頼みます`);
    this.state.dispatching = true;
    this.changed();
    let outcome;
    try {
      outcome = await dispatch(this.deps.runAgent, {
        loaded,
        defaultBranch,
        events,
        situation: this.situation(collected.github),
        knowledge: await this.deps.knowledge.load(),
      });
    } finally {
      this.state.dispatching = false;
    }

    if (outcome.kind === "limit") {
      // 出来事は残したまま、回復を待つ
      executor.setLimit(outcome.resetsAt);
      return;
    }
    if (outcome.kind === "error") {
      await this.dispatchFailed(outcome.message);
      return;
    }
    this.failures = 0;
    this.state.dispatcherFailures = 0;
    this.state.lastDispatchError = null;

    const { reasoning, actions } = outcome.output;
    log(`司令塔: ${actions.map(describeAction).join("、") || "指示なし"}`);
    // 出来事を先に処理済みにする（指示の実行の途中で止まっても、同じ指示を二重に実行しない）
    store.markHandled(events.map((e) => e.id));
    const results = await executor.execute(actions);
    for (const [i, r] of results.entries()) {
      if (r.startsWith("見送り") || r.startsWith("失敗")) {
        log(`  ${describeAction(actions[i]!)} → ${r}`);
      }
    }
    store.addDecision({
      events: events.map((e) => describeEvent(e.payload)),
      reasoning,
      actions: actions.map((a, i) => compact(a, results[i] ?? "")),
    });
    this.changed();
  }

  /** 司令塔の実行が失敗した。出来事は残し、間隔を空けてやり直す */
  private async dispatchFailed(message: string): Promise<void> {
    const { log, chat } = this.deps;
    this.failures++;
    this.state.dispatcherFailures = this.failures;
    this.state.lastDispatchError = message;
    this.changed();
    this.skipTicks = Math.min(2 ** (this.failures - 1) - 1, MAX_BACKOFF_TICKS);
    log(
      `司令塔の実行に失敗しました（${String(this.failures)} 回目。${String(this.skipTicks)} 回の確認を空けてやり直します）: ${message}`,
    );
    if (this.failures === NOTIFY_FAILURES) {
      try {
        await chat.notify(
          `司令塔の実行に ${String(NOTIFY_FAILURES)} 回続けて失敗しています。間隔を空けてやり直しますが、ログを確かめてください。\n${message.slice(0, 500)}`,
        );
      } catch {
        // お知らせに書けなくても続ける
      }
    }
  }

  /** stop の合図が来るまで繰り返す。止まるときは、動いているエージェントの終了を待つ */
  async run(stop: AbortSignal): Promise<void> {
    const { executor, collector, loaded, log } = this.deps;
    const sleep = this.deps.sleep ?? defaultSleep;
    const defaultBranch = await collector.branch();
    executor.recoverInterrupted();
    stop.addEventListener("abort", () => this.wakeUp(), { once: true });

    while (!stop.aborted) {
      this.woken = false;
      try {
        await this.tick(defaultBranch);
      } catch (e) {
        log(
          `確認に失敗しました（次の確認でやり直します）: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
        );
      }
      if (stop.aborted) break;
      this.wake = new AbortController();
      if (this.woken) {
        this.woken = false;
        continue;
      }
      this.state.nextCheckAt = new Date(
        this.now().getTime() + loaded.config.poll_interval * 1000,
      ).toISOString();
      this.changed();
      await sleep(loaded.config.poll_interval * 1000, this.wake.signal);
      this.woken = false;
    }

    this.state.stopped = true;
    this.state.nextCheckAt = null;
    this.changed();
    if (executor.runningCount > 0) {
      log(
        `動いているエージェント ${String(executor.runningCount)} 件の終了を待っています（もう一度 Ctrl+C で中断します）`,
      );
      await executor.idle();
    }
  }
}
