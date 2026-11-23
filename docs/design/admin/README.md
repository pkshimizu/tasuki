# 管理画面のデザイン

Claude のデザイン機能で作った、管理画面のデザインです（2026-11-23）。実装（`web/`）は、ここにある配色・寸法・文言に合わせます。

- もと: https://claude.ai/artifact/Kun9HGqkrEqa46YQSouuT5
- `canvas.json`: アートボードの一覧と配置
- `*.dc.html`: アートボードごとのソース。ブラウザでそのまま開いても表示されません（デザイン機能の中で動く形式）。配色は各ファイルの `THEMES`、文言は `JA`・`EN` にあります

| ファイル | 内容 |
| --- | --- |
| `Main.dc.html` | ダッシュボード |
| `Requirements.dc.html` | 要件 |
| `PRs.dc.html`・`PRDetail.dc.html` | PR とレビュー（一覧・詳細） |
| `Activity.dc.html` | 活動の履歴 |
| `Questions.dc.html` | 質問 |
| `Product.dc.html` | プロダクトの情報 |
| `Settings.dc.html` | 設定 |
| `System.dc.html` | システム |
| `Sidebar.dc.html`・`AppHeader.dc.html` | 左のメニュー・画面ヘッダー |
| `Components.dc.html` | 部品と色分け |
| `Dialogs.dc.html` | ダイアログと知らせ |
| `DashboardDark.dc.html`・`DashboardEn.dc.html` | ダッシュボードのダーク・英語 |

## デザインと実装の違い

- フォントは外部（Google Fonts）から読み込まず、PC に入っているものを使う（管理画面はこの PC の中だけで動かすため）
- 英語の「司令塔」は Conductor ではなく Dispatcher にする
- 設定の項目名は、実際の `.tasuki/config.yaml` の名前（`github.repo`・`limits.agents` など）にする
