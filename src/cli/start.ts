/**
 * tasuki start: 本物の部品を組み立てて、監視スレッドを常駐させる。
 */
import { fileURLToPath } from "node:url";
import { adminOperations, type Operations } from "../admin/operations.js";
import { adminRoutes } from "../admin/routes.js";
import {
  previewSettings,
  saveSettings,
  type SettingsSources,
} from "../admin/settings.js";
import type { ViewSources } from "../admin/views.js";
import { ChangeHub } from "../admin/hub.js";
import { type AdminServer, startAdminServer } from "../admin/server.js";
import { version } from "./version.js";
import { createRunAgent } from "../agents/agent.js";
import { GIT_BASH_ENV, setupShell } from "../agents/shell.js";
import {
  backfillPullRequests,
  backfillRunRequirements,
  Collector,
} from "../monitor/collector.js";
import { ConfigError, discordToken, loadConfig } from "../config/config.js";
import { DiscordChat } from "../integrations/discord.js";
import { commandExec, run } from "../integrations/exec.js";
import { Executor } from "../monitor/executor.js";
import { GhGitHub } from "../integrations/github.js";
import { acquireLock, lockFile } from "./lock.js";
import type { Output } from "./output.js";
import { GitKnowledge } from "../knowledge/knowledge.js";
import { Monitor } from "../monitor/monitor.js";
import { SqliteStore, stateFile, systemClock } from "../store/store.js";
import { GitWorkspace, worktreeRoot } from "../agents/workspace.js";

/** 管理画面に出すために覚えておくログの行数 */
const LOG_LINES = 200;

/** origin の URL が設定のリポジトリを指しているか */
export function remoteMatches(url: string, repo: string): boolean {
  const normalized = url
    .trim()
    .replace(/\.git$/, "")
    .toLowerCase();
  return (
    normalized.endsWith(`/${repo.toLowerCase()}`) ||
    normalized.endsWith(`:${repo.toLowerCase()}`)
  );
}

export async function start(
  dir: string,
  output: Output,
  env: Record<string, string | undefined>,
): Promise<number> {
  // 管理画面から「再起動」されたら、設定を読み直して始め直す
  for (;;) {
    const result = await session(dir, output, env);
    if (result !== "restart") return result;
  }
}

