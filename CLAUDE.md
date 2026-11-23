# Tasuki

要件から仕様・タスク分解・実装・レビューまでを、役割ごとのエージェント（Claude Agent SDK）で進めるソフトウェア開発 AI。TypeScript（Node 22、ESM）。設計は `docs/DESIGN.md`。

## コマンド

- `npm run build`：`src/` を `dist/` にビルドする（テストは含めない）
- `npm test`：Vitest でテストする（`src/**/*.test.ts`）
- `npm run lint` / `npm run format:check` / `npm run typecheck`

CI（`check`）は lint → 整形 → 型 → テスト → ビルドの順に実行する。main へのマージには `check` の合格が必要。

## 決まり

- 作業は Issue を作ってから始め、Issue ごとにブランチ（`feature/<番号>-<名前>`）と PR を作る
- import は `.js` 拡張子を付ける（NodeNext）
- 外部（Discord・GitHub・Agent SDK・SQLite・時刻）に触る部品はインターフェースで受け取り、テストでは差し替える
- 次に何をするかの判断はプログラムに書かず、司令塔に任せる。プログラムで守るのは `docs/DESIGN.md` の 5 章の 3 つだけ
