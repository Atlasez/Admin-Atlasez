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
- `CLOUDFLARE_WORKERS_READ_TOKEN`: 固定Accountの`atlasez01` Deployment/Version確認専用。Cloudflare API Tokenは`atlasez01`だけに割り当てる`Individual Workers Metadata Read-Only`とする。これはDeployment APIで受け付けられる最小の読み取りロールで、WorkerのソースやSecret値を読む権限はありません。

### 公開Worker `atlasez01` のWorkers Builds

- Workers BuildsのAPI token: `wrangler versions upload` / `wrangler versions deploy`に使うユーザーAPI Tokenを選択する。権限はWorker単位の`Editor`を`atlasez01`だけに付与する。Build設定画面の「Create new token」は全Workerや全Zoneに広い権限を付けるため選ばず、専用Tokenを作成して選択する。
- Build variable `EDITORIAL_RELEASE_ENDPOINT`: `https://admin.atlasez.org/api/internal/editorial-release`
- Build secret `EDITORIAL_RELEASE_WEBHOOK_SECRET`: ADMIN Workerと同一の値。

Build用Token、`EDITORIAL_RELEASE_WEBHOOK_SECRET`、`CLOUDFLARE_WORKERS_READ_TOKEN`は、用途と権限の異なる資格情報です。Build用TokenはWorkers BuildsのAPI token欄だけで選び、他のSecretやBuild variableへコピーしません。Secret値やAPI Token値はGit、PR、Issue、チャットへ記録しません。設定を変更する前に、対象名、権限、影響、復旧方法をPRで確認します。

Cloudflareの[Workers Builds設定](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)はBuild用TokenをWorkerのアップロード・デプロイ認証に使います。[Workersの権限表](https://developers.cloudflare.com/workers/authorization/workers/)では、Version uploadに対象Workerの`Editor`が必要です。Tokenを作る際はCloudflareが提示する広い初期権限をそのまま使わず、`atlasez01`に限定します。[Deployment一覧API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/)は`Individual Workers Metadata Read-Only`を受け付けるため、ADMIN用読み取りTokenに書き込み権限やWorker Content権限は与えません。

## 2026-11-21の本番確認

- ADMINの編集画面では`EDITORIAL_RELEASE_WEBHOOK_SECRET`と`CLOUDFLARE_WORKERS_READ_TOKEN`が不足と表示されました。記事の公開状態は個別に同期できています。
- 公開WorkerのWorkers Buildsには`SITE_URL`、`ATLASEZ_REPOSITORY`、`ATLASEZ_DEPLOY_GATE`のみがあり、候補API接続設定がありませんでした。Build設定に選択されたAPI Tokenも「利用不可」と表示されており、BuildによるVersion upload/deployができません。
- Build `748d5312-aee5-4fb3-97d9-1a2eb4896329`は、`EDITORIAL_RELEASE_ENDPOINT`と`EDITORIAL_RELEASE_WEBHOOK_SECRET`が必要という理由で停止しました。候補Versionは配信されていません。
- 停止時の公開Versionは`2fa6da6b`（main commit `f8f97a4375a67e6c6b44a96839d0c50784d928e8`）です。公開main `9eb801ca86eab67f5a6c51212f9ff7d8fc43e46e`との差分に記事Markdownの変更はなく、候補フローのコードと設定が主な差分です。
- 正しいAccountとD1を指定して本番migration一覧を読み取り、`No migrations to apply!`を確認しました。`0139_editorial_release_candidates.sql`の追加適用は不要です。
- ADMIN WorkerはBuild `806dc462-1d3b-4218-8fa9-2c89d3b07f92`、main commit `bddd1aa56696f84d8eb0ba9370c06abf3137c933`からVersion `8d907c82`を100%配信中で、ADMINの`build-info.json`も同じSHAを示しました。
- 現時点では公開Workerの自動リリース設定が未完了です。実際の記事を公開・取り消ししての受入確認はまだ行っていません。

## 適用順と受入確認

1. 最新mainのコードと本番migration一覧が一致し、候補APIに必要なmigrationが適用済みであることを確認する。未適用なら、バックアップ・migrationレビュー・明示した適用手順を先に完了する。
2. 本番設定変更のレビューを完了してから、Cloudflare上でBuild用ユーザーAPI Tokenを作成し、Worker単位の`Editor`を`atlasez01`だけに付与して、公開WorkerのWorkers Builds API tokenとして選択する。`atlasez01`のProduction branchは`main`、Build/Deploy commandはリポジトリの検証済み設定を維持する。
3. ADMIN Workerへ`EDITORIAL_RELEASE_WEBHOOK_SECRET`と`CLOUDFLARE_WORKERS_READ_TOKEN`を登録する。読み取りTokenは固定Account内の`atlasez01`だけに`Individual Workers Metadata Read-Only`を付与する。
4. 公開Workers Buildsに上記Endpointと共有Secretを登録する。Admin側の署名鍵が先に登録されていることを確かめてからBuild設定を保存する。設定変更はWorker Versionを作る場合があるため、Workers BuildsとDeployment履歴をその都度照合する。
5. `atlasez01`のWorkers Buildsが`main`をcheckoutし、Build checkout SHA、Build結果、候補APIのD1登録、公開Versionの100%配信を記録したことを確認する。別経路のWrangler deployや手動Version切替は行わない。
6. `https://atlasez.org/build-info.json`のSHA、CloudflareのVersion/Deployment、ADMIN D1の公開候補・公開履歴を突き合わせる。
7. 認証済みADMIN編集画面で設定不足が解消され、記事ごとの公開・同期状態が確認できることを確かめる。実記事でend-to-end受入をする場合は、事前に対象を決め、公開/取り消しによる学習サイトへの影響を運営が確認してから行う。確認用に既存記事を勝手に変更しない。

以下を満たすまで実運用開始と判定しません。

- ADMINと公開Workerが想定したmain SHAのコードを配信し、Build/Deployment/Version/`build-info.json`の対応が一致している。
- ADMINの公開候補API・Cloudflare読み取り資格情報が存在し、Workers Buildsに最小権限のBuild用Token・Endpoint・共有署名鍵がある。
- 署名済み候補のD1登録、公開Workerの100%切替、公開履歴記録、記事ごとの状態更新を対象を決めたend-to-end確認で完了している。
- 失敗時に自動公開を止める手順と運営担当が確認済みである。

## 影響と復旧

設定が揃うと、公開Workers BuildsはADMIN Workerへ署名付き候補を登録し、D1への保存成功後に限って`atlasez01`を100%へ切り替えます。これにより、記事公開の承認済みmain変更が公開Workerへ反映され、ADMIN側へ公開履歴が記録されます。Build用Tokenは公開WorkerのVersion upload/deployを可能にするため、対象Workerの`Editor`を超える権限を与えません。

候補登録が失敗した場合、公開Versionは切り替わりません。設定起因の問題が発生したら、まず公開Workers Buildsから`EDITORIAL_RELEASE_ENDPOINT`と共有Secretを外し、次にADMIN Workerから`EDITORIAL_RELEASE_WEBHOOK_SECRET`と`CLOUDFLARE_WORKERS_READ_TOKEN`を外して自動公開を停止します。Build用Tokenが不要ならWorkers Builds設定から選択解除し、Cloudflareで失効します。既存の公開記事と公開Versionはこの設定解除だけでは削除されません。

不正な公開Versionがすでに有効化された場合は、自動公開を停止し、対象SHA・Version・時刻を記録して原因を調査します。Workerの直接Deploy、手動Version promote、route変更で迂回せず、公開コードの修正はレビュー済みmain経由にします。
