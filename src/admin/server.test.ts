import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChangeHub } from "./hub.js";
import { adminOperations } from "./operations.js";
import {
  type AdminServer,
  isFromAdminPage,
  isLocalHost,
  NOT_FOUND,
  resolveStatic,
  startAdminServer,
} from "./server.js";

const servers: AdminServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

function site(): string {
  const dir = mkdtempSync(join(tmpdir(), "tasuki-admin-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<html>管理画面</html>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  return dir;
}

async function start(extra: { port?: number; staticDir?: string } = {}) {
  const hub = new ChangeHub();
  const logs: string[] = [];
  const done: string[] = [];
  const bodies: unknown[] = [];
  const server = await startAdminServer({
    operations: adminOperations(
      {
        stop: () => {
          done.push("stop");
          return { ok: true };
        },
        restart: () => {
          done.push("restart");
          return { ok: false, reason: "invalid_config", detail: "誤りがある" };
        },
        abortRun: (runId) => {
          done.push(`abort:${String(runId)}`);
          if (runId === 500) throw new Error("こわれた");
          return runId === 7
            ? { ok: true }
            : { ok: false, reason: "not_running", detail: "" };
        },
      },
      {
        preview: (body) => {
          bodies.push(body);
          return Promise.resolve({ problems: [], changed: [], diff: [] });
        },
        save: (body) => {
          bodies.push(body);
          return Promise.resolve({
            ok: false,
            reason: "unchanged",
            detail: "",
          });
        },
      },
    ),
    port: extra.port ?? 0,
    routes: (path) => {
      if (path === "/api/app") return { repo: "owner/name" };
      if (path === "/api/slow") return Promise.resolve({ slow: true });
      if (path === "/api/broken") throw new Error("組み立てに失敗");
      return NOT_FOUND;
    },
    hub,
    // 本番と同じく、末尾に区切りの付いた指定で動かす
    staticDir: (extra.staticDir ?? site()) + sep,
    log: (t) => logs.push(t),
  });
  servers.push(server);
  return { server, hub, logs, done, bodies };
}

/** Host などを自由に決めて要求する */
function get(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
  body?: string,
): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            type: String(res.headers["content-type"] ?? ""),
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("API", () => {
  it("決めた道の値を JSON で返す", async () => {
    const { server } = await start();
    const res = await get(server.port, "/api/app?x=1");
    expect(res.status).toBe(200);
    expect(res.type).toContain("application/json");
    expect(JSON.parse(res.body)).toEqual({ repo: "owner/name" });
    // 時間のかかる組み立て（Promise）も返せる
    expect(JSON.parse((await get(server.port, "/api/slow")).body)).toEqual({
      slow: true,
    });
  });

  it("知らない道は 404、組み立ての失敗は 500 にしてログに出す", async () => {
    const { server, logs } = await start();
    expect((await get(server.port, "/api/none")).status).toBe(404);
    expect((await get(server.port, "/api/broken")).status).toBe(500);
    expect(logs[0]).toContain("組み立てに失敗");
  });

  it("読む以外の要求は受け付けない", async () => {
    const { server } = await start();
    expect((await get(server.port, "/api/app", {}, "POST")).status).toBe(405);
  });

  it("この PC 以外の名前で届いた要求は断る", async () => {
    const { server } = await start();
    const res = await get(server.port, "/api/app", { Host: "evil.example" });
    expect(res.status).toBe(403);
    expect(
      (
        await get(server.port, "/api/app", {
          Host: `localhost:${String(server.port)}`,
        })
      ).status,
    ).toBe(200);
  });
});

describe("画面のファイル", () => {
  it("入口とファイルを配り、ファイルの無い道には入口を返す", async () => {
    const { server } = await start();
    const index = await get(server.port, "/");
    expect(index.status).toBe(200);
    expect(index.type).toContain("text/html");
    expect(index.body).toContain("管理画面");

    const asset = await get(server.port, "/assets/app.js");
    expect(asset.type).toContain("text/javascript");
    expect(asset.body).toBe("console.log(1)");

    // 画面の中の道（/prs/21 など）は、入口を返して画面側で振り分ける
    expect((await get(server.port, "/prs/21")).body).toContain("管理画面");
    // 拡張子のある、無いファイルは 404
    expect((await get(server.port, "/assets/none.js")).status).toBe(404);
  });

  it("置き場の外は配らない", async () => {
    const { server } = await start();
    const res = await get(server.port, "/..%2f..%2fsecret.txt");
    expect(res.status).toBe(404);
  });

  it("ビルドした画面が無ければ、その旨を返す", async () => {
    const { server } = await start({
      staticDir: mkdtempSync(join(tmpdir(), "tasuki-admin-empty-")),
    });
    const res = await get(server.port, "/");
    expect(res.status).toBe(503);
    expect(res.body).toContain("npm run build");
  });
});

describe("変化の知らせ", () => {
  it("知らせを受けるたびに changed を送り、切れたら受け取りをやめる", async () => {
    const { server, hub } = await start();
    const received: string[] = [];
    const closed = new Promise<void>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: server.port, path: "/api/events" },
        (res) => {
          expect(res.headers["content-type"]).toContain("text/event-stream");
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            received.push(chunk);
            if (received.join("").split("event: changed").length - 1 >= 2) {
              req.destroy();
            }
          });
          res.on("close", () => {
            resolve();
          });
        },
      );
      req.on("error", (e) => {
        // こちらから切ったときの ECONNRESET は想定どおり
        if ((e as NodeJS.ErrnoException).code === "ECONNRESET") resolve();
        else reject(e);
      });
      req.end();
    });
    // つながるのを待ってから知らせる
    while (hub.size === 0) await new Promise((r) => setTimeout(r, 5));
    hub.notify();
    hub.notify();
    await closed;
    expect(received.join("")).toContain("event: changed\ndata: {}");
    while (hub.size > 0) await new Promise((r) => setTimeout(r, 5));
    expect(hub.size).toBe(0);
  });
});

