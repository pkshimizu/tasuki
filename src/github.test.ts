import { describe, expect, it } from "vitest";
import type { Exec, ExecResult } from "./exec.js";
import {
  GhGitHub,
  mergeProblem,
  type PullRequest,
  stageOf,
  summarizeChecks,
} from "./github.js";
import { testConfig } from "./testing.js";

/** 引数の先頭が合う答えを返す偽の gh */
function fakeGh(
  answers: { when: string; stdout?: string; code?: number; stderr?: string }[],
) {
  const calls: string[][] = [];
  const exec: Exec = (args) => {
    calls.push([...args]);
    const line = args.join(" ");
    const hit = answers.find((a) => line.startsWith(a.when));
    if (!hit) return Promise.reject(new Error(`答えがありません: ${line}`));
    const result: ExecResult = {
      code: hit.code ?? 0,
      stdout: hit.stdout ?? "",
      stderr: hit.stderr ?? "",
    };
    return Promise.resolve(result);
  };
  return { github: new GhGitHub("owner/name", exec), calls };
}

function rawPr(extra: Record<string, unknown> = {}) {
  return {
    number: 7,
    title: "検索を足す",
    body: "Closes #3",
    author: { login: "bot" },
    headRefName: "feature/3-search",
    baseRefName: "main",
    state: "OPEN",
    isDraft: false,
    headRefOid: "abc123",
    updatedAt: "2026-11-23T00:00:00Z",
    statusCheckRollup: [
      {
        __typename: "CheckRun",
        name: "check",
        status: "COMPLETED",
        conclusion: "SUCCESS",
      },
    ],
    mergeable: "MERGEABLE",
    files: [{ path: "src/search.ts" }],
    url: "https://github.com/owner/name/pull/7",
    ...extra,
  };
}

describe("summarizeChecks", () => {
  it("CI が無ければ none", () => {
    expect(summarizeChecks([]).ci).toBe("none");
    expect(summarizeChecks(null).ci).toBe("none");
  });
  it("すべて合格（スキップを含む）なら pass", () => {
    expect(
      summarizeChecks([
        { name: "a", status: "COMPLETED", conclusion: "SUCCESS" },
        { name: "b", status: "COMPLETED", conclusion: "SKIPPED" },
        { __typename: "StatusContext", context: "c", state: "SUCCESS" },
      ]).ci,
    ).toBe("pass");
  });
  it("実行中があれば pending", () => {
    expect(
      summarizeChecks([
        { name: "a", status: "COMPLETED", conclusion: "SUCCESS" },
        { name: "b", status: "IN_PROGRESS", conclusion: null },
      ]).ci,
    ).toBe("pending");
  });
  it("1 つでも失敗なら fail で、名前を返す", () => {
    expect(
      summarizeChecks([
        { name: "a", status: "IN_PROGRESS" },
        { name: "check", status: "COMPLETED", conclusion: "FAILURE" },
        { __typename: "StatusContext", context: "deploy", state: "ERROR" },
      ]),
    ).toEqual({ ci: "fail", failedChecks: ["check", "deploy"] });
  });
});

describe("stageOf", () => {
  const paths = testConfig().paths;
  it("仕様の置き場だけなら仕様", () => {
    expect(stageOf(["docs/specs/login.md"], paths)).toBe("spec");
  });
  it("デザインとデザインシステムの置き場だけならデザイン", () => {
    expect(
      stageOf(
        ["docs/design/login.html", "docs/design-system/tokens.md"],
        paths,
      ),
    ).toBe("design");
  });
  it("それ以外が混ざれば実装", () => {
    expect(stageOf(["docs/specs/login.md", "src/a.ts"], paths)).toBe(
      "implementation",
    );
    expect(stageOf(["docs/specs-old/a.md"], paths)).toBe("implementation");
    expect(stageOf([], paths)).toBe("implementation");
  });
});

