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

候補APIはD1へ候補を書き込む前にこのTokenで現在のDeployment APIを照会します。Tokenが未設定・無効・権限不足、またはCloudflare APIが利用できない場合は候補APIを失敗させ、Workers Builds側の`wrangler versions deploy`へ進ませません。未設定のまま公開だけが切り替わる状態を作らないため、再試行前にADMIN Workerの設定を確認してください。

### 公開Worker `atlasez01` のWorkers Builds

- Workers Buildsの`Settings > Builds > API token`: ここで選ぶのはBuild実行時にWorkerをアップロード・配信するためのBuild用トークン。Cloudflareは現在user tokenをサポートし、`Create new token`の初期設定はAccount Settings read、Workers Scripts edit、KV edit、R2 edit、全ZoneのWorkers Routes edit、User Details read、Memberships readを含む。初期権限のまま使わず、My Profile > API Tokensで固定Accountの`Workers Scripts:Edit`だけに絞る。これはユーザーが承認した全Worker向け権限であり、`atlasez01`に限定されず同じAccount内の全Workerを更新・配信できる。`atlasez01`のWorkers Buildsにだけ割り当てる。初回デプロイが追加権限を要求した場合は自動でscopeを追加せず、必要scopeとWorker設定を再確認する。
- Build variable `EDITORIAL_RELEASE_ENDPOINT`: `https://admin.atlasez.org/api/internal/editorial-release`
- Build secret `EDITORIAL_RELEASE_WEBHOOK_SECRET`: ADMIN Workerと同一の値。

Cloudflare Workers Builds REST APIをスクリプトから操作する場合に使う管理API Tokenは、上記Build用トークンとは別です。REST API用Tokenはuser-scopedで`Workers Builds Configuration:Edit`を持ち、Worker tagを取得する場合に限り`Workers Scripts:Read`を追加します。この作業はDashboardで設定するためREST API用Tokenを新設する必要はありません。REST API用TokenをBuildの`API token`欄へ設定しないでください。

