/**
 * 管理画面の配信。tasuki start と同じプロセスで動き、この PC からだけ開ける。
 * - 画面のファイル（ビルドした web/）を配る
 * - /api/... で、画面に出す内容を JSON で返す
 * - /api/events で、変化を知らせる（Server-Sent Events）
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import type { ChangeHub } from "./hub.js";

/** 道に当たる内容が無いときに返す印 */
export const NOT_FOUND = Symbol("not_found");

/** パス（例: /api/prs/21）から、JSON にして返す値を作る。無ければ NOT_FOUND */
export type AdminRoutes = (path: string) => unknown;

export interface AdminServerOptions {
  /** 使いたいポート。使用中なら空いているポートに切り替える */
  port: number;
  routes: AdminRoutes;
  hub: ChangeHub;
  /** 画面のファイルの置き場 */
  staticDir: string;
  log: (text: string) => void;
}

export interface AdminServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";
const HEARTBEAT_MS = 25_000;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/** この PC から開いた要求か（別のサイトが名前を付け替えて届かせる要求を断る） */
export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").toLowerCase();
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

function send(
  res: ServerResponse,
  status: number,
  type: string,
  body: string,
): void {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, CONTENT_TYPES[".json"]!, JSON.stringify(value));
}

/** 画面のファイルの場所。置き場の外を指す道は undefined */
export function resolveStatic(
  staticDir: string,
  urlPath: string,
): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  // 置き場の指定の末尾に区切りが付いていても、同じ場所として扱う
  const root = resolve(staticDir);
  const file = resolve(join(root, decoded));
  if (file !== root && !file.startsWith(root + sep)) return undefined;
  return file;
}

function serveStatic(
  options: AdminServerOptions,
  urlPath: string,
  res: ServerResponse,
): void {
  const index = join(options.staticDir, "index.html");
  if (!existsSync(index)) {
    send(
      res,
      503,
      "text/plain; charset=utf-8",
      "管理画面のファイルがありません（npm run build でビルドしてください）",
    );
    return;
  }
  let file = resolveStatic(options.staticDir, urlPath);
  if (file === undefined) {
    send(res, 404, "text/plain; charset=utf-8", "Not Found");
    return;
  }
  // ファイルが無い道（/prs/21 など）は、画面の入口を返して画面側で振り分ける
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (extname(urlPath) !== "") {
      send(res, 404, "text/plain; charset=utf-8", "Not Found");
      return;
    }
    file = index;
  }
  res.writeHead(200, {
    "Content-Type":
      CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    // 名前に中身の印が入るファイル（assets/）は長く覚えさせ、入口は毎回確かめさせる
    "Cache-Control": urlPath.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(file).pipe(res);
}

function serveEvents(
  options: AdminServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  const unsubscribe = options.hub.subscribe(() => {
    res.write("event: changed\ndata: {}\n\n");
  });
  // 途中の機器に切られないよう、ときどき空の知らせを送る
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function handle(
  options: AdminServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!isLocalHost(req.headers.host)) {
    send(res, 403, "text/plain; charset=utf-8", "Forbidden");
    return;
  }
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "text/plain; charset=utf-8", "Method Not Allowed");
    return;
  }
  if (path === "/api/events") {
    serveEvents(options, req, res);
    return;
  }
  if (path.startsWith("/api/")) {
    void Promise.resolve()
      .then(() => options.routes(path))
      .then((value) => {
        if (value === NOT_FOUND) sendJson(res, 404, { error: "not_found" });
        else sendJson(res, 200, value);
      })
      .catch((e: unknown) => {
        options.log(
          `管理画面の ${path} の組み立てに失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        );
        sendJson(res, 500, { error: "internal" });
      });
    return;
  }
  serveStatic(options, path, res);
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error) => {
      server.off("listening", onListening);
      reject(e);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}

export async function startAdminServer(
  options: AdminServerOptions,
): Promise<AdminServer> {
  const server = createServer((req, res) => {
    handle(options, req, res);
  });
  let port: number;
  try {
    port = await listen(server, options.port);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    // 決めたポートが使用中なら、空いているポートに切り替える
    port = await listen(server, 0);
    options.log(
      `管理画面のポート ${String(options.port)} は使用中なので、${String(port)} を使います`,
    );
  }
  return {
    url: `http://${HOST}:${String(port)}/`,
    port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
