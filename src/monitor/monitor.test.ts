import { describe, expect, it } from "vitest";
import { harness, newEvents, ok, output } from "../testing/fakes.js";
import { remoteMatches } from "../cli/start.js";

describe("tick", () => {
  it("出来事が無ければ司令塔を呼ばない", async () => {
    const { monitor, agents } = harness();
    await monitor.tick("main");
    await monitor.tick("main");
    expect(agents.count("dispatcher")).toBe(0);
  });

  it("新しい出来事と今の状況を司令塔に渡し、指示を実行して、判断を記録する", async () => {
    const { monitor, agents, chat, github, store, executor } = harness();
    await monitor.tick("main");
    const id = chat.postRequirement("検索機能がほしい");
    github.addIssue("前からの Issue");
    agents.dispatcher = () =>
      ok({
        reasoning: "要件が来たので仕様を作る",
        actions: [
          {
            type: "run_agent",
            role: "spec-master",
            target: { kind: "requirement", id },
            instruction: "検索機能の仕様を作る。".repeat(50),
          },
        ],
      });
    await monitor.tick("main");
    await executor.idle();

    const dispatcherRun = agents.runs.find((r) => r.name === "dispatcher")!;
    expect(dispatcherRun.prompt).toContain(`新しい要件（ID ${id}、清水）`);
    expect(dispatcherRun.prompt).toContain("前からの Issue");
    expect(agents.count("spec-master")).toBe(1);

    const [decision] = store.recentDecisions(5);
    expect(decision!.reasoning).toBe("要件が来たので仕様を作る");
    expect(decision!.events[0]).toContain("新しい要件");
    expect(decision!.actions[0]).toMatchObject({
      type: "run_agent",
      role: "spec-master",
      result: "起動した（実行 1）",
    });
    // 指示書は先頭だけを残す
    expect(
      (decision!.actions[0] as { instruction: string }).instruction,
    ).toHaveLength(200);

    // エージェントの終了が、次の確認で司令塔に届く
    agents.dispatcher = () => ok({ reasoning: "待つ", actions: [] });
    await monitor.tick("main");
    const second = agents.runs.filter((r) => r.name === "dispatcher")[1]!;
    expect(second.prompt).toContain("仕様マスター（要件");
    expect(second.prompt).toContain("最近の自分の判断");
    expect(second.prompt).toContain("要件が来たので仕様を作る");
    expect(store.pendingEvents()).toEqual([]);
  });

  it("見送った指示は、理由を判断の記録に残す", async () => {
    const { monitor, agents, github, store } = harness();
    await monitor.tick("main");
    const pr = github.addPr("検索", ["src/a.ts"], { ci: "pass" });
    agents.dispatcher = () =>
      ok({
        reasoning: "マージする",
        actions: [{ type: "merge_pr", number: pr.number }],
      });
    await monitor.tick("main");
    expect(store.recentDecisions(1)[0]!.actions[0]).toMatchObject({
      type: "merge_pr",
      result: expect.stringContaining("見送り") as string,
    });
    // 見送りの理由は出来事としても届く
    expect(store.pendingEvents()).toMatchObject([
      { payload: { type: "merge_refused" } },
    ]);
  });

  it("GitHub が読めなかったら、出来事を残したまま判断を頼まない", async () => {
    const { monitor, agents, chat, github, store } = harness();
    await monitor.tick("main");
    chat.postRequirement("検索機能がほしい");
    github.failOn = "openPullRequests";
    await monitor.tick("main");
    expect(agents.count("dispatcher")).toBe(0);
    expect(store.pendingEvents()).toHaveLength(1);
    await monitor.tick("main");
    expect(agents.count("dispatcher")).toBe(1);
    expect(store.pendingEvents()).toEqual([]);
  });

  it("司令塔が失敗したら出来事を残し、間隔を空けてやり直し、3 回続いたら人に知らせる", async () => {
    const { monitor, agents, chat, store } = harness();
    await monitor.tick("main");
    chat.postRequirement("検索機能がほしい");
    agents.dispatcher = () => ({
      kind: "error",
      message: "dispatcher: 落ちた",
    });

    await monitor.tick("main"); // 1 回目の失敗
    await monitor.tick("main"); // 2 回目の失敗（空けない）
    expect(agents.count("dispatcher")).toBe(2);
    await monitor.tick("main"); // 1 回空ける
    expect(agents.count("dispatcher")).toBe(2);
    await monitor.tick("main"); // 3 回目の失敗
    expect(agents.count("dispatcher")).toBe(3);
    expect(chat.notices.at(-1)).toContain("3 回続けて失敗");
    expect(store.pendingEvents()).toHaveLength(1);

    agents.dispatcher = () => ok({ reasoning: "直った", actions: [] });
    for (let i = 0; i < 4; i++) await monitor.tick("main");
    expect(store.pendingEvents()).toEqual([]);
  });

  it("司令塔が利用上限なら、出来事を残して回復を待つ", async () => {
    const { monitor, agents, chat, store, executor } = harness();
    await monitor.tick("main");
    chat.postRequirement("検索機能がほしい");
    agents.dispatcher = () => ({
      kind: "limit",
      resetsAt: new Date(Date.now() + 60 * 60 * 1000),
      message: "limit",
    });
    await monitor.tick("main");
    expect(executor.limit).not.toBeNull();
    await monitor.tick("main");
    expect(agents.count("dispatcher")).toBe(1);
    expect(store.pendingEvents()).toHaveLength(1);
  });
});

