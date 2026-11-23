# Tasuki

要件から仕様・タスク分解・実装・レビューまでを、役割ごとのエージェント（Claude Agent SDK）で進めるソフトウェア開発 AI。TypeScript（Node 22、ESM）。設計は `docs/DESIGN.md`。

## コマンド

- `npm run build`：`src/` を `dist/` に、管理画面（`web/`）を `dist/web/` にビルドする（テストは含めない）
- `npm run dev:web`：管理画面を開発用に動かす（API は、動いている `tasuki start` に取り次ぐ）
- `npm test`：Vitest でテストする（`src/**/*.test.ts`・`web/src/**/*.test.ts`）
- `npm run lint` / `npm run format:check` / `npm run typecheck`

CI（`check`）は lint → 整形 → 型 → テスト → ビルドの順に実行する。main へのマージには `check` の合格が必要。

## 構成

```
src/
  cli.ts          入口
  cli/            コマンド（main: 振り分けと check、init: ひな形の書き出し、start: 部品の組み立て、lock: 二重起動の防止、output: 出力先）
  config/         .tasuki/config.yaml の読み込み
  knowledge/      プロダクトの情報（対象リポジトリの文書）の読み込みと、指示への埋め込み
  domain/         部品の間で受け渡す値の形（対象・出来事・実行結果）
  monitor/        監視スレッド（monitor: 繰り返し、collector: 集める、executor: 実行する）
  dispatcher/     司令塔（決まり・入力の組み立て・指示の形）
  agents/         エージェント（agent: Agent SDK での実行、guard: 危険な操作の拒否、roles: 役の決まり、workspace: git worktree）
  integrations/   外部とのやり取り（discord・github・exec）
  store/          記録（SQLite）
  admin/          管理画面のサーバー側（server: 配信、routes: API の道、operations: 操作、dashboard・views・requirements: 内容の組み立て、hub: 変化の知らせ、types: API の形）
  testing/        テスト用の部品（fakes・fixtures）と通しのテスト（e2e）
web/              管理画面の画面側（React ＋ Vite）。ビルドすると dist/web に出る
docs/design/admin/  管理画面のデザイン
```

- テストは対象のファイルの隣に `*.test.ts` で置く
- `testing/` はテストからだけ import する（ビルドには含めない）
- `web/` が `src/` から import するのは型だけ（`src/admin/types.ts` など）。サーバーのコードを画面に入れない
- 画面の文言は `web/src/i18n.ts` に日本語と英語をそろえて書く。配色と寸法は `docs/design/admin/` に合わせる
- `config/`・`domain/`・`knowledge/`・`integrations/`・`store/` は、`monitor/`・`dispatcher/`・`cli/` を import しない

## リリース

配布は、GitHub Release に添付したビルド済みのパッケージを npm で入れる形（`npm install -g https://github.com/pkshimizu/tasuki/releases/latest/download/tasuki-agent.tgz`）。npm のレジストリには公開しない（`package.json` の `private` は、誤って公開しないために残す）。

1. `package.json` の `version` を上げる PR をマージする（`npm version <patch|minor|major> --no-git-tag-version` で `package-lock.json` も揃える）
2. main の先頭に `v<version>` のタグを打って push する（`git tag v<version> && git push origin v<version>`）
3. `.github/workflows/release.yml` が、タグと版が同じことを確かめ、lint・型・テストを通し、`npm pack` でパッケージを作って GitHub Release に添付する（版つきの `tasuki-agent-<version>.tgz` と、最新を指す `tasuki-agent.tgz`）
4. Release の URL から入ることを確かめる

- `npm pack` のときに `prepare`（`npm run build`）が走り、`dist/` と `templates/` が取り込まれる。配布物に含めるファイルを増やすときは `package.json` の `files` に足す。
- リポジトリを直接指定するグローバルのインストール（`npm install -g github:pkshimizu/tasuki`）は使えない。npm が、グローバルのインストールでは Git の依存のビルドに使うパッケージを用意できず、`prepare` が失敗する。

## 決まり

- 作業は Issue を作ってから始め、Issue ごとにブランチ（`feature/<番号>-<名前>`）と PR を作る
- import は `.js` 拡張子を付ける（NodeNext）
- 外部（Discord・GitHub・Agent SDK・SQLite・時刻）に触る部品はインターフェースで受け取り、テストでは差し替える
- 次に何をするかの判断はプログラムに書かず、司令塔に任せる。プログラムで守るのは `docs/DESIGN.md` の 5 章の 3 つだけ
