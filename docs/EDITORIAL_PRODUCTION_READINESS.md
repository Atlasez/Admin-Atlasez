# 記事自動公開の本番設定と受入確認

記事編集ワークスペースの自動公開を本番運用するための設定・確認手順です。Secretの値やCloudflare API Tokenは、Git、PR、Issue、チャットへ記録しません。

## 固定対象

| 対象               | 値                                                         |
| ------------------ | ---------------------------------------------------------- |
| ADMIN Worker       | `atlasez-admin`                                            |
| 公開Worker         | `atlasez01`                                                |
| Cloudflare Account | `812021e62fa20465950b61be55dfe064`                         |
| ADMIN D1           | `atlasez-reports` / `d5112a62-7ed6-49c8-b6a2-18ee2dbab678` |
| 公開候補API        | `https://admin.atlasez.org/api/internal/editorial-release` |

## 必要な設定

### ADMIN Worker `atlasez-admin`

- `EDITORIAL_RELEASE_WEBHOOK_SECRET`: 公開Workers Buildsと共有する署名鍵。
- `CLOUDFLARE_WORKERS_READ_TOKEN`: 固定Accountの`atlasez01` Deployment/Version確認専用。Cloudflare API TokenはWorkers Scripts Readのみとする。

### 公開Worker `atlasez01` のWorkers Builds

- Build variable `EDITORIAL_RELEASE_ENDPOINT`: `https://admin.atlasez.org/api/internal/editorial-release`
- Build secret `EDITORIAL_RELEASE_WEBHOOK_SECRET`: ADMIN Workerと同一の値。

`EDITORIAL_RELEASE_WEBHOOK_SECRET`と`CLOUDFLARE_WORKERS_READ_TOKEN`の値はSecret管理画面で生成・設定し、リポジトリへ保存しません。設定を変更する前に、対象名、権限、影響、復旧方法をPRで確認します。

## 2026-11-21の本番確認

- ADMINの編集画面では`EDITORIAL_RELEASE_WEBHOOK_SECRET`と`CLOUDFLARE_WORKERS_READ_TOKEN`が不足と表示されました。記事の公開状態は個別に同期できています。
- 公開WorkerのWorkers Buildsには`SITE_URL`、`ATLASEZ_REPOSITORY`、`ATLASEZ_DEPLOY_GATE`のみがあり、候補API接続設定がありませんでした。
- Build `748d5312-aee5-4fb3-97d9-1a2eb4896329`は、`EDITORIAL_RELEASE_ENDPOINT`と`EDITORIAL_RELEASE_WEBHOOK_SECRET`が必要という理由で停止しました。候補Versionは配信されていません。
- 停止時の公開Versionは`2fa6da6b`（main commit `f8f97a4375a67e6c6b44a96839d0c50784d928e8`）です。現在の公開main `9eb801ca86eab67f5a6c51212f9ff7d8fc43e46e`との差分に記事Markdownの変更はなく、候補フローのコードと設定が主な差分です。
- 正しいAccountとD1を指定して本番migration一覧を読み取り、`No migrations to apply!`を確認しました。`0139_editorial_release_candidates.sql`の追加適用は不要です。
- ADMIN Workerの現行コードはmainから配信済みで、公開`build-info.json`は`4f444f84919633e6dd5336110bc2d5b61937c8c1`を示していました。

## 適用順と受入確認

1. 本番migration一覧が最新mainと一致し、候補APIに必要なmigrationが適用済みであることを確認する。未適用なら、バックアップ・migrationレビュー・明示した適用手順を先に完了する。
2. PRで設定対象・Account・権限・公開影響・停止方法を確認してから、ADMIN Workerへ上記2つのSecretを登録する。
3. 公開Workers Buildsに上記Endpointと共有Secretを登録する。`atlasez01`のProduction branchは`main`のままにする。
4. `atlasez01`のWorkers Buildsで`main`のBuildを実行し、Build checkout SHA、Build結果、候補APIのD1登録、公開Versionの100%配信を確認する。別経路のWrangler deployや手動Version切替は行わない。
5. `https://atlasez.org/build-info.json`のSHAと対象Buildを照合する。
6. 認証済みADMIN編集画面で公開設定の不足が解消され、記事個別の公開・同期状態を確認できることを確認する。
7. 実際の記事の公開・公開取り消しは、対象記事を指定した運営操作として行う。受入確認のために既存記事を勝手に公開・変更しない。

## 影響と復旧

設定が揃うと、公開Workers BuildsはADMIN Workerへ署名付き候補を登録し、D1への保存成功後に限って`atlasez01`を100%へ切り替えます。これにより、記事公開の承認済みmain変更が公開Workerへ反映され、ADMIN側へ公開履歴が記録されます。

候補登録が失敗した場合、公開Versionは切り替わりません。設定起因の問題が発生したら、まず公開Workers Buildsから`EDITORIAL_RELEASE_ENDPOINT`と共有Secretを外し、次にADMIN Workerから`EDITORIAL_RELEASE_WEBHOOK_SECRET`と`CLOUDFLARE_WORKERS_READ_TOKEN`を外して自動公開を停止します。不要になったAPI TokenはCloudflareで失効します。既存の公開記事と公開Versionはこの設定解除だけでは削除されません。

不正な公開Versionがすでに有効化された場合は、自動公開を停止し、対象SHA・Version・時刻を記録して原因を調査します。Workerの直接Deploy、手動Version promote、route変更で迂回せず、公開コードの修正はレビュー済みmain経由にします。
