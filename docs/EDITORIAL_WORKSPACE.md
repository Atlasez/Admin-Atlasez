# 記事編集ワークスペース

`/admin/editor` は、公開学習サイトとは分離された運営者向けの執筆・査読画面です。
Google OAuthでログインし、既存の `report_admin_permissions` に設定された担当分野だけを扱えます。`*` は全分野です。

## できること

- 新規記事の下書き作成と、保存済み原稿の編集・版保存
- Markdown本文を編集し、`$...$` / `$$...$$` の数式をKaTeXで即時プレビューする
- 原稿を保存した後、画像をアップロードして本文へ挿入する
- TikZ/LaTeXのソースブロックを挿入し、査読プレビューで確認する
- 原稿単位でコメントを残し、`下書き → 査読中 → 承認済み` を共有する
- 編集画面上部の依頼管理から、依頼者または運営管理者が未完了の依頼を取り下げる
- 公開前の記事のアーカイブを編集画面から申請し、統括・運営内運営の承認後にアーカイブする
- 承認後、管理者が「公開する」を押して本文と画像を含むGitHub PRを作成する

原稿とコメントはD1の `editorial_documents` / `editorial_comments` に保存されます。画像素材はD1の `editorial_assets` に原稿単位で保存され、公開時にGitHubへ同期されます。詳細は [記事素材・LaTeX/TikZ運用](EDITORIAL_MEDIA_AND_LATEX.md) を参照してください。
公開済み記事のMarkdownや公開サイトの表示は、この操作だけでは変更されません。

既存記事を開くと、最後に保存した版が編集画面に表示されます。公開済み記事の修正は、対応する運営原稿を直接編集します。保存のたびにD1へ新しい版IDを作成し、公開処理が完了するまで公開版IDを維持します。内容を変更すると承認状態は下書きへ戻り、再レビューと再承認が必要です。公開済み記事の分野・カテゴリ・URL名・概念IDは変更できません。更新案を作成・切替する操作はありません。公開カタログは公開状態と記事IDの照合に継続使用します。

同じ担当者への未完了のフィードバック依頼は重複して作成できません。依頼ダイアログでは未完了依頼がある担当者を選べず、APIも同じ条件を検査します。既存の重複履歴は保持しますが、完了数は担当者ごとに一度だけ数え、同じ担当者の依頼がすべて完了したときに完了として扱います。担当者全員への依頼は一つの依頼単位として数えます。未完了依頼の管理リンクは編集画面上部にあり、依頼者または運営管理者がそこから履歴を開いて取り下げられます。取り下げた依頼は履歴に残り、完了数には含まれません。すべての依頼を取り下げると記事は下書きへ戻り、ほかに取り下げていない依頼がある場合はフィードバック中のままです。完了済みの依頼は取り下げられません。

## 記事のアーカイブ申請

アーカイブは、公開前で公開審査・公開予約に入っていない下書きまたはフィードバック中の記事に限ります。記事の編集画面から申請し、該当分野の統括、プロジェクトリーダー、アトラスの有効な運営内運営、または全分野管理者が承認・却下します。申請は運営サイトの通知欄と設定済みのアトラスDiscord通知へ届き、申請者には処理結果が通知されます。申請者本人は自分の申請を承認できません。同じ記事に同時に作成できる申請は1件です。

承認後の記事は30日間、記事一覧から復元できます。申請・決定・取り下げは監査ログに残ります。既存のフィードバック依頼やコメントは、アーカイブの承認では削除・完了扱いになりません。申請テーブルは`migrations/0144_editorial_archive_approval_requests.sql`で作成します。migrationは通常のBuild/Deployでは適用せず、共有D1への適用は[ADMIN変更手順](ADMIN_CHANGE_WORKFLOW.md)に従って別途レビューします。

## 現在の公開手順

1. 執筆者がフィードバックを反映し、分野統括・プロジェクトリーダーが運営サイト内で担当段階の審査を完了する。これは原稿内容に対する人の承認である。
2. 運営管理者が承認済み原稿の**公開する**を押す。公開Runへ対象版IDを固定する。
3. Workerが固定版の内容・版ID・画像素材から公開PRを作成する。PR本文は現在編集中の行ではなく、D1に保存された対象版スナップショットから生成する。
4. GitHub連携が設定済みの場合、公開Workerは対象PRとCommitのCI状態を確認し、公開専用Appと別のレビュー用認証情報で技術処理を進める。CI失敗、認証/権限不足、対象SHAの不一致、`needs-operator`では自動処理を止め、運営画面に要確認状態を残す。公開PRのCI確認・自動レビューは運営サイトで完了する原稿審査の代替ではない。
5. GitHub `main`への反映後、Workers Buildsは未配信の候補Versionを作り、その候補に含む記事・D1版IDをD1へ記録します。記録成功後だけWorker `atlasez01`へ切り替えます。
6. ADMIN WorkerがCloudflare最新DeploymentのVersion IDと配信率100%を確認してから、D1の公開版ポインターと公開履歴を更新します。切替後の履歴記録に失敗した場合は1分ごとにCloudflareの現行配信を照合し、候補記録からD1だけを補修します。

