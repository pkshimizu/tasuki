import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// 管理画面のビルド。dist/web に出し、tasuki start と同じプロセスから配信する。
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist/web", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    // 開発のときは、動いている tasuki start の管理画面に API を取り次ぐ
    proxy: { "/api": "http://127.0.0.1:4680" },
  },
});
