/**
 * tasuki start: 本物の部品を組み立てて、監視スレッドを常駐させる。
 */
import { createRunAgent } from "../agents/agent.js";
import { Collector } from "../monitor/collector.js";
import { ConfigError, discordToken, loadConfig } from "../config/config.js";
import { DiscordChat } from "../integrations/discord.js";
import { commandExec, run } from "../integrations/exec.js";
import { Executor } from "../monitor/executor.js";
import { GhGitHub } from "../integrations/github.js";
import type { Output } from "./output.js";
import { Monitor } from "../monitor/monitor.js";
import { SqliteStore, stateFile } from "../store/store.js";
import { GitWorkspace, worktreeRoot } from "../agents/workspace.js";

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

  const log = (text: string) => {
    output.out(`[${new Date().toLocaleTimeString("ja-JP")}] ${text}`);
  };
  const store = new SqliteStore(stateFile(repo));
  const chat = new DiscordChat(token.token, config.discord);
  const runAgent = createRunAgent();
  const collector = new Collector({ chat, github, store, config, log });
  const monitorRef: { current?: Monitor } = {};
  const executor = new Executor({
    loaded,
    defaultBranch,
    store,
    chat,
    github,
    runAgent,
    workspace: new GitWorkspace(dir, worktreeRoot(repo), defaultBranch),
    log,
    onFinish: () => monitorRef.current?.wakeUp(),
  });
  const monitor = new Monitor({
    loaded,
    store,
    chat,
    collector,
    executor,
    runAgent,
    log,
  });
  monitorRef.current = monitor;

  const stop = new AbortController();
  const onSignal = () => {
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
    store.close();
  }
  log("止まりました");
  return 0;
}