公開ボタンを押した時点では学習サイトへ反映せず、PRのMerge・候補内容のD1記録後にだけ反映されます。PR作成後は編集画面からPRリンクを確認できます。公開版はcanonical本文のコピーではなく記事版IDで管理し、公開履歴にはCloudflare Version ID・Deployment IDを記録します。

人による原稿審査は運営サイトの担当段階と管理者権限で行い、GitHub PRは公開用データ・CI・自動配信の証跡として扱います。ADMINや公開リポジトリのbranch protection、required approving reviewsはこの手順から変更しません。GitHub Appの既存設定で処理できない場合、手動mergeやrule変更で回避せず`運営サイトで確認が必要`として止めます。詳細は[運営サイト完結型の記事公開](EDITORIAL_ADMIN_ONLY_PUBLICATION.md)を参照してください。

## GitHub連携の設定

公開の現行連携は公開専用GitHub App、Webhook、レビュー用認証情報で構成します。個人アクセストークンを画面へ入力する設計にはしません。歴史的な`GITHUB_PUBLISH_TOKEN`は移行期間の読み書きフォールバックとして残っていますが、自動Mergeには使いません。実際のSecretの値や設定状態をこの文書へ転記しません。

現行コードが参照する設定名は次のとおりです。

1. `GITHUB_APP_ID`、`GITHUB_APP_INSTALLATION_ID`、`GITHUB_APP_PRIVATE_KEY`（公開専用GitHub Appの設定）
2. `GITHUB_WEBHOOK_SECRET`（公開リポジトリWebhook署名の検証）
3. `GITHUB_REVIEW_TOKEN`（PR作成者と公開Appとは別のレビュー用認証情報。App設定と実装が認める既存フォールバック条件は[公開手順](EDITORIAL_ADMIN_ONLY_PUBLICATION.md)を確認）
4. `EDITORIAL_RELEASE_WEBHOOK_SECRET`（Workers Buildsと共有する候補通知の署名鍵）
5. `CLOUDFLARE_WORKERS_READ_TOKEN`（Worker `atlasez01` のDeployment/Version照合用。`atlasez01`だけの`Individual Workers Metadata Read-Only`）
6. `PUBLIC_SITE_ORIGIN=https://atlasez.org` と `GITHUB_REPOSITORY=Atlasez/Atlasez01`

`migrations/0139_editorial_release_candidates.sql`の適用後に、新しい公開候補API・履歴記録を有効にします。ADMINのWorker設定と公開Workers Buildsの設定は、対象値・権限・適用順・復旧方法をPRでレビューしてから変更します。設定状態は編集画面の連携診断で確認し、未設定・失敗は公開不可として扱います。Tokenや秘密鍵の値をログ・PR・Issueへ書き写さないでください。

本番の設定一覧、適用順、影響、復旧手順は[記事自動公開の本番設定と受入確認](EDITORIAL_PRODUCTION_READINESS.md)を参照してください。

## ローカル確認

```bash
npm run build
npx wrangler d1 migrations apply atlasez-reports-local --local --config wrangler.admin.local.jsonc
npm run dev:admin
```

`http://localhost:8787/admin/editor` を開きます。ローカル設定では開発専用の全分野権限を使うため、Googleログインは不要です。`wrangler.admin.local.jsonc` の `ADMIN_AUTH_MODE: local` はlocalhost以外では無効になり、本番用の `wrangler.admin.jsonc` には含めません。

## 同時編集WorkerとPR Preview

Cloudflare WorkersはDurable Objectを実装するWorkerに通常のPR Preview URLを生成できません。同時編集処理は非公開の`atlasez-editorial-collaboration` Workerへ分離し、運営サイト本体は外部Durable Object bindingで参照します。PR branchからこのWorkerやADMINを直接deployしてはいけません。ローカル確認は下記のlocal Durable Objectで行い、Previewで検証できない箇所は制約としてPRに記録します。

`atlasez-editorial-collaboration`の本番配信は固定Account内のCloudflare Workerを変更する操作です。現行のADMIN正規配信方針はGitHub `main`を正本としたWorkers Buildsであり、この文書は別の直接deploy経路を承認しません。DO Workerの本番Build設定・run・Version・D1結合を確認できない場合は配信を止め、運営サイト本体のdeployで代用しません。配信経路の不足はPR/Issueで解決してから運用します。

通常のローカル開発では`wrangler.admin.local.jsonc`が同じクラスをローカルDurable Objectとして起動するため、従来どおり`npm run dev:admin`だけで確認できます。

運営APIが参照するD1 migrationは本番DBとADMINで共有されます。PR Previewのために本番D1 migrationを適用してはいけません。migrationはバックアップ、互換性確認、PRレビュー、隔離検証、明示した適用/復旧計画を伴う独立したDB変更です。通常のBuild/Deployでは自動適用せず、適用が承認されていない場合は配信を止めます。

```sh
npm run db:reports:local
npx wrangler d1 migrations list atlasez-reports-local --local --config wrangler.local.jsonc
```

ローカル用DBと明示的な`--local`だけを使ってschemaを確認します。ローカル検証結果は本番migration適用の許可や本番データの状態を意味しません。共有D1へremote接続する作業は[ADMIN変更手順](ADMIN_CHANGE_WORKFLOW.md)と[D1復旧手順](ADMIN_D1_RECOVERY.md)に従い、PR Previewから実行しません。
