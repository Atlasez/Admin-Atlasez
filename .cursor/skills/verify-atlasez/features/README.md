# 機能Journey一覧

各JourneyはローカルADMINビルドをPlaywrightで操作する。API応答はE2E fixtureで差し替え、Cloudflare Workerや本番D1には接続しない。

| 機能         | 実行コマンド                               | 代表Journey                    |
| ------------ | ------------------------------------------ | ------------------------------ |
| ポータル     | npm run agent:verify -- run portal         | 運営・参加者プロジェクトを表示 |
| 記事編集     | npm run agent:verify -- run article-editor | 下書きを自動保存して再読込     |
| 公開処理     | npm run agent:verify -- run publication    | 状態変更中の古い応答を破棄     |
| 参加者タスク | npm run agent:verify -- run member-tasks   | タスクを絞り込み状態変更       |
| カレンダー   | npm run agent:verify -- run calendar       | 月移動と再試行                 |
| 権限         | npm run agent:verify -- run permissions    | ユーザー単位の実効範囲         |

初期状態、操作、成功・失敗条件、変更状態の検査方法は各ファイルに記載する。
