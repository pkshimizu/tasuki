#!/usr/bin/env node
// 記録に使う node:sqlite は Node 22 では実験的な機能の扱いで、読み込むたびに警告が出る。
// 利用者には関係がないので、この警告だけを出さない（main の読み込みより前に差し替える）。
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === "string" ? warning : warning.message;
  if (text.includes("SQLite is an experimental feature")) return;
  (emitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

const { main } = await import("./cli/main.js");
process.exitCode = await main(process.argv.slice(2));