describe("ポート", () => {
  it("決めたポートが使用中なら、空いているポートに切り替えて知らせる", async () => {
    const first = await start();
    const second = await start({ port: first.server.port });
    expect(second.server.port).not.toBe(first.server.port);
    expect(second.logs[0]).toContain("使用中");
    expect(second.server.url).toBe(
      `http://127.0.0.1:${String(second.server.port)}/`,
    );
  });
});

describe("isLocalHost", () => {
  it("この PC を指す名前だけを通す", () => {
    expect(isLocalHost("127.0.0.1:4680")).toBe(true);
    expect(isLocalHost("localhost:4680")).toBe(true);
    expect(isLocalHost("LOCALHOST")).toBe(true);
    expect(isLocalHost("example.com")).toBe(false);
    expect(isLocalHost("127.0.0.1.example.com")).toBe(false);
    expect(isLocalHost(undefined)).toBe(false);
  });
});

describe("resolveStatic", () => {
  it("置き場の中だけを返す", () => {
    const dir = join(tmpdir(), "site");
    expect(resolveStatic(dir, "/assets/a.js")).toBe(
      join(dir, "assets", "a.js"),
    );
    expect(resolveStatic(dir, "/../secret")).toBeUndefined();
    // 置き場の指定の末尾に区切りが付いていても同じ
    expect(resolveStatic(dir + sep, "/assets/a.js")).toBe(
      join(dir, "assets", "a.js"),
    );
    expect(resolveStatic(dir + sep, "/")).toBe(dir);
    expect(resolveStatic(dir, "/%E0%A4%A")).toBeUndefined();
  });
});

describe("ChangeHub", () => {
  it("受け取りをやめたあとは呼ばれず、1 つの失敗でほかを止めない", () => {
    const hub = new ChangeHub();
    let a = 0;
    let b = 0;
    const stopA = hub.subscribe(() => a++);
    hub.subscribe(() => {
      throw new Error("失敗");
    });
    hub.subscribe(() => b++);
    hub.notify();
    stopA();
    hub.notify();
    expect([a, b]).toEqual([1, 2]);
    expect(hub.size).toBe(2);
  });
});

