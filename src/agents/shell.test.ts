import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Exec } from "../integrations/exec.js";
import { findGitBash, GIT_BASH_ENV, setupShell } from "./shell.js";

const root = join("C:", "Tools", "Git");
const execPath = join(root, "mingw64", "libexec", "git-core");
const bash = join(root, "bin", "bash.exe");

const git =
  (stdout: string, code = 0): Exec =>
  () =>
    Promise.resolve({ code, stdout, stderr: "" });

describe("findGitBash", () => {
  it("git の置き場から上へたどって bin/bash.exe を見つける", async () => {
    expect(
      await findGitBash({
        git: git(`${execPath}\n`),
        exists: (p) => p === bash,
      }),
    ).toBe(bash);
  });

  it("見つからなければ undefined", async () => {
    expect(
      await findGitBash({ git: git(`${execPath}\n`), exists: () => false }),
    ).toBeUndefined();
  });

  it("git が失敗しても undefined を返す", async () => {
    expect(
      await findGitBash({ git: git("", 1), exists: () => true }),
    ).toBeUndefined();
    expect(
      await findGitBash({
        git: () => Promise.reject(new Error("ENOENT")),
        exists: () => true,
      }),
    ).toBeUndefined();
  });
});

describe("setupShell", () => {
  const base = { git: git(`${execPath}\n`), exists: (p: string) => p === bash };

  it("Windows 以外では何もしない", async () => {
    expect(await setupShell({ ...base, platform: "linux", env: {} })).toEqual({
      env: {},
      disallowedTools: [],
    });
  });

  it("Windows で Git Bash が見つかれば、場所を渡して PowerShell の道具を外す", async () => {
    expect(await setupShell({ ...base, platform: "win32", env: {} })).toEqual({
      env: { [GIT_BASH_ENV]: bash },
      disallowedTools: ["PowerShell"],
    });
  });

  it("人が場所を指定していれば探さず、PowerShell の道具を外す", async () => {
    const setup = await setupShell({
      platform: "win32",
      env: { [GIT_BASH_ENV]: "D:\\bash.exe" },
      git: () => Promise.reject(new Error("呼ばれないはず")),
      exists: () => false,
    });
    expect(setup).toEqual({ env: {}, disallowedTools: ["PowerShell"] });
  });

  it("見つからなければ PowerShell のままにして、警告を返す", async () => {
    const setup = await setupShell({
      ...base,
      exists: () => false,
      platform: "win32",
      env: {},
    });
    expect(setup.disallowedTools).toEqual([]);
    expect(setup.warning).toContain(GIT_BASH_ENV);
  });
});
