import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/config.js";
import { FakeGitHub } from "../testing/fakes.js";
import { MINIMAL_CONFIG, testConfig } from "../testing/fixtures.js";
import {
  applySettings,
  buildSettings,
  defaultValues,
  lineDiff,
  previewSettings,
  saveSettings,
  SETTINGS_FILE,
  type SettingsSources,
  valuesOf,
  withContext,
} from "./settings.js";
import type { SettingsValues } from "./types.js";

/** コメントつきの設定ファイル */
const FILE = `# Tasuki の設定
github:
  repo: owner/name # 対象リポジトリ
discord:
  channels:
    requirements: "1000000000000000001" # 要件
    questions: "1000000000000000002"
    notices: "1000000000000000003"
  allowed_users:
    - "2000000000000000001"

poll_interval: 60 # 確かめる間隔（秒）
merge:
  spec: human
workspace:
  setup:
    - npm ci
agents:
  programmer:
    model: model-a
`;

function setup(text = FILE) {
  const github = new FakeGitHub();
  const file = github.setFile(SETTINGS_FILE, text);
  const sources: SettingsSources = {
    repo: "owner/name",
    github,
    defaultBranch: "main",
    running: parseConfig(text),
    tokenSet: true,
    clock: { now: () => new Date("2026-11-23T09:05:07Z") },
  };
  const values = (change: (v: SettingsValues) => void = () => undefined) => {
    const v = valuesOf(parseConfig(text));
    change(v);
    return v;
  };
  return { github, file, sources, values };
}

describe("フォームの値", () => {
  it("設定から値を作る。省略した項目は既定の値", () => {
    const v = valuesOf(parseConfig(FILE));
    expect(v).toMatchObject({
      poll_interval: 60,
      limits: { agents: 2 },
      language: "日本語",
      merge: { spec: "human", implementation: "human", require_ci: true },
      discord: { allowed_users: ["2000000000000000001"] },
      paths: { specs: "docs/specs" },
      workspace: { setup: ["npm ci"], setup_on_change: [] },
    });
    expect(v.agents).toEqual({
      dispatcher: "",
      "spec-master": "",
      planner: "",
      designer: "",
      programmer: "model-a",
      reviewer: "",
    });
    expect(v.knowledge.context).toEqual(["docs/CONTEXT.md"]);
    expect(defaultValues()).toMatchObject({
      poll_interval: 60,
      workspace: { setup: [] },
    });
  });
});