/** 設定を読んでから止まるまで。起動し直すときは "restart" を返す */
async function session(
  dir: string,
  output: Output,
  env: Record<string, string | undefined>,
): Promise<number | "restart"> {
  let loaded;
  try {
    loaded = loadConfig(dir);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    for (const p of e.problems) output.err(p);
    return 1;
  }
  const token = discordToken(env);
  if ("problem" in token) {
    output.err(token.problem);
    return 1;
  }
  const { config } = loaded;
  const repo = config.github.repo;

  let defaultBranch: string;
  const github = new GhGitHub(repo);
  try {
    const origin = await run(commandExec("git"), "git", [
      "-C",
      dir,
      "remote",
      "get-url",
      "origin",
    ]);
    if (!remoteMatches(origin, repo)) {
      output.err(
        `${dir} の origin（${origin.trim()}）が github.repo（${repo}）と違います`,
      );
      return 1;
    }
    defaultBranch = await github.defaultBranch();
  } catch (e) {
    output.err(
      `対象リポジトリを確かめられません（git の clone で、gh にログインしている必要があります）: ${(e as Error).message}`,
    );
    return 1;
  }

  const startedAt = new Date().toISOString();
  const recentLogs: string[] = [];
  const log = (text: string) => {
    const line = `[${new Date().toLocaleTimeString("ja-JP")}] ${text}`;
    recentLogs.push(line);
    if (recentLogs.length > LOG_LINES) recentLogs.shift();
    output.out(line);
  };
  const lock = acquireLock(lockFile(stateFile(repo)));
  if ("problem" in lock) {
    output.err(lock.problem);
    return 1;
  }
  const store = new SqliteStore(stateFile(repo));
  backfillPullRequests(store, repo);
  backfillRunRequirements(store);
  const chat = new DiscordChat(token.token, config.discord);
  const shell = await setupShell();
  if (shell.warning) log(shell.warning);
  const runAgent = createRunAgent(undefined, shell);
  const knowledge = new GitKnowledge(dir, defaultBranch, config.knowledge);
  const collector = new Collector({ chat, github, store, config, log });
  const workspace = new GitWorkspace(
    dir,
    worktreeRoot(repo),
    defaultBranch,
    undefined,
    {
      commands: config.workspace.setup,
      onChange: config.workspace.setup_on_change,
    },
  );
  const monitorRef: { current?: Monitor } = {};
  const hub = new ChangeHub();
  const executor = new Executor({
    loaded,
    defaultBranch,
    store,
    chat,
    github,
    runAgent,
    knowledge,
    workspace,
    log,
    onFinish: () => monitorRef.current?.wakeUp(),
    onChange: () => hub.notify(),
  });
  const monitor = new Monitor({
    loaded,
    store,
    chat,
    collector,
    executor,
    runAgent,
    knowledge,
    log,
    onChange: () => hub.notify(),
  });
  monitorRef.current = monitor;

  const stop = new AbortController();
  /** 止める・起動し直す操作を受けて、エージェントの終了を待っているか */
  let pending: "stop" | "restart" | null = null;
  const operations: Operations = {
    stop: () => {
      pending = "stop";
      if (!stop.signal.aborted) {
        log(
          "管理画面から止めます。新しい指示は出さず、動いているエージェントの終了を待ちます",
        );
        stop.abort();
      }
      hub.notify();
      return { ok: true };
    },
    restart: () => {
      if (pending === "stop") {
        return { ok: false, reason: "stopping", detail: "" };
      }
      // 設定に誤りがあると起動し直せないので、止める前に確かめる
      try {
        loadConfig(dir);
      } catch (e) {
        if (!(e instanceof ConfigError)) throw e;
        return {
          ok: false,
          reason: "invalid_config",
          detail: e.problems.join("\n"),
        };
      }
      pending = "restart";
      if (!stop.signal.aborted) {
        log(
          "管理画面から起動し直します。動いているエージェントの終了を待ちます",
        );
        stop.abort();
      }
      hub.notify();
      return { ok: true };
    },
    abortRun: (runId) =>
      executor.abortRun(runId)
        ? { ok: true }
        : { ok: false, reason: "not_running", detail: "" },
  };

  let admin: AdminServer | undefined;
  if (config.admin.enabled) {
    const worktreesDir = worktreeRoot(repo);
    const settings: SettingsSources = {
      repo,
      github,
      defaultBranch,
      running: config,
      tokenSet: true,
      clock: systemClock,
    };
    const sources: ViewSources = {
      repo,
      version: version(),
      store,
      monitor: () => monitor.snapshot(),
      executor: () => executor.snapshot(),
      threadUrl: (threadId) => chat.threadUrl(threadId),
      requirementUrl: (messageId) => chat.requirementUrl(messageId),
      pending: () => pending,
      clock: systemClock,
      config,
      knowledge: () => knowledge.current(),
      worktrees: () => workspace.entries(),
      settings,
      system: {
        startedAt,
        pid: process.pid,
        paths: { state: stateFile(repo), worktrees: worktreesDir, repo: dir },
        shell: {
          name:
            shell.disallowedTools.includes("PowerShell") ||
            process.platform !== "win32"
              ? "bash"
              : "powershell",
          path: shell.env[GIT_BASH_ENV] ?? env[GIT_BASH_ENV] ?? null,
          warning: shell.warning ?? null,
        },
        adminUrl: () => admin?.url ?? null,
        logs: () => [...recentLogs],
      },
    };
    try {
      admin = await startAdminServer({
        port: config.admin.port,
        routes: adminRoutes(sources),
        operations: adminOperations(operations, {
          preview: (body) => previewSettings(settings, body),
          save: (body) => saveSettings(settings, body),
        }),
        hub,
        // dist/cli から見て、ビルドした画面は dist/web にある
        staticDir: fileURLToPath(new URL("../web/", import.meta.url)),
        log,
      });
      log(`管理画面: ${admin.url}`);
    } catch (e) {
      // 管理画面が開けなくても、開発は進める
      log(`管理画面を開けませんでした: ${(e as Error).message}`);
    }
  }

  // 管理画面で最初から見えるよう、プロダクトの情報を先に読み込んでおく（失敗しても続ける）
  void knowledge
    .load()
    .then(() => {
      hub.notify();
    })
    .catch((e: unknown) => {
      log(
        `プロダクトの情報を読み込めませんでした（エージェントを起動するときにやり直します）: ${e instanceof Error ? e.message : String(e)}`,
      );
    });

  // 管理画面から Discord の投稿やスレッドを開けるよう、サーバーの ID を先に調べておく（失敗しても続ける）
  void chat
    .resolveServer()
    .then(() => {
      hub.notify();
    })
    .catch(() => undefined);

  const onSignal = () => {
    // Ctrl+C は、起動し直す操作より優先して止める
    pending = "stop";
    hub.notify();
    if (!stop.signal.aborted) {
      log("止めます。新しい指示は出しません");
      stop.abort();
    } else {
      log("動いているエージェントを中断します");
      executor.stopNow();
    }
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  log(
    `${repo} の監視を始めます（${String(config.poll_interval)} 秒ごと、同時に動かすエージェントは ${String(config.limits.agents)} まで）`,
  );
  try {
    await monitor.run(stop.signal);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await admin?.close();
    store.close();
    lock.release();
  }
  // 待っている間に Ctrl+C で止められることがあるので、ここで読み直す
  if ((pending as "stop" | "restart" | null) === "restart") {
    log("起動し直します");
    return "restart";
  }
  log("止まりました");
  return 0;
}