describe("操作", () => {
  /** 管理画面が送る要求と同じヘッダー */
  const page = (port: number) => ({
    Host: `127.0.0.1:${String(port)}`,
    Origin: `http://127.0.0.1:${String(port)}`,
    "X-Tasuki-Admin": "1",
    "Sec-Fetch-Site": "same-origin",
  });

  it("管理画面からの要求で、操作を実行して結果を返す", async () => {
    const { server, done } = await start();
    const p = server.port;
    const stop = await get(p, "/api/ops/stop", page(p), "POST");
    expect(stop.status).toBe(200);
    expect(JSON.parse(stop.body)).toEqual({ ok: true });
    const abort = await get(p, "/api/ops/runs/7/abort", page(p), "POST");
    expect(JSON.parse(abort.body)).toEqual({ ok: true });
    expect(done).toEqual(["stop", "abort:7"]);
  });

  it("できなかった操作は、理由をつけて 409 を返す", async () => {
    const { server } = await start();
    const p = server.port;
    const restart = await get(p, "/api/ops/restart", page(p), "POST");
    expect(restart.status).toBe(409);
    expect(JSON.parse(restart.body)).toEqual({
      ok: false,
      reason: "invalid_config",
      detail: "誤りがある",
    });
    const abort = await get(p, "/api/ops/runs/8/abort", page(p), "POST");
    expect(abort.status).toBe(409);
    expect(JSON.parse(abort.body)).toMatchObject({ reason: "not_running" });
  });

  it("管理画面そのものからでない要求は断り、操作を実行しない", async () => {
    const { server, done } = await start();
    const p = server.port;
    const ok = page(p);
    const cases: Record<string, string>[] = [
      // 印のヘッダーが無い（ほかのサイトのフォームからの送信）
      { Host: ok.Host, Origin: ok.Origin },
      // ほかのサイトのページから
      { ...ok, Origin: "https://evil.example" },
      { ...ok, "Sec-Fetch-Site": "cross-site" },
      // 出どころが分からない
      { Host: ok.Host, "X-Tasuki-Admin": "1" },
      // この PC の名前でない
      { ...ok, Host: "evil.example", Origin: "http://evil.example" },
    ];
    for (const headers of cases) {
      const res = await get(p, "/api/ops/stop", headers, "POST");
      expect(res.status).toBe(403);
    }
    // 読むだけの要求では操作しない
    expect((await get(p, "/api/ops/stop", ok)).status).toBe(405);
    expect((await get(p, "/api/ops/stop", ok, "OPTIONS")).status).toBe(405);
    expect(done).toEqual([]);
  });

  it("知らない操作は 404、失敗は 500。読むための道には POST できない", async () => {
    const { server, logs } = await start();
    const p = server.port;
    expect((await get(p, "/api/ops/unknown", page(p), "POST")).status).toBe(
      404,
    );
    expect(
      (await get(p, "/api/ops/runs/x/abort", page(p), "POST")).status,
    ).toBe(404);
    expect(
      (await get(p, "/api/ops/runs/500/abort", page(p), "POST")).status,
    ).toBe(500);
    expect(logs.join("\n")).toContain("こわれた");
    expect((await get(p, "/api/app", page(p), "POST")).status).toBe(405);
  });

  it("isFromAdminPage", () => {
    const base = {
      host: "localhost:4680",
      origin: "http://localhost:4680",
      "x-tasuki-admin": "1",
    };
    expect(isFromAdminPage(base)).toBe(true);
    expect(isFromAdminPage({ ...base, "sec-fetch-site": "same-origin" })).toBe(
      true,
    );
    expect(isFromAdminPage({ ...base, "sec-fetch-site": "same-site" })).toBe(
      false,
    );
    expect(isFromAdminPage({ ...base, origin: "http://localhost:3000" })).toBe(
      false,
    );
    expect(isFromAdminPage({ ...base, origin: "null" })).toBe(false);
    expect(isFromAdminPage({ ...base, "x-tasuki-admin": "0" })).toBe(false);
  });
});

describe("本文つきの操作（設定）", () => {
  const page = (port: number) => ({
    Host: `127.0.0.1:${String(port)}`,
    Origin: `http://127.0.0.1:${String(port)}`,
    "X-Tasuki-Admin": "1",
    "Content-Type": "application/json",
  });

  it("本文を JSON として渡し、結果を返す", async () => {
    const { server, bodies } = await start();
    const p = server.port;
    const body = JSON.stringify({ sha: "s1", values: { 言語: "日本語" } });
    const preview = await get(
      p,
      "/api/settings/preview",
      page(p),
      "POST",
      body,
    );
    expect(preview.status).toBe(200);
    expect(JSON.parse(preview.body)).toEqual({
      problems: [],
      changed: [],
      diff: [],
    });
    expect(bodies).toEqual([{ sha: "s1", values: { 言語: "日本語" } }]);
    // できなかった保存は 409
    const save = await get(p, "/api/settings/save", page(p), "POST", body);
    expect(save.status).toBe(409);
    expect(JSON.parse(save.body)).toMatchObject({ reason: "unchanged" });
  });

  it("読めない本文・大きすぎる本文は断る", async () => {
    const { server, bodies } = await start();
    const p = server.port;
    expect(
      (await get(p, "/api/settings/save", page(p), "POST", "{こわれた")).status,
    ).toBe(400);
    const huge = JSON.stringify({ x: "a".repeat(300 * 1024) });
    const res = await get(p, "/api/settings/save", page(p), "POST", huge).catch(
      () => ({ status: 400 }),
    );
    expect(res.status).toBe(400);
    expect(bodies).toEqual([]);
  });

  it("管理画面そのものからでない要求と、読むだけの要求では実行しない", async () => {
    const { server, bodies } = await start();
    const p = server.port;
    const noMark = { Host: page(p).Host, Origin: page(p).Origin };
    expect(
      (await get(p, "/api/settings/save", noMark, "POST", "{}")).status,
    ).toBe(403);
    expect((await get(p, "/api/settings/save", page(p))).status).toBe(405);
    expect(bodies).toEqual([]);
  });
});