describe("applySettings", () => {
  it("変えた項目だけを書き換え、ほかの行とコメントは残す", () => {
    const { values } = setup();
    const applied = applySettings(
      FILE,
      values((v) => {
        v.poll_interval = 30;
        v.merge.implementation = "auto";
      }),
    );
    expect(applied.problems).toEqual([]);
    expect(applied.changed).toEqual(["poll_interval", "merge.implementation"]);
    expect(applied.text).toContain("poll_interval: 30 # 確かめる間隔（秒）");
    expect(applied.text).toContain("  implementation: auto");
    expect(applied.text).toContain("repo: owner/name # 対象リポジトリ");
    expect(applied.text).toContain(
      'requirements: "1000000000000000001" # 要件',
    );
    expect(parseConfig(applied.text)).toMatchObject({
      poll_interval: 30,
      merge: { spec: "human", implementation: "auto" },
    });
  });

  it("変更が無ければ、中身をそのまま返す", () => {
    const { values } = setup();
    expect(applySettings(FILE, values())).toEqual({
      text: FILE,
      changed: [],
      problems: [],
    });
  });

  it("まだ書かれていないまとまりの項目を足せる", () => {
    const { values } = setup(MINIMAL_CONFIG);
    const applied = applySettings(
      MINIMAL_CONFIG,
      values((v) => {
        v.limits.agents = 3;
        v.workspace.setup = ["npm ci", "  ", "npm run db:env"];
        v.knowledge.architecture = ["docs/ARCHITECTURE.md"];
        v.agents.reviewer = "model-b";
      }),
    );
    expect(applied.problems).toEqual([]);
    expect(parseConfig(applied.text)).toMatchObject({
      limits: { agents: 3 },
      // 空の行は除く
      workspace: { setup: ["npm ci", "npm run db:env"] },
      knowledge: { architecture: ["docs/ARCHITECTURE.md"] },
      agents: { reviewer: { model: "model-b" } },
    });
  });

  it("ID は文字列のまま書く", () => {
    const { values } = setup();
    const applied = applySettings(
      FILE,
      values((v) => {
        v.discord.allowed_users.push("2000000000000000002");
        v.discord.channels.notices = " 1000000000000000009 ";
      }),
    );
    expect(applied.problems).toEqual([]);
    expect(parseConfig(applied.text).discord).toMatchObject({
      channels: { notices: "1000000000000000009" },
      allowed_users: ["2000000000000000001", "2000000000000000002"],
    });
  });

  it("モデルを空欄にすると、項目を消す", () => {
    const { values } = setup();
    const applied = applySettings(
      FILE,
      values((v) => {
        v.agents.programmer = "";
      }),
    );
    expect(applied.changed).toEqual(["agents.programmer"]);
    expect(applied.text).not.toContain("agents");
    expect(parseConfig(applied.text).agents).toEqual({});
  });

  it("誤りを、項目ごとに返す（設定の読み込みと同じ決まり）", () => {
    const { values } = setup();
    const applied = applySettings(
      FILE,
      values((v) => {
        v.poll_interval = 5;
        v.limits.agents = null;
        v.merge.spec = "maybe";
        v.discord.allowed_users = [];
        v.discord.channels.questions = v.discord.channels.requirements;
        v.paths.specs = "../outside";
      }),
    );
    const paths = applied.problems.map((p) => p.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "poll_interval",
        "limits.agents",
        "merge.spec",
        "discord.allowed_users",
        "paths.specs",
      ]),
    );
    expect(
      applied.problems.find((p) => p.path === "discord.allowed_users")?.message,
    ).toBe("1 人以上書きます");

    // チャンネルの重なりは、ほかの誤りが無いときに分かる
    const dup = applySettings(
      FILE,
      values((v) => {
        v.discord.channels.questions = v.discord.channels.requirements;
      }),
    );
    expect(dup.problems).toEqual([
      {
        path: "discord.channels",
        message: "要件・質問・お知らせには別々のチャンネルを書きます",
      },
    ]);
  });
});

describe("差分", () => {
  it("行ごとの差分を作る", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
    expect(lineDiff("a", "a")).toEqual([{ kind: "same", text: "a" }]);
  });

  it("変わった行の前後だけを残し、飛ばしたところを示す", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].join("\n");
    const after = before.replace("2", "two").replace("8", "eight");
    expect(
      withContext(lineDiff(before, after), 1).map((l) =>
        l.kind === "gap" ? "…" : `${l.kind[0]!}${l.text}`,
      ),
    ).toEqual(["s1", "r2", "atwo", "s3", "…", "s7", "r8", "aeight", "s9"]);
    expect(withContext(lineDiff("a\nb", "a\nb"))).toEqual([]);
  });
});

