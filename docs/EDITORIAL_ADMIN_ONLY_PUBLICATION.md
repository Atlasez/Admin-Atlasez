# 運営サイト完結型の記事公開

## 目的

記事の公開・公開取り消しを、運営者がGitHubを開かずに管理画面だけで完了させる。GitHubは確定版の保存とCI、Cloudflareは配信基盤として利用するが、通常運用の操作対象にはしない。

## 自動処理

管理画面で公開確定すると、管理WorkerはD1に公開Runと対象版IDを固定し、保存済みスナップショットから公開PRを作成する。GitHub Webhookの`check_run` / `check_suite` / `workflow_run` / `pull_request`を受信すると、対象PRだけを確認し、成功した場合だけ公開専用GitHub AppでMergeする。

Cloudflare Workers BuildsはWorker Versionを候補としてアップロードし、記事ID・パス・公開状態・D1版IDの一覧を署名付きでADMIN Workerへ送る。ADMIN Workerは候補Versionと全記事・版IDをD1へ保存し、その保存に成功した後だけWorkers Buildsが候補を100%配信へ切り替える。ADMIN WorkerはCloudflareのDeployment APIで実際のVersion IDと配信率を照合し、公開履歴と記事ごとの`published_version_id`を同じD1 batchで記録する。

候補内容の保存に失敗したときはCloudflareを切り替えない。切替後の履歴書き込みに失敗したときは、候補をD1に残したままにし、1分CronがCloudflareの現在のDeploymentと照合して公開履歴・版ポインターを補修する。公開本文を別のcanonical原稿へコピーする手順はない。

一時的なCI・外部API失敗は最大2回まで再試行する。記事内容、スキーマ、競合、権限エラーは記事を勝手に変更せず、運営サイトへ日本語で表示する。Webhookが届かない場合に備え、1分Cronは同期・復旧用として残す。

## 初回の本番設定

1. GitHub Appを作成し、`Atlasez/Atlasez01`だけへインストールする。
2. AppにはMetadata read、Contents read/write、Pull requests read/writeを付与する。Checks readは推奨（未付与でも、公開リポジトリのCommit statusesをフォールバックしてCI判定を継続する）。
3. `main`のbranch protection / rulesetは読み取り専用で確認する。この公開フローからrequired approving reviews、Bypass actor、その他のbranch protection設定を追加・変更しない。現在のルールで公開専用Appやレビュー用認証情報が処理できない場合は、権限を広げたり手動mergeで迂回したりせず、`needs-operator`として停止し、設定変更が必要な理由・対象・影響・復旧方法を別途レビューする。
4. 管理Workerへ次のSecretを登録する。

   - `GITHUB_APP_ID`
   - `GITHUB_APP_INSTALLATION_ID`
   - `GITHUB_APP_PRIVATE_KEY`
   - `GITHUB_REVIEW_TOKEN`（推奨。PR作成者とは別の、レビューを承認できる書き込み権限アカウントのToken）
   - `EDITORIAL_RELEASE_WEBHOOK_SECRET`（Workers Buildsと共有する署名鍵）
   - `CLOUDFLARE_WORKERS_READ_TOKEN`（固定Account内のWorker `atlasez01` のDeployment/Versionを読むToken。Workers Scripts Readのみ）

5. `PUBLIC_SITE_ORIGIN=https://atlasez.org`を設定する。
6. Workers Buildsには`EDITORIAL_RELEASE_ENDPOINT=https://admin.atlasez.org/api/internal/editorial-release`と`EDITORIAL_RELEASE_WEBHOOK_SECRET`を登録する。共有D1のmigration `0139_editorial_release_candidates.sql`を明示手順で適用し、候補APIを含むADMIN Workerを配信してからWorkers Builds側を設定する。
7. `GITHUB_WEBHOOK_SECRET`を管理WorkerのSecretへ登録し、`Atlasez/Atlasez01`のRepository webhookを次の設定で追加する。

   - Payload URL: `https://admin.atlasez.org/api/internal/github-publication-webhook`
   - Content type: `application/json`
   - Secret: `GITHUB_WEBHOOK_SECRET`と同じ値
   - Events: Check runs、Check suites、Workflow runs、Pull requests
   - Active: 有効

Webhookは署名を検証し、対象PR・ブランチ・Commitに紐づく公開Runだけを処理する。未署名または別リポジトリの通知は処理しない。Webhookが遅延・欠落した場合も1分Cronが同じRunを再取得する。Checks APIが権限不足（403/404）の場合はCommit statuses APIへ自動フォールバックし、Actions:writeやWorkflow dispatch権限には依存しない。

`GITHUB_PUBLISH_TOKEN`は移行期間の読み書き用フォールバックとして残すが、自動Mergeには利用しない。GitHub Appが未設定の場合、管理画面の公開連携は「自動公開未設定」と表示される。

`GITHUB_REVIEW_TOKEN`は公開用GitHub AppやPR作成者と同じアカウントにしない。専用Tokenが未設定でも、公開用Appが設定済みなら既存の人間用`GITHUB_PUBLISH_TOKEN`を移行用フォールバックとしてレビューに利用できる。管理画面はTokenの利用者・権限と自動承認の設定状態を表示し、CI成功後に別アカウントで対象Commitへの承認レビューを作成してから、公開用AppでMergeする。既存の同一Commitへの承認は再利用するため、Cron再実行でレビューを重複作成しない。

## 管理画面上の状態

`受付済み`、`自動検証中`、`公開処理中`、`学習サイト反映確認中`、`公開済み`、`自動再試行中`、`自動公開失敗`、`運営サイトで確認が必要`を表示する。

## 変更の安全性

- ブランチ保護を一時的に解除しない。
- ADMIN WorkerからCloudflareへ書き込まない。候補アップロードとVersion切替は既存のWorkers Builds経路だけが行う。
- D1候補記録はCloudflare切替前、公開履歴はCloudflare切替後に分け、Run、CI結果、Merge SHA、Candidate Version ID、実Deployment ID、時刻、失敗理由をD1に保存する。
- 公開済み本文をcanonical原稿へコピーせず、記事ごとの`published_version_id`で公開版を識別する。
- 同じ記事の自動実行Runは同時に1件だけにする。
- 自動MergeはCI成功、対象PR、対象ブランチを確認した後だけ実行する。
- 自動承認はCI成功、対象PRの作成者とのアカウント分離、対象Commit一致を確認した後だけ実行する。
- GitHub Tokenの値はレスポンスや監査ログへ出力しない。
