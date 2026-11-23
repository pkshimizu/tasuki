/**
 * 通しのテスト。要件の投稿からマージの知らせまでを、偽の Discord・GitHub・エージェントで通す。
 * 司令塔とエージェントの中身（LLM）は決めた動きに差し替え、
 * 監視スレッドが出来事を集め、指示を実行し、門番を守ることを確かめる。
 */
import { describe, expect, it } from "vitest";
import type { Action, DispatchDecision } from "./dispatcher.js";
import { harness, ok, output } from "./fakes.js";
import type { TasukiEvent } from "./types.js";

describe("要件からマージまで", () => {
  it("仕様 → 質問と回答 → Issue → 実装 → レビューの指摘と修正 → マージ → 完了の知らせ", async () => {
    const h = harness("merge:\n  spec: auto\n  implementation: auto\n");
    const { chat, github, store, agents, executor, monitor } = h;
    let requirementId = "";
    let specPr = 0;
    let implPr = 0;
    let issueNumber = 0;

    // 司令塔: 標準の流れどおりに指示を出す
    const decide = (events: TasukiEvent[]): Action[] => {
      const actions: Action[] = [];
      for (const { payload: e } of events) {
        if (e.type === "requirement_posted") {
          actions.push({
            type: "run_agent",
            role: "spec-master",
            target: { kind: "requirement", id: e.requirementId },
            instruction: `要件: ${e.content}`,
          });
        } else if (e.type === "question_answered" && e.target) {
          actions.push({
            type: "run_agent",
            role: "spec-master",
            target: e.target,
            instruction: `回答: ${e.replies.map((r) => r.content).join(" / ")}`,
          });
        } else if (e.type === "pr_changed" && e.change === "opened") {
          actions.push({
            type: "run_agent",
            role: "reviewer",
            target: { kind: "pr", number: e.number },
            instruction: "レビューする",
          });
        } else if (e.type === "pr_changed" && e.change === "updated") {
          actions.push({
            type: "run_agent",
            role: "reviewer",
            target: { kind: "pr", number: e.number },
            instruction: "修正を確かめる",
          });
        } else if (e.type === "agent_finished" && e.role === "reviewer") {
          const number = e.pr!;
          actions.push(
            e.summary.includes("approve")
              ? { type: "merge_pr", number }
              : {
                  type: "run_agent",
                  role: "programmer",
                  target: { kind: "pr", number },
                  instruction: `指摘を直す: ${e.summary}`,
                },
          );
        } else if (e.type === "docs_changed" && e.stage === "spec") {
          actions.push({
            type: "run_agent",
            role: "planner",
            target: { kind: "repo" },
            instruction: `仕様が変わった: ${e.files.join(", ")}`,
          });
        } else if (e.type === "issue_changed" && e.change === "opened") {
          actions.push({
            type: "run_agent",
            role: "programmer",
            target: { kind: "issue", number: e.number },
            instruction: `Issue #${String(e.number)} を実装する`,
          });
        } else if (e.type === "issue_changed" && e.change === "closed") {
          actions.push({
            type: "complete_requirement",
            requirementId,
            message: "検索機能が完成しました",
          });
        }
      }
      return actions;
    };
    agents.dispatcher = () => {
      const decision: DispatchDecision = {
        reasoning: "標準の流れ",
        actions: decide(store.pendingEvents()),
      };
      return ok(decision);
    };

    // 作業エージェント: 偽の GitHub に成果を残す
    agents.worker = (run) => {
      switch (run.name) {
        case "spec-master": {
          if (!run.prompt.includes("回答:")) {
            return ok(
              output({
                status: "question",
                summary: "検索の対象が決まっていない",
                questions: [
                  "1. 検索の対象はタイトルだけですか（おすすめ: はい）",
                ],
              }),
            );
          }
          specPr = github.addPr("検索の仕様", ["docs/specs/search.md"], {
            ci: "pass",
          }).number;
          return ok(output({ summary: "仕様の PR を作った", pr: specPr }));
        }
        case "planner": {
          issueNumber = github.addIssue("検索を実装する").number;
          return ok(
            output({ summary: `Issue #${String(issueNumber)} を作った` }),
          );
        }
        case "programmer": {
          if (implPr === 0) {
            implPr = github.addPr("検索を実装する", ["src/search.ts"], {
              ci: "pass",
              body: `Closes #${String(issueNumber)}`,
            }).number;
          } else {
            github.updatePr(implPr, { headSha: "fixed", ci: "pass" });
          }
          return ok(output({ summary: "実装して push した", pr: implPr }));
        }
        case "reviewer": {
          const number = Number(/対象: PR #(\d+)/.exec(run.prompt)![1]);
          const needsFix =
            number === implPr && github.prs.get(number)!.headSha !== "fixed";
          if (needsFix) {
            github.addComment(
              number,
              "空の検索語の扱いが漏れている\n\n<!-- tasuki:reviewer -->",
              "bot",
            );
          }
          return ok(
            output({
              summary: needsFix ? "空の検索語の扱いが漏れている" : "問題なし",
              verdict: needsFix ? "request_changes" : "approve",
              pr: number,
            }),
          );
        }
        default:
          throw new Error(`知らない役: ${run.name}`);
      }
    };

    // 起動して、人が要件を投稿する
    await monitor.tick("main");
    requirementId = chat.postRequirement("検索機能がほしい");

    let replied = false;
    // 要件が受け取られ、完了になるまで確認を繰り返す
    const completed = () =>
      store.requirements().length > 0 &&
      store.requirements("open").length === 0;
    for (let i = 0; i < 40 && !completed(); i++) {
      await monitor.tick("main");
      await executor.idle();
      // 質問スレッドができたら、人が返信する
      const [threadId] = [...chat.threads.keys()];
      if (threadId !== undefined && !replied) {
        chat.reply(threadId, "はい、タイトルだけでよい");
        replied = true;
      }
    }

    // 起動した役の順番
    expect(
      agents.runs.filter((r) => r.name !== "dispatcher").map((r) => r.name),
    ).toEqual([
      "spec-master", // 質問を返す
      "spec-master", // 回答を受けて仕様の PR を作る
      "reviewer", // 仕様の PR
      "planner", // 仕様のマージを受けて Issue を作る
      "programmer", // Issue を実装して PR を作る
      "reviewer", // 指摘する
      "programmer", // 指摘を直す
      "reviewer", // 承認する
    ]);

    // 質問と回答が仕様マスターに渡っている
    expect([...chat.threads.values()][0]).toMatchObject({
      title: `仕様マスターからの質問（要件 ${requirementId}）`,
    });
    expect(store.questions()[0]!.answered).toBe(true);
    expect(
      agents.runs.filter((r) => r.name === "spec-master")[1]!.prompt,
    ).toContain("回答: はい、タイトルだけでよい");

    // 仕様と実装の PR がマージされ、Issue が閉じ、要件が完了している
    expect(github.merged).toEqual([specPr, implPr]);
    expect(github.issueMap.get(issueNumber)!.state).toBe("closed");
    expect(store.requirements("open")).toEqual([]);
    expect(store.runningRuns()).toEqual([]);

    // お知らせ: PR の作成とマージ、要件の完了
    expect(chat.notices.map((n) => n.split("\n")[0])).toEqual([
      `PR を作成しました: #${String(specPr)} 検索の仕様`,
      `PR がマージされました: #${String(specPr)} 検索の仕様`,
      `PR を作成しました: #${String(implPr)} 検索を実装する`,
      `PR がマージされました: #${String(implPr)} 検索を実装する`,
      "検索機能が完成しました",
    ]);

    // エージェントが書いたレビューコメントは、人のコメントとして司令塔に届いていない
    const seen = store.recentDecisions(100).flatMap((d) => d.events);
    expect(seen.some((e) => e.includes("のコメント"))).toBe(false);
    // すべての出来事が司令塔に渡っている
    expect(store.pendingEvents()).toEqual([]);
  });

  it("マージの設定が human なら、Tasuki はマージせず、人のマージで先へ進む", async () => {
    const { chat, github, store, agents, executor, monitor } = harness();
    agents.dispatcher = () => {
      const actions: Action[] = [];
      for (const { payload: e } of store.pendingEvents()) {
        if (e.type === "pr_changed" && e.change === "opened") {
          // レビューを省いて、すぐマージを頼む
          actions.push({ type: "merge_pr", number: e.number });
        } else if (e.type === "docs_changed") {
          actions.push({
            type: "run_agent",
            role: "planner",
            target: { kind: "repo" },
            instruction: "Issue を作る",
          });
        }
      }
      return ok({ reasoning: "", actions });
    };
    await monitor.tick("main");
    const pr = github.addPr("検索の仕様", ["docs/specs/search.md"], {
      ci: "pass",
    });
    for (let i = 0; i < 3; i++) {
      await monitor.tick("main");
      await executor.idle();
    }
    expect(github.merged).toEqual([]);
    expect(agents.count("planner")).toBe(0);
    expect(
      store
        .recentDecisions(10)
        .some((d) => d.events.some((e) => e.includes("見送った"))),
    ).toBe(true);

    // 人が GitHub でマージする（Tasuki の門番は通らない）
    github.updatePr(pr.number, { state: "merged" });
    github.commit(pr.files);
    for (let i = 0; i < 3; i++) {
      await monitor.tick("main");
      await executor.idle();
    }
    expect(agents.count("planner")).toBe(1);
    expect(chat.notices.at(-1)).toContain("PR がマージされました");
  });
});