describe("run", () => {
  it("エージェントが終わると次の確認が進み、止めるときは終了を待つ", async () => {
    const { monitor, agents, chat, store } = harness();
    const stop = new AbortController();
    let requirementId = "";
    agents.dispatcher = (run) => {
      // 判断の履歴にも同じ文が残るので、新しい出来事の欄だけを見る
      if (newEvents(run.prompt).includes("新しい要件")) {
        return ok({
          reasoning: "仕様を作る",
          actions: [
            {
              type: "run_agent",
              role: "spec-master",
              target: { kind: "requirement", id: requirementId },
              instruction: "仕様を作る",
            },
          ],
        });
      }
      // 仕様マスターの終了を受け取ったら止める
      stop.abort();
      return ok({ reasoning: "終わり", actions: [] });
    };
    agents.worker = () => ok(output({ summary: "仕様の PR を作った", pr: 1 }));

    const running = monitor.run(stop.signal);
    await new Promise((r) => setTimeout(r, 5));
    requirementId = chat.postRequirement("検索機能がほしい");
    await running;

    expect(agents.count("spec-master")).toBe(1);
    expect(agents.count("dispatcher")).toBe(2);
    expect(store.runningRuns()).toEqual([]);
  });

  it("起動したとき、前回動いていた実行を司令塔に伝える", async () => {
    const { monitor, agents, store } = harness();
    store.startRun({
      role: "programmer",
      target: { kind: "issue", number: 1 },
      instruction: "x",
    });
    const stop = new AbortController();
    agents.dispatcher = (run) => {
      expect(run.prompt).toContain("Tasuki が止まったため途中で終わった");
      stop.abort();
      return ok({ reasoning: "やり直す", actions: [] });
    };
    await monitor.run(stop.signal);
    expect(agents.count("dispatcher")).toBe(1);
  });
});

describe("remoteMatches", () => {
  it("ssh と https の URL を見分ける", () => {
    expect(remoteMatches("git@github.com:owner/name.git\n", "owner/name")).toBe(
      true,
    );
    expect(remoteMatches("https://github.com/Owner/Name", "owner/name")).toBe(
      true,
    );
    expect(
      remoteMatches("https://github.com/owner/other.git", "owner/name"),
    ).toBe(false);
  });
});
