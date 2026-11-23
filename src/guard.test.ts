import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { denyReason, type GuardContext } from "./guard.js";

const cwd = resolve("/work/tree");
const write: GuardContext = { cwd, defaultBranch: "main", access: "write" };
const read: GuardContext = { ...write, access: "read" };
const inspect: GuardContext = { ...write, access: "inspect" };

const bash = (command: string, ctx = write) =>
  denyReason("Bash", { command }, ctx);

describe("ファイルの書き込み", () => {
  it("作業フォルダの中は許可する", () => {
    expect(
      denyReason("Write", { file_path: "src/a.ts" }, write),
    ).toBeUndefined();
    expect(
      denyReason("Edit", { file_path: join(cwd, "docs", "a.md") }, write),
    ).toBeUndefined();
  });
  it("作業フォルダの外は拒否する", () => {
    expect(
      denyReason("Write", { file_path: "../other/a.ts" }, write),
    ).toContain("外には書き込めません");
    expect(
      denyReason("Write", { file_path: resolve("/etc/hosts") }, write),
    ).toBeDefined();
  });
  it(".tasuki/ は拒否する", () => {
    expect(
      denyReason("Edit", { file_path: ".tasuki/config.yaml" }, write),
    ).toContain(".tasuki/");
    expect(
      denyReason("NotebookEdit", { notebook_path: ".tasuki/a.ipynb" }, write),
    ).toBeDefined();
    expect(
      denyReason("Write", { file_path: ".tasuki-notes.md" }, write),
    ).toBeUndefined();
  });
  it("書けない役はすべて拒否する", () => {
    expect(denyReason("Write", { file_path: "src/a.ts" }, read)).toBeDefined();
    expect(
      denyReason("Edit", { file_path: "src/a.ts" }, inspect),
    ).toBeDefined();
  });
  it("読む操作は許可する", () => {
    expect(
      denyReason("Read", { file_path: "/etc/hosts" }, inspect),
    ).toBeUndefined();
    expect(denyReason("Grep", { pattern: "x" }, read)).toBeUndefined();
  });
});

describe("git push", () => {
  it("作業用のブランチへの push は許可する", () => {
    expect(bash("git push -u origin feature/3-search")).toBeUndefined();
    expect(bash("git push")).toBeUndefined();
    expect(bash("git push origin HEAD")).toBeUndefined();
    expect(bash("git push origin maintenance-fix")).toBeUndefined();
  });
  it("既定のブランチへの push は拒否する", () => {
    expect(bash("git push origin main")).toContain("直接 push できません");
    expect(bash("git push origin HEAD:main")).toBeDefined();
    expect(
      bash("git add -A && git commit -m x && git push origin main"),
    ).toBeDefined();
    expect(bash("git push origin feature:refs/heads/main")).toBeDefined();
    expect(
      denyReason("PowerShell", { command: "git push origin main" }, write),
    ).toBeDefined();
  });
  it("force push は拒否する", () => {
    expect(bash("git push --force origin feature/x")).toContain("force push");
    expect(bash("git push -f")).toBeDefined();
    expect(bash("git push --force-with-lease origin feature/x")).toBeDefined();
    expect(bash("git push origin +feature/x")).toBeDefined();
  });
  it("リモートのブランチの削除は拒否する", () => {
    expect(bash("git push origin --delete feature/x")).toContain("削除");
    expect(bash("git push origin :feature/x")).toBeDefined();
  });
  it("別のコマンドの引数は push の判定に混ぜない", () => {
    expect(
      bash("git push origin feature/x && git log main -1"),
    ).toBeUndefined();
  });
});

describe("そのほかのコマンド", () => {
  it("PR のマージは拒否する", () => {
    expect(bash("gh pr merge 7 --squash")).toContain("マージ");
    expect(bash("gh api -X PUT repos/o/r/pulls/7/merge")).toBeDefined();
  });
  it("PR の作成・コメント、テストの実行は許可する", () => {
    expect(bash("gh pr create --title x --body y")).toBeUndefined();
    expect(bash("gh pr comment 7 --body 指摘", read)).toBeUndefined();
    expect(bash("gh issue create --title x --body y", read)).toBeUndefined();
    expect(bash("npm install && npm test")).toBeUndefined();
  });
  it(".tasuki/ を書き換えるコマンドは拒否し、読むだけなら許可する", () => {
    expect(bash("echo x > .tasuki/config.yaml")).toContain(".tasuki/");
    expect(bash("rm -rf .tasuki")).toBeDefined();
    expect(bash("cat .tasuki/config.yaml")).toBeUndefined();
    expect(
      bash("cat .tasuki/config.yaml > /tmp/x; rm .tasuki/a"),
    ).toBeDefined();
  });
  it("書けない役のコミットと push は拒否する", () => {
    expect(bash("git commit -m x", read)).toContain("変更できません");
    expect(bash("git push origin feature/x", read)).toBeDefined();
    expect(bash("git diff main...HEAD", read)).toBeUndefined();
  });
});

describe("司令塔", () => {
  it("読むだけのコマンドは許可する", () => {
    expect(bash("gh pr view 7 --json title", inspect)).toBeUndefined();
    expect(bash("gh issue list --state open", inspect)).toBeUndefined();
    expect(bash("git log --oneline -5", inspect)).toBeUndefined();
  });
  it("それ以外は拒否する", () => {
    expect(bash("gh pr comment 7 --body x", inspect)).toBeDefined();
    expect(bash("gh pr view 7; rm -rf .", inspect)).toBeDefined();
    expect(bash("npm test", inspect)).toBeDefined();
    expect(bash("gh issue create --title x", inspect)).toBeDefined();
  });
});
