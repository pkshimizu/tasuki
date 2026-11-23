import { describe, expect, it } from "vitest";
import {
  countOpen,
  describeNewFindings,
  describeReviewState,
  type Finding,
  fixContext,
  mergeReviewProblem,
  type Review,
  reviewContext,
  reviewState,
} from "./review.js";

function finding(number: number, extra: Partial<Finding> = {}): Finding {
  return {
    pr: 7,
    number,
    round: 1,
    severity: "major",
    file: "src/search.ts",
    line: 12,
    problem: "空の検索語の扱いが漏れている",
    suggestion: "空なら全件を返す",
    status: "open",
    note: "",
    ...extra,
  };
}

function review(round: number, extra: Partial<Review> = {}): Review {
  return {
    pr: 7,
    round,
    sha: `sha${String(round)}`,
    verdict: "request_changes",
    runId: round,
    createdAt: "2026-11-23T00:00:00Z",
    ...extra,
  };
}

describe("reviewContext", () => {
  it("1 回目は PR 全体を見て、#1 から番号を振る", () => {
    const text = reviewContext("sha1", [], []);
    expect(text).toContain("1 回目のレビューです。PR 全体を見ます。");
    expect(text).toContain("#1 から順に番号を振ります");
  });

  it("2 回目以降は、前回のコミットからの差分と、指摘ごとの対応を渡す", () => {
    const text = reviewContext(
      "sha2",
      [review(1)],
      [
        finding(1, { status: "fixed", note: "空なら全件を返すようにした" }),
        finding(2, {
          severity: "minor",
          file: null,
          line: null,
          problem: "名前が分かりにくい",
          status: "declined",
          note: "既存の命名に合わせている",
        }),
        finding(3, { status: "resolved" }),
      ],
    );
    expect(text).toContain(
      "2 回目のレビューです。前回（1 回目）はコミット sha1 をレビューし、判定は request_changes でした。",
    );
    expect(text).toContain("`git diff sha1..HEAD`");
    expect(text).toContain(
      "- #1 [major] src/search.ts:12 空の検索語の扱いが漏れている\n  直し方: 空なら全件を返す\n  状態: 直したと報告（空なら全件を返すようにした）",
    );
    expect(text).toContain(
      "- #2 [minor] 名前が分かりにくい\n  直し方: 空なら全件を返す\n  状態: 直さないと報告（既存の命名に合わせている）",
    );
    // 解消済みの指摘は渡さない
    expect(text).not.toContain("- #3 ");
    expect(text).toContain("#4 から順に番号を振ります");
  });

  it("前回から新しいコミットが無ければ、差分ではなく対応の報告を確かめさせる", () => {
    const text = reviewContext("sha1", [review(1)], [finding(1)]);
    expect(text).toContain("前回から新しいコミットはありません");
    expect(text).not.toContain("git diff");
  });
});

describe("fixContext", () => {
  it("片付いていない指摘を、必須と任意に分けて渡す", () => {
    const text = fixContext([
      finding(1, { severity: "blocker" }),
      finding(2, { severity: "nit", problem: "空行が多い" }),
      finding(3, { status: "fixed" }),
      finding(4, { status: "resolved" }),
      finding(5, { status: "declined" }),
    ]);
    expect(text).toContain(
      "### 直す必要がある指摘（blocker / major）\n\n- #1 [blocker]",
    );
    expect(text).toContain("### 任意の指摘（minor / nit）\n\n- #2 [nit]");
    expect(text).not.toMatch(/- #[345] /);
    expect(text).toContain("responses に、上の指摘の番号ごとに対応");
  });

  it("片付いていない指摘が無ければ空", () => {
    expect(fixContext([])).toBe("");
    expect(fixContext([finding(1, { status: "resolved" })])).toBe("");
  });
});

describe("reviewState", () => {
  it("まだレビューしていなければ null", () => {
    expect(reviewState("sha1", [], [])).toBeNull();
    expect(describeReviewState(null)).toBe("レビューはまだ");
  });

  it("回数・最後の判定・レビューしたコミット・片付いていない指摘の数を返す", () => {
    const state = reviewState(
      "sha3",
      [review(1), review(2)],
      [
        finding(1, { status: "resolved" }),
        finding(2, { status: "fixed" }),
        finding(3, { severity: "minor" }),
        finding(4, { severity: "nit", status: "declined" }),
      ],
    );
    expect(state).toEqual({
      rounds: 2,
      lastVerdict: "request_changes",
      reviewedHead: false,
      open: { blocker: 0, major: 1, minor: 1, nit: 0 },
    });
    expect(describeReviewState(state)).toBe(
      "レビュー 2 回（最後の判定 request_changes、レビューのあとにコミットが足されている、片付いていない指摘 major 1・minor 1）",
    );
  });

  it("今の先頭をレビュー済みで、指摘が無いとき", () => {
    const state = reviewState("sha1", [review(1, { verdict: "approve" })], []);
    expect(describeReviewState(state)).toBe(
      "レビュー 1 回（最後の判定 approve、今の先頭をレビュー済み、片付いていない指摘 なし）",
    );
  });
});

describe("countOpen", () => {
  it("未対応と、直したと報告された（再レビュー待ちの）指摘を数える", () => {
    expect(
      countOpen([
        finding(1),
        finding(2, { status: "fixed" }),
        finding(3, { status: "deferred" }),
        finding(4, { status: "resolved" }),
      ]).major,
    ).toBe(2);
  });
});

describe("mergeReviewProblem", () => {
  it("レビューの記録が無ければ止めない", () => {
    expect(mergeReviewProblem("sha1", [])).toBeUndefined();
  });
  it("approve されたコミットが今の先頭なら止めない", () => {
    expect(
      mergeReviewProblem("sha2", [
        review(1),
        review(2, { verdict: "approve" }),
      ]),
    ).toBeUndefined();
  });
  it("最後の判定が request_changes なら止める", () => {
    expect(
      mergeReviewProblem("sha2", [
        review(1, { verdict: "approve" }),
        review(2),
      ]),
    ).toContain("request_changes");
  });
  it("approve のあとにコミットが足されていたら止める", () => {
    expect(
      mergeReviewProblem("sha9", [review(1, { verdict: "approve" })]),
    ).toContain("コミットが足されています");
  });
});

describe("describeNewFindings", () => {
  it("重要度ごとの数と番号の範囲を出す", () => {
    expect(
      describeNewFindings(
        [finding(0, { severity: "blocker" }), finding(0), finding(0)],
        4,
      ),
    ).toBe("新しい指摘: blocker 1・major 2（#4〜#6）");
    expect(describeNewFindings([finding(0)], 2)).toBe(
      "新しい指摘: major 1（#2）",
    );
    expect(describeNewFindings([], 1)).toBe("新しい指摘: なし");
  });
});