describe("設定の画面", () => {
  it("既定のブランチの設定を返す。トークンは、設定済みかどうかだけ", async () => {
    const { sources, file } = setup();
    const data = await buildSettings(sources);
    expect(data).toMatchObject({
      repo: "owner/name",
      file: ".tasuki/config.yaml",
      branch: "main",
      sha: file.sha,
      error: null,
      tokenSet: true,
      differsFromRunning: false,
    });
    expect(data.values?.poll_interval).toBe(60);
    expect(JSON.stringify(data)).not.toMatch(/token":"|TASUKI_DISCORD/);
  });

  it("動いている設定と違うことを知らせる", async () => {
    const { sources } = setup();
    sources.running = testConfig("poll_interval: 30\n");
    expect((await buildSettings(sources)).differsFromRunning).toBe(true);
  });

  it("ファイルが無い・誤りがある・読めないときは、理由を返す", async () => {
    const { sources, github } = setup();
    github.files.clear();
    expect(await buildSettings(sources)).toMatchObject({
      values: null,
      error: "not_found",
    });
    github.setFile(SETTINGS_FILE, "poll_interval: 1\n");
    const invalid = await buildSettings(sources);
    expect(invalid.values).toBeNull();
    expect(invalid.error).toContain("poll_interval");
    sources.github = {
      fileOnDefault: () => Promise.reject(new Error("GitHub に接続できません")),
      proposeFile: github.proposeFile.bind(github),
    };
    expect((await buildSettings(sources)).error).toBe(
      "GitHub に接続できません",
    );
  });

  it("点検と差分を返す", async () => {
    const { sources, file, values } = setup();
    const preview = await previewSettings(sources, {
      sha: file.sha,
      values: values((v) => {
        v.poll_interval = 30;
      }),
    });
    expect(preview.problems).toEqual([]);
    expect(preview.changed).toEqual(["poll_interval"]);
    expect(preview.diff).toContainEqual({
      kind: "remove",
      text: "poll_interval: 60 # 確かめる間隔（秒）",
    });
    expect(preview.diff).toContainEqual({
      kind: "add",
      text: "poll_interval: 30 # 確かめる間隔（秒）",
    });

    const bad = await previewSettings(sources, {
      sha: file.sha,
      values: values((v) => {
        v.poll_interval = 99999;
      }),
    });
    expect(bad.problems.map((p) => p.path)).toEqual(["poll_interval"]);
  });

  it("形の違う値と、古い印は断る", async () => {
    const { sources, file, values } = setup();
    expect(
      (await previewSettings(sources, { sha: file.sha })).problems,
    ).toHaveLength(1);
    expect(
      (
        await previewSettings(sources, {
          sha: file.sha,
          values: { ...values(), extra: 1 },
        })
      ).problems,
    ).toHaveLength(1);
    const stale = await previewSettings(sources, {
      sha: "old",
      values: values(),
    });
    expect(stale.problems[0]!.message).toContain("変わっています");
  });

  it("保存すると、新しいブランチにコミットして PR を作る", async () => {
    const { sources, github, file, values } = setup();
    const result = await saveSettings(sources, {
      sha: file.sha,
      values: values((v) => {
        v.poll_interval = 30;
        v.limits.agents = 3;
      }),
    });
    expect(result).toEqual({
      ok: true,
      number: 1,
      url: "https://example.test/pull/1",
    });
    expect(github.proposals).toHaveLength(1);
    const p = github.proposals[0]!;
    expect(p).toMatchObject({
      path: ".tasuki/config.yaml",
      sha: file.sha,
      branch: "tasuki/config-20261123090507",
      title: "chore: Tasuki の設定を変える",
    });
    expect(p.body).toContain("- `poll_interval`");
    expect(p.body).toContain("- `limits.agents`");
    expect(parseConfig(p.text)).toMatchObject({
      poll_interval: 30,
      limits: { agents: 3 },
    });
  });

  it("誤り・変更なし・古い印・失敗のときは、PR を作らずに理由を返す", async () => {
    const { sources, github, file, values } = setup();
    const save = (sha: string, change?: (v: SettingsValues) => void) =>
      saveSettings(sources, { sha, values: values(change) });

    expect(
      await save(file.sha, (v) => {
        v.poll_interval = 1;
      }),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(await save(file.sha)).toMatchObject({
      ok: false,
      reason: "unchanged",
    });
    expect(
      await save("old", (v) => {
        v.poll_interval = 30;
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
    expect(await saveSettings(sources, "x")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(github.proposals).toEqual([]);

    sources.github = {
      fileOnDefault: github.fileOnDefault.bind(github),
      proposeFile: () => Promise.reject(new Error("push できません")),
    };
    expect(
      await save(file.sha, (v) => {
        v.poll_interval = 30;
      }),
    ).toEqual({ ok: false, reason: "failed", detail: "push できません" });
  });
});