describe("読み取り", () => {
  it("開いている PR を番号の順に、CI と衝突の様子つきで返す", async () => {
    const { github } = fakeGh([
      {
        when: "pr list",
        stdout: JSON.stringify([
          rawPr({ number: 9, mergeable: "CONFLICTING", statusCheckRollup: [] }),
          rawPr(),
        ]),
      },
    ]);
    const prs = await github.openPullRequests();
    expect(prs.map((p) => p.number)).toEqual([7, 9]);
    expect(prs[0]).toMatchObject({
      branch: "feature/3-search",
      state: "open",
      ci: "pass",
      mergeable: "mergeable",
      files: ["src/search.ts"],
    });
    expect(prs[1]).toMatchObject({ ci: "none", mergeable: "conflicting" });
  });

  it("PR のコメント・行へのコメント・レビューを時刻の順にまとめる", async () => {
    const { github } = fakeGh([
      {
        when: "api repos/owner/name/issues/7/comments",
        stdout:
          '{"id":"comment:1","author":"human","body":"ここを直して","path":null,"createdAt":"2026-11-23T03:00:00Z"}\n',
      },
      {
        when: "api repos/owner/name/pulls/7/comments",
        stdout:
          '{"id":"line:2","author":"bot","body":"null の扱い","path":"src/a.ts","createdAt":"2026-11-23T01:00:00Z"}\n',
      },
      {
        when: "api repos/owner/name/pulls/7/reviews",
        stdout:
          '{"id":"review:3","author":"bot","body":"","path":null,"createdAt":"2026-11-23T02:00:00Z"}\n',
      },
    ]);
    const comments = await github.comments(7);
    expect(comments.map((c) => c.id)).toEqual(["line:2", "comment:1"]);
    expect(comments[0]!.path).toBe("src/a.ts");
  });

  it("開いている Issue を返す", async () => {
    const { github } = fakeGh([
      {
        when: "issue list",
        stdout: JSON.stringify([
          {
            number: 3,
            title: "検索",
            body: "本文",
            state: "OPEN",
            labels: [{ name: "feature" }],
            updatedAt: "2026-11-23T00:00:00Z",
            url: "u",
          },
        ]),
      },
    ]);
    expect(await github.openIssues()).toEqual([
      {
        number: 3,
        title: "検索",
        body: "本文",
        state: "open",
        labels: ["feature"],
        updatedAt: "2026-11-23T00:00:00Z",
        url: "u",
      },
    ]);
  });

  it("変わったファイルを返す", async () => {
    const { github, calls } = fakeGh([
      {
        when: "api repos/owner/name/compare",
        stdout: "docs/specs/a.md\nsrc/b.ts\n",
      },
    ]);
    expect(await github.changedFiles("aaa", "bbb")).toEqual([
      "docs/specs/a.md",
      "src/b.ts",
    ]);
    expect(calls[0]![1]).toBe("repos/owner/name/compare/aaa...bbb");
  });

  it("gh が失敗したらエラーにする", async () => {
    const { github } = fakeGh([{ when: "pr list", code: 1, stderr: "boom" }]);
    await expect(github.openPullRequests()).rejects.toThrow("boom");
  });
});

describe("mergeProblem", () => {
  const pr = (extra: Partial<PullRequest>): PullRequest => ({
    number: 7,
    title: "t",
    body: "",
    author: "bot",
    branch: "b",
    base: "main",
    state: "open",
    draft: false,
    headSha: "abc",
    updatedAt: "",
    ci: "pass",
    failedChecks: [],
    mergeable: "mergeable",
    files: [],
    url: "",
    ...extra,
  });
  it("CI が合格していればマージできる", () => {
    expect(mergeProblem(pr({}), true)).toBeUndefined();
  });
  it("CI が失敗・実行中・無いときはマージできない", () => {
    expect(
      mergeProblem(pr({ ci: "fail", failedChecks: ["check"] }), true),
    ).toContain("check");
    expect(mergeProblem(pr({ ci: "pending" }), true)).toContain("実行中");
    expect(mergeProblem(pr({ ci: "none" }), true)).toContain("require_ci");
  });
  it("require_ci が false なら、CI が無くてもマージできる（失敗・実行中は不可）", () => {
    expect(mergeProblem(pr({ ci: "none" }), false)).toBeUndefined();
    expect(mergeProblem(pr({ ci: "fail" }), false)).toBeDefined();
    expect(mergeProblem(pr({ ci: "pending" }), false)).toBeDefined();
  });
  it("閉じた PR・下書き・衝突はマージできない", () => {
    expect(mergeProblem(pr({ state: "merged" }), true)).toBeDefined();
    expect(mergeProblem(pr({ draft: true }), true)).toBeDefined();
    expect(mergeProblem(pr({ mergeable: "conflicting" }), true)).toContain(
      "衝突",
    );
  });
});

describe("mergePullRequest", () => {
  it("CI が合格していれば、確かめたコミットを指定してマージする", async () => {
    const { github, calls } = fakeGh([
      { when: "pr view 7", stdout: JSON.stringify(rawPr()) },
      { when: "pr merge 7" },
    ]);
    expect(await github.mergePullRequest(7, true)).toEqual({ merged: true });
    expect(calls[1]).toEqual([
      "pr",
      "merge",
      "7",
      "--repo",
      "owner/name",
      "--squash",
      "--delete-branch",
      "--match-head-commit",
      "abc123",
    ]);
  });

  it("CI が失敗していれば gh pr merge を呼ばない", async () => {
    const { github, calls } = fakeGh([
      {
        when: "pr view 7",
        stdout: JSON.stringify(
          rawPr({
            statusCheckRollup: [
              { name: "check", status: "COMPLETED", conclusion: "FAILURE" },
            ],
          }),
        ),
      },
    ]);
    const result = await github.mergePullRequest(7, true);
    expect(result).toMatchObject({ merged: false });
    expect(calls).toHaveLength(1);
  });

  it("マージが失敗したら理由を返す", async () => {
    const { github } = fakeGh([
      { when: "pr view 7", stdout: JSON.stringify(rawPr()) },
      { when: "pr merge 7", code: 1, stderr: "not mergeable" },
    ]);
    expect(await github.mergePullRequest(7, true)).toEqual({
      merged: false,
      reason: "gh pr merge が失敗しました: not mergeable",
    });
  });
});
