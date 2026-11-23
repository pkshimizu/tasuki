import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  discordToken,
  loadConfig,
  parseConfig,
} from "./config.js";
import { MINIMAL_CONFIG } from "../testing/fixtures.js";

function problems(text: string): string[] {
  try {
    parseConfig(text);
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
  return [];
}

describe("parseConfig", () => {
  it("最小の設定に既定値を足す", () => {
    const c = parseConfig(MINIMAL_CONFIG);
    expect(c.merge).toEqual({
      spec: "human",
      design: "human",
      implementation: "human",
      require_ci: true,
    });
    expect(c.poll_interval).toBe(60);
    expect(c.limits.agents).toBe(2);
    expect(c.language).toBe("日本語");
    expect(c.paths).toEqual({
      specs: "docs/specs",
      design: "docs/design",
      design_system: "docs/design-system",
    });
  });

  it("プロダクトの情報の置き場は、既定値があり、1 つでも一覧でも書ける", () => {
    const d = parseConfig(MINIMAL_CONFIG).knowledge;
    expect(d.context).toEqual(["docs/CONTEXT.md"]);
    expect(d.architecture).toEqual([
      "docs/ARCHITECTURE.md",
      "docs/architecture",
    ]);
    expect(d.review_perspectives).toEqual([
      "docs/review-perspectives.md",
      "docs/review-perspectives",
    ]);
    expect(d.merge_rules).toEqual(["docs/rules/merge.md"]);

    const c = parseConfig(
      `${MINIMAL_CONFIG}knowledge:\n  context: README.md\n  implementation_rules:\n    - docs/coding/\n    - docs/testing.md\n`,
    ).knowledge;
    expect(c.context).toEqual(["README.md"]);
    expect(c.implementation_rules).toEqual(["docs/coding", "docs/testing.md"]);
    expect(c.spec_rules).toEqual(["docs/rules/spec.md"]);
  });

  it("プロダクトの情報の置き場に、知らない種類やリポジトリの外は書けない", () => {
    expect(
      problems(`${MINIMAL_CONFIG}knowledge:\n  glossary: docs/a.md\n`),
    ).toHaveLength(1);
    expect(
      problems(`${MINIMAL_CONFIG}knowledge:\n  context: ../a.md\n`),
    ).toHaveLength(1);
  });

  it("作業フォルダの準備コマンドを読む", () => {
    expect(parseConfig(MINIMAL_CONFIG).workspace).toEqual({
      setup: [],
      setup_on_change: [],
    });
    const c = parseConfig(
      `${MINIMAL_CONFIG}workspace:\n  setup:\n    - npm ci\n  setup_on_change:\n    - package-lock.json\n`,
    );
    expect(c.workspace).toEqual({
      setup: ["npm ci"],
      setup_on_change: ["package-lock.json"],
    });
  });

  it("工程ごとのマージの設定を読む", () => {
    const c = parseConfig(`${MINIMAL_CONFIG}merge:\n  spec: auto\n`);
    expect(c.merge.spec).toBe("auto");
    expect(c.merge.implementation).toBe("human");
  });

  it("パスの末尾の / を取る", () => {
    const c = parseConfig(`${MINIMAL_CONFIG}paths:\n  specs: specs/\n`);
    expect(c.paths.specs).toBe("specs");
  });

  it("誤りを項目名つきで返す", () => {
    const p = problems(
      MINIMAL_CONFIG.replace("owner/name", "name").replace(
        '"2000000000000000001"',
        "abc",
      ) + "merge:\n  spec: maybe\nunknown: 1\n",
    );
    expect(p.some((x) => x.startsWith("github.repo:"))).toBe(true);
    expect(p.some((x) => x.startsWith("discord.allowed_users.0:"))).toBe(true);
    expect(p.some((x) => x.startsWith("merge.spec:"))).toBe(true);
    expect(p.length).toBeGreaterThanOrEqual(4);
  });

  it("同じチャンネルを 2 つの用途に使えない", () => {
    const p = problems(
      MINIMAL_CONFIG.replace("1000000000000000002", "1000000000000000001"),
    );
    expect(p[0]).toContain("discord.channels");
  });

  it("作業フォルダの外を指すパスは誤り", () => {
    expect(
      problems(`${MINIMAL_CONFIG}paths:\n  specs: ../specs\n`),
    ).toHaveLength(1);
  });

  it("YAML として読めなければ誤り", () => {
    expect(problems("github: [")[0]).toContain("YAML");
  });
});

describe("loadConfig", () => {
  it("設定を読む", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasuki-config-"));
    mkdirSync(join(dir, ".tasuki"), { recursive: true });
    writeFileSync(join(dir, ".tasuki", "config.yaml"), MINIMAL_CONFIG);
    const loaded = loadConfig(dir);
    expect(loaded.config.github.repo).toBe("owner/name");
    expect(loaded.dir).toBe(dir);
  });

  it("config.yaml が無ければ誤り", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasuki-config-"));
    expect(() => loadConfig(dir)).toThrow(ConfigError);
  });
});

describe("discordToken", () => {
  it("環境変数から読む", () => {
    expect(discordToken({ TASUKI_DISCORD_TOKEN: " abc " })).toEqual({
      token: "abc",
    });
  });
  it("無ければ理由を返す", () => {
    expect(discordToken({})).toHaveProperty("problem");
  });
});

describe("ひな形", () => {
  it("templates の config.yaml は、ID を書き換えれば読める", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(
      new URL("../../templates/tasuki/config.yaml", import.meta.url),
      "utf8",
    );
    let n = 0;
    const filled = text.replaceAll(
      '"000000000000000000"',
      () => `"10000000000000000${String(n++)}"`,
    );
    const c = parseConfig(filled);
    expect(c.merge).toEqual({
      spec: "human",
      design: "human",
      implementation: "human",
      require_ci: true,
    });
    expect(c.limits.agents).toBe(2);
    expect(c.poll_interval).toBe(60);
  });
});