Cloudflareの[Workers Builds設定](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)と[Workers Builds REST API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)は、デプロイ用トークンとBuild設定管理用API Tokenを区別しています。ADMIN用の読み取りTokenはさらに別で、固定Account内の`atlasez01`だけに`Individual Workers Metadata Read-Only`を付与します。これはDeployment APIの読み取りに使い、WorkerのソースやSecret値を読む権限は与えません。[Workersの権限表](https://developers.cloudflare.com/workers/authorization/workers/)と[Deployment一覧API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/)を参照してください。

## 2026-11-21の本番確認

- ADMINの編集画面では`EDITORIAL_RELEASE_WEBHOOK_SECRET`と`CLOUDFLARE_WORKERS_READ_TOKEN`が不足と表示されました。記事一覧と記事ごとの公開状態は読み込めていますが、Cloudflare候補登録・公開履歴照合の資格情報が未設定です。
- 公開WorkerのWorkers Buildsには`SITE_URL`、`ATLASEZ_REPOSITORY`、`ATLASEZ_DEPLOY_GATE`のみがあり、候補API接続設定がありませんでした。Build設定に選択されたデプロイ用API Tokenも「利用不可」と表示されており、BuildによるVersion upload/deployができません。
- Build `748d5312-aee5-4fb3-97d9-1a2eb4896329`は、`EDITORIAL_RELEASE_ENDPOINT`と`EDITORIAL_RELEASE_WEBHOOK_SECRET`が必要という理由で停止しました。候補Versionは配信されていません。
- 停止時の公開Versionは`2fa6da6b`（main commit `f8f97a4375a67e6c6b44a96839d0c50784d928e8`）です。公開main `9eb801ca86eab67f5a6c51212f9ff7d8fc43e46e`との差分に記事Markdownの変更はなく、候補フローのコードと設定が主な差分です。
- 正しいAccountとD1を指定して本番migration一覧を読み取り、`No migrations to apply!`を確認しました。`0139_editorial_release_candidates.sql`の追加適用は不要です。
- 最新の読み取り確認ではADMINの`build-info.json`がmain commit `71baddae5550dfa1d6571b9887f0e091c2c60db9`を返し、CloudflareのADMIN Build/Versionは成功・100%配信でした。公開サイトの`build-info.json`は`f8f97a4375a67e6c6b44a96839d0c50784d928e8`のままです。
- 現時点では公開Workerの自動リリース設定が未完了です。実際の記事を公開・取り消ししての受入確認はまだ行っていません。

## 2026-11-22の追加確認

- ADMIN修正PR #627は`main`へマージされ、ADMIN Worker `atlasez-admin`のBuildはmain SHA `2f3c2ec7186e14387a401e1b5bb7d9a4d9549d76`で成功・100%配信されています。`https://admin.atlasez.org/build-info.json`も同じSHAを返します。
- 公開Worker `atlasez01`の最新Build `ef66113c-4666-405a-a404-9e8e9e50391c`（main SHA `9eb801ca86eab67f5a6c51212f9ff7d8fc43e46e`）は候補Version `a745728d`を作成しましたが、候補登録時の`release_article_ambiguous`で失敗しました。Cloudflare Deploymentsでは候補は0%のまま、既存Version `2fa6da6b`が100%配信中です。`https://atlasez.org/build-info.json`も既存main SHA `f8f97a4375a67e6c6b44a96839d0c50784d928e8`を返しており、公開配信は変わっていません。
- `atlasez-admin`には`CLOUDFLARE_WORKERS_READ_TOKEN`が未設定です。PR #627のパス解決修正だけで公開Buildを再試行すると、履歴照合に失敗する可能性があるため、読み取り資格情報を候補登録前に検証するガードを追加しています。このガードが本番反映されるまでは公開Buildを再試行しません。
- 公開候補Webhookは`release_article_ambiguous`を返すところまで到達しており、Endpointと署名鍵は候補API通信に使われています。残る設定ブロッカーは`atlasez01`限定のMetadata Read-Only Tokenです。読み取りTokenがCloudflareで作成・設定されるまで、記事の公開・取り消し受入試験は行いません。

## 適用順と受入確認

1. 最新mainのコードと本番migration一覧が一致し、候補APIに必要なmigrationが適用済みであることを確認する。未適用なら、バックアップ・migrationレビュー・明示した適用手順を先に完了する。
2. このPRで本番設定の権限範囲と影響をレビューする。CloudflareでBuild用ユーザーTokenを作成または選択し、My Profile > API Tokensで固定Accountの`Workers Scripts:Edit`だけにscopeを絞ってから、`atlasez01`のWorkers Builds `Settings > Builds > API token`へ割り当てる。初期設定のKV・R2・Routes・Account・User scopeを残さない。これはユーザーが承認した全Worker向け権限である。`atlasez01`のProduction branchは`main`、Build/Deploy commandはリポジトリの検証済み設定を維持する。
3. ADMIN Workerの`EDITORIAL_RELEASE_WEBHOOK_SECRET`と、`CLOUDFLARE_WORKERS_READ_TOKEN`を登録する。読み取りTokenは固定Account内の`atlasez01`だけに`Individual Workers Metadata Read-Only`を付与する。Account API Tokenを作成できる権限がない場合は、アカウント管理者にこのscopeのTokenを作成してもらう。
4. 公開Workers Buildsに上記Endpointと共有Secretを登録する。Admin側の署名鍵が先に登録されていることを確かめてからBuild設定を保存する。設定変更はWorker Versionを作る場合があるため、Workers BuildsとDeployment履歴をその都度照合する。
5. `atlasez01`のWorkers Buildsが`main`をcheckoutし、Build checkout SHA、Build結果、候補APIのD1登録、公開Versionの100%配信を記録したことを確認する。別経路のWrangler deployや手動Version切替は行わない。
6. `https://atlasez.org/build-info.json`のSHA、CloudflareのVersion/Deployment、ADMIN D1の公開候補・公開履歴を突き合わせる。
7. 認証済みADMIN編集画面で設定不足が解消され、記事ごとの公開・同期状態が確認できることを確かめる。実記事でend-to-end受入をする場合は、事前に対象を決め、公開/取り消しによる学習サイトへの影響を運営が確認してから行う。確認用に既存記事を勝手に変更しない。

以下を満たすまで実運用開始と判定しません。

- ADMINと公開Workerが想定したmain SHAのコードを配信し、Build/Deployment/Version/`build-info.json`の対応が一致している。
- ADMINの公開候補API・Worker限定のCloudflare読み取り資格情報が存在し、Workers Buildsにユーザーが承認した全Worker向けScript編集Token・Endpoint・共有署名鍵がある。REST API経由で設定を管理する場合は、別途user-scopedの`Workers Builds Configuration:Edit` Tokenを使い、Build用トークンと混同しない。
- 署名済み候補のD1登録、公開Workerの100%切替、公開履歴記録、記事ごとの状態更新を対象を決めたend-to-end確認で完了している。
- 失敗時に自動公開を止める手順と運営担当が確認済みである。

## 影響と復旧

設定が揃うと、公開Workers BuildsはADMIN Workerへ署名付き候補を登録し、D1への保存成功後に限って`atlasez01`を100%へ切り替えます。これにより、記事公開の承認済みmain変更が公開Workerへ反映され、ADMIN側へ公開履歴が記録されます。Build用Tokenはユーザー承認の範囲どおり固定Account内の全既存WorkerへScript編集・配信権限を持ちます。不要になった場合や設定不備があった場合はWorkers Buildsから選択解除し、CloudflareでTokenを失効します。

候補登録が失敗した場合、公開Versionは切り替わりません。設定起因の問題が発生したら、まず公開Workers Buildsから`EDITORIAL_RELEASE_ENDPOINT`と共有Secretを外し、次にADMIN Workerから`EDITORIAL_RELEASE_WEBHOOK_SECRET`と`CLOUDFLARE_WORKERS_READ_TOKEN`を外して自動公開を停止します。Build用Tokenが不要ならWorkers Builds設定から選択解除し、Cloudflareで失効します。既存の公開記事と公開Versionはこの設定解除だけでは削除されません。

不正な公開Versionがすでに有効化された場合は、自動公開を停止し、対象SHA・Version・時刻を記録して原因を調査します。Workerの直接Deploy、手動Version promote、route変更で迂回せず、公開コードの修正はレビュー済みmain経由にします。
