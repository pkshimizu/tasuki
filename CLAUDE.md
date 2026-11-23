# Tasuki

要件から仕様・タスク分解・実装・レビューまでを、役割ごとのエージェント（Claude Agent SDK）で進めるソフトウェア開発 AI。TypeScript（Node 22、ESM）。設計は `docs/DESIGN.md`。

## コマンド

- `npm run build`：`src/` を `dist/` にビルドする（テストは含めない）
- `npm test`：Vitest でテストする（`src/**/*.test.ts`）
- `npm run lint` / `npm run format:check` / `npm run typecheck`

CI（`check`）は lint → 整形 → 型 → テスト → ビルドの順に実行する。main へのマージには `check` の合格が必要。

## 構成

```
src/
  cli.ts          入口
  cli/            コマンド（main: 振り分けと check、start: 部品の組み立て、output: 出力先）
  config/         .tasuki/config.yaml の読み込み
  knowledge/      プロダクトの情報（対象リポジトリの文書）の読み込みと、指示への埋め込み
  domain/         部品の間で受け渡す値の形（対象・出来事・実行結果）
  monitor/        監視スレッド（monitor: 繰り返し、collector: 集める、executor: 実行する）
  dispatcher/     司令塔（決まり・入力の組み立て・指示の形）
  agents/         エージェント（agent: Agent SDK での実行、guard: 危険な操作の拒否、roles: 役の決まり、workspace: git worktree）
  integrations/   外部とのやり取り（discord・github・exec）
  store/          記録（SQLite）
  testing/        テスト用の部品（fakes・fixtures）と通しのテスト（e2e）
```

- テストは対象のファイルの隣に `*.test.ts` で置く
- `testing/` はテストからだけ import する（ビルドには含めない）
- `config/`・`domain/`・`knowledge/`・`integrations/`・`store/` は、`monitor/`・`dispatcher/`・`cli/` を import しない

## 決まり

- 作業は Issue を作ってから始め、Issue ごとにブランチ（`feature/<番号>-<名前>`）と PR を作る
- import は `.js` 拡張子を付ける（NodeNext）
- 外部（Discord・GitHub・Agent SDK・SQLite・時刻）に触る部品はインターフェースで受け取り、テストでは差し替える
- 次に何をするかの判断はプログラムに書かず、司令塔に任せる。プログラムで守るのは `docs/DESIGN.md` の 5 章の 3 つだけ
