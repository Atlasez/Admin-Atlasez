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

- Workers Buildsの`Settings > Builds > API token`: Build時に既存Workerをupload/deployするユーザーtokenです。Cloudflareの現行権限モデルでは、API tokenにもIndividual Workers scopeを指定できます。`Individual Workers Editor`を`atlasez01`だけに付与し、account全体のlegacy `Workers Scripts:Edit`や、KV/R2/Routes/User等を含む自動生成tokenを使わないでください。Worker単位のscopeを選択できない場合は、広い権限へ切り替えず停止して管理者レビューを依頼します。現在選択中のtoken名は`Atlasez ADMIN Builds Deploy`ですが、そのscopeは未確認です。Route変更を行わない既存Workerのdeployに、ZoneのWorkers Routes権限は追加しません。
- Build variable `EDITORIAL_RELEASE_ENDPOINT`: `https://admin.atlasez.org/api/internal/editorial-release`
- Build secret `EDITORIAL_RELEASE_WEBHOOK_SECRET`: ADMIN Workerと同一の値。

Cloudflare Workers Builds REST APIをスクリプトから操作する場合に使う管理API Tokenは、上記Build用トークンとは別です。REST API用Tokenはuser-scopedで`Workers Builds Configuration:Edit`を持ち、Worker tagを取得する場合に限り`Workers Scripts:Read`を追加します。この作業はDashboardで設定するためREST API用Tokenを新設する必要はありません。REST API用TokenをBuildの`API token`欄へ設定しないでください。

Cloudflareの[Workers Builds設定](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)と[Workers Builds REST API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)は、配信用Build tokenとBuild設定管理用API tokenを区別しています。ADMIN用の読み取りtokenはさらに別で、固定Account内の`atlasez01`だけに`Individual Workers Metadata Read-Only`を付与します。Deployment/Version一覧APIはこのroleを受け付け、Worker sourceやsecret値を読む権限はありません。[Workersの権限表](https://developers.cloudflare.com/workers/authorization/workers/)、[Deployment一覧API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/)、[Version一覧API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/list/)を参照してください。legacy `Workers Scripts:Read`はWorkers product scopeのContent Read-Onlyに対応し、source読取を含むため、この候補APIの読み取りtokenには使いません。

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

## Phase II read-only recheck — 2026-11-25 (initial observation)

以下は2026-11-25の読み取り確認です。2026-11-21/22の設定・配信状態は当時の記録として保持し、この節を現在の状態とします。

- ADMIN本番 `atlasez-admin` はBuild-info SHA/ref `97422553003630e0665f37788f561a9179e83fd1` / `main`。CloudflareはVersion `6891b8e9-fbd1-456c-85d3-989c394d3be9`を100%配信しています。
- 公開Worker `atlasez01` のWorkers Buildsには `EDITORIAL_RELEASE_ENDPOINT=https://admin.atlasez.org/api/internal/editorial-release` と暗号化された `EDITORIAL_RELEASE_WEBHOOK_SECRET` が存在します。ADMIN runtimeの同名secretも存在しますが、secret値は読み出さず、現在の値同士の一致は直接比較していません。
- ADMINの `CLOUDFLARE_WORKERS_READ_TOKEN` は未設定です。候補登録前にこのTokenを必須検査する現行コードで再実行すると、`cloudflare_read_token_missing` で停止します。
- 公開Build用Tokenは選択され、過去のBuildがcandidate Versionをuploadできたことを確認しました。ただし当時のtoken scopeは読み取れていません。最新の最小権限要件は、`atlasez01`だけを対象にする`Individual Workers Editor`です。管理者によるscopeのread-backが必要です。
- 公開Build `ef66113c-4666-405a-a404-9e8e9e50391c` / main SHA `9eb801ca86eab67f5a6c51212f9ff7d8fc43e46e` は候補 `a745728d-9677-4b83-b6e8-9943ce283630` をupload後、候補登録APIの `release_article_ambiguous` で失敗しました。候補は0%のままです。公開Workerは旧Version `2fa6da6b` が100%配信中で、公開 `build-info.json` は旧SHA `f8f97a4375a67e6c6b44a96839d0c50784d928e8` を返します。
- 固定D1 `atlasez-reports` / `d5112a62-7ed6-49c8-b6a2-18ee2dbab678` は、mainにある0139までmigration適用済みで、mainのmigration一覧はpendingなしでした。0140はPR #630の新規migrationで、まだ本番には適用していません。候補登録テーブルと公開履歴は空、読み取りのforeign-key checkは違反0件でした。Cloudflare D1の `integrity_check` は `SQLITE_AUTH` で拒否されたため、本番integrity checkは未検証です。
- 公開候補応答はコードしかBuildログへ記録しておらず、失敗した記事パスは得られていません。読めたD1の重複運営原稿パスは数学分野の `new-article.md` 2パス（各5件、4件）でしたが、失敗した候補パスとの一致は確認できず、原因として断定しません。公開mainと同じ記事内容から生成したmanifestは170件（published 164件、draft 6件）です。
- 公開Build失敗時点のEndpoint/署名確認と、現在のCloudflare read-token欠落は時点の異なる観測です。現在の設定で署名鍵が一致するか、Build用tokenに必要最小scopeだけがあるか、Ambiguous応答の対象pathがどれかは、設定更新や再Buildなしには確定できません。
- 公開Buildの安全な切り分け用に、既存公開PR [#149](https://github.com/Atlasez/Atlasez01/pull/149)へ、ambiguous/identity mismatchに限って制御文字除去後300文字のpath診断をBuild errorへ残す小修正を追加しました。candidate失敗時にversion deployを呼ばない回帰テストを含み、最新HEADのCIは実行待ちです。本番Buildは再実行していません。

## Phase II follow-up — 2026-11-25 (latest read-only state)

- 現在のADMIN mainは`97422553003630e0665f37788f561a9179e83fd1`。読み取り確認ではWorker `atlasez-admin`のVersion `6891b8e9-fbd1-456c-85d3-989c394d3be9`が100%配信中で、公開`build-info.json`も同じSHAでした。
- 公開mainは`9eb801ca86eab67f5a6c51212f9ff7d8fc43e46e`ですが、公開Worker `atlasez01`はVersion `2fa6da6b`を100%配信中で、公開`build-info.json`は`f8f97a4375a67e6c6b44a96839d0c50784d928e8`です。Build `ef66113c-4666-405a-a404-9e8e9e50391c`はcandidate Version `a745728d-9677-4b83-b6e8-9943ce283630`をupload後、`release_article_ambiguous`で失敗し、candidateは0%のままです。
- 公開Workers Buildsには`EDITORIAL_RELEASE_ENDPOINT`と暗号化`EDITORIAL_RELEASE_WEBHOOK_SECRET`があり、ADMIN runtimeにも同名secretがあります。secret値のread-backや両側の一致確認はしていません。`CLOUDFLARE_WORKERS_READ_TOKEN`はADMIN runtimeに未設定です。Build用token`Atlasez ADMIN Builds Deploy`は選択されていますが、permission scopeは未確認です。
- 最後の読み取り専用D1確認ではmigrationは0139までで、0140/0141は未適用でした。失敗candidate versionに対応する候補・記事・公開履歴の行はありません。重複identity `ja / mathematics / group-theory / new-article`にはdraft原稿が5件あり、全件`source_article_id`が空です。catalogには対応する`ja` identityがありますが、公開manifest pathの`jpn` identityは別表記です。現行mainの#627修正はcatalog identity fallbackで同一記事を解決しますが、新しい公開を通した受入確認はしていません。
- 旧BuildのHTTP 409はその時点のADMIN実装に対する記録です。現在のADMINコードは候補D1書き込み前にread-tokenを確認し、未設定なら`cloudflare_read_token_missing`で停止します。したがって、古い失敗Buildの再試行ではなく、承認済みの現行main Build経路で再検証する必要があります。
- 公開側PR [#149](https://github.com/Atlasez/Atlasez01/pull/149)のHEADは`4633f07815c36ce434be63c153b5be33f633a7d2`、CI [45543133197](https://github.com/Atlasez/Atlasez01/actions/runs/45543133197)は成功していますが、独立レビュー待ちです。PR #630/0140、#545/0141、#562の統合候補もレビュー・本番適用待ちです。
- 外部変更の承認範囲: ADMIN read-tokenは`Individual Workers Metadata Read-Only`を`atlasez01`だけに付ける。Workers Builds用tokenは`Individual Workers Editor`を`atlasez01`だけに付ける。後者は配信write権限なので、read-tokenとは別の権限・secretとして扱う。両側のWebhook secretは値を露出せず一致を確認し、scopeを確認できない間は公開Buildを実行しません。
- この節のread-only確認ではCloudflare secret/設定、D1、Worker配信を変更していません。候補Versionのpromote、手動upload、Production route/cache変更も行っていません。

### 承認後の順序

1. Cloudflare管理者が固定Account `812021e62fa20465950b61be55dfe064`内の `atlasez01` だけに `Individual Workers Metadata Read-Only` を付与した `CLOUDFLARE_WORKERS_READ_TOKEN` を作り、ADMIN Worker secretへ登録する。Worker source、secret読取、配信write権限は付与しない。
2. Workers Builds管理者がBuild Endpointと暗号化Secretの登録状態を再確認し、公開Build用Tokenを同一Accountの必要scopeに限定してread-backする。Secret値は表示・記録せず、必要なら専用の安全な変更手順で両Workerを一致させる。
3. 以前の失敗Build pathを明らかにするには、Cloudflare BuildログとADMIN Worker診断ログを承認済みの読み取り経路で照合する。次の候補Buildを実行する前に、D1管理者が対象pathと候補article IDをread-onlyで照合する。候補が複数なら推測して選ばず、既存のsource ID/版履歴を保全するレビュー済みdata修正計画を用意する。
4. PR #149の最新CIとreview、PR #630/#545のCIとreview、mainのWorkers Builds配信経路を確認する。PR #630/545の必要migrationを本番適用する場合は、独立したD1 backup・migration承認・対象SHA確認・適用後read-only確認を別途先に完了する。
5. これらの確認と明示された本番設定変更承認が揃った後だけ、公開Workers Buildsからmain候補を一度実行し、checkout SHA、候補登録、Worker `atlasez01`のVersion/100%配信、公開build-info、ADMIN D1のcandidate/history、認証済み主要画面を照合する。異常時は停止し、rollback/promote/cache purge/route変更を推測で実行しない。

本再確認ではCloudflare設定・D1・Worker配信を変更していません。

## 適用順と受入確認

1. 最新mainのコードと本番migration一覧が一致し、候補APIに必要なmigrationが適用済みであることを確認する。未適用なら、バックアップ・migrationレビュー・明示した適用手順を先に完了する。
2. このPRで本番設定の権限範囲と影響をレビューする。CloudflareのBuild用ユーザーtokenには`Individual Workers Editor`を`atlasez01`だけに割り当て、Workers Builds `Settings > Builds > API token`からread-backします。初期自動生成のAccount/KV/R2/Routes/User scopeは残しません。Individual Worker scopeを利用できない場合は、account-wide `Workers Scripts:Edit`へ切り替えず停止して追加承認を取ります。`atlasez01`のProduction branchは`main`、Build/Deploy commandはリポジトリの検証済み設定を維持します。
3. ADMIN Workerの`EDITORIAL_RELEASE_WEBHOOK_SECRET`と、`CLOUDFLARE_WORKERS_READ_TOKEN`を登録する。読み取りTokenは固定Account内の`atlasez01`だけに`Individual Workers Metadata Read-Only`を付与する。Account API Tokenを作成できる権限がない場合は、アカウント管理者にこのscopeのTokenを作成してもらう。
4. 公開Workers Buildsに上記Endpointと共有Secretを登録する。Admin側の署名鍵が先に登録されていることを確かめてからBuild設定を保存する。設定変更はWorker Versionを作る場合があるため、Workers BuildsとDeployment履歴をその都度照合する。
5. `atlasez01`のWorkers Buildsが`main`をcheckoutし、Build checkout SHA、Build結果、候補APIのD1登録、公開Versionの100%配信を記録したことを確認する。別経路のWrangler deployや手動Version切替は行わない。
6. `https://atlasez.org/build-info.json`のSHA、CloudflareのVersion/Deployment、ADMIN D1の公開候補・公開履歴を突き合わせる。
7. 認証済みADMIN編集画面で設定不足が解消され、記事ごとの公開・同期状態が確認できることを確かめる。実記事でend-to-end受入をする場合は、事前に対象を決め、公開/取り消しによる学習サイトへの影響を運営が確認してから行う。確認用に既存記事を勝手に変更しない。

以下を満たすまで実運用開始と判定しません。

- ADMINと公開Workerが想定したmain SHAのコードを配信し、Build/Deployment/Version/`build-info.json`の対応が一致している。
- ADMINの公開候補API・`atlasez01`限定のMetadata Read-Only tokenが存在し、Workers Buildsに`atlasez01`限定のIndividual Workers Editor token・Endpoint・共有署名鍵がある。REST API経由で設定を管理する場合は、別途user-scopedの`Workers Builds Configuration:Edit` tokenを使い、Build用tokenと混同しない。
- 署名済み候補のD1登録、公開Workerの100%切替、公開履歴記録、記事ごとの状態更新を対象を決めたend-to-end確認で完了している。
- 失敗時に自動公開を止める手順と運営担当が確認済みである。

## 影響と復旧

設定が揃うと、公開Workers BuildsはADMIN Workerへ署名付き候補を登録し、D1への保存成功後に限って`atlasez01`を100%へ切り替えます。これにより、記事公開の承認済みmain変更が公開Workerへ反映され、ADMIN側へ公開履歴が記録されます。Build tokenは`atlasez01`だけを更新・配信できるIndividual Workers Editorに限定します。不要になった場合や設定不備があった場合はWorkers Buildsから選択解除し、Cloudflareでtokenを失効します。

候補登録が失敗した場合、公開Versionは切り替わりません。設定起因の問題が発生したら、まず公開Workers Buildsから`EDITORIAL_RELEASE_ENDPOINT`と共有Secretを外し、次にADMIN Workerから`EDITORIAL_RELEASE_WEBHOOK_SECRET`と`CLOUDFLARE_WORKERS_READ_TOKEN`を外して自動公開を停止します。Build用Tokenが不要ならWorkers Builds設定から選択解除し、Cloudflareで失効します。既存の公開記事と公開Versionはこの設定解除だけでは削除されません。

不正な公開Versionがすでに有効化された場合は、自動公開を停止し、対象SHA・Version・時刻を記録して原因を調査します。Workerの直接Deploy、手動Version promote、route変更で迂回せず、公開コードの修正はレビュー済みmain経由にします。

## Phase II latest evidence and approval gates — 2026-11-25

- Admin main is `97422553003630e0665f37788f561a9179e83fd1`; public main is `9eb801ca86eab67f5a6c51212f9ff7d8fc43e46e`. Read-only checks show `atlasez-admin` Version `6891b8e9-fbd1-456c-85d3-989c394d3be9` at 100% and Admin `build-info.json` matching main. Public Worker `atlasez01` remains Version `2fa6da6b-0910-46cb-850f-385f1928b055` at 100%; public `build-info.json` still reports `f8f97a4375a67e6c6b44a96839d0c50784d928e8`, behind public main. The earlier candidate Version `a745728d-9677-4b83-b6e8-9943ce283630` stayed at 0% after `release_article_ambiguous`.
- Read-only secret-name inspection found ADMIN `EDITORIAL_RELEASE_WEBHOOK_SECRET` and no ADMIN `CLOUDFLARE_WORKERS_READ_TOKEN`. Public Workers Builds has the endpoint and an encrypted webhook secret according to the latest recorded read-only observation; the secret value match and current Build-token scope have not been verified. Never expose or compare secret values in logs.
- PR #630 exact head `06133eb5348a49966b86415047f9a956ce7d358d` passed full required CI [run 45566396436](https://github.com/Atlasez/Admin-Atlasez/actions/runs/45566396436). Its editorial reconciliation failures now have structured, redacted events with a correlation ID and failure classification. PR #630 has no formal independent approval yet; it remains unmerged.
- PR #149 exact public head `9b7d4a8efd525a500cae3c73c5b0d9576c633c25` passed unit, build, Playwright/axe and workflow checks [run 45567747930](https://github.com/Atlasez/Atlasez01/actions/runs/45567747930), but its Lighthouse assertion output still reports `label-content-name-mismatch` (score 0 against a 0.9 minimum) plus image-delivery and render-blocking warnings. The workflow masks this assertion exit with `|| true`; a green job is not a Lighthouse quality PASS. The earlier SEO 0.69 was caused by CI's missing `SITE_URL` and noindex preview. The earlier Atlas Performance 0.87 was traced to eager Cytoscape loading; the current Admin mirror run [45567738179](https://github.com/Atlasez/Admin-Atlasez/actions/runs/45567738179) measured all Lighthouse categories at 1.00 on both sampled URLs once each after the lazy-load fix. No thresholds were lowered; repeat runs are needed to establish stability.
- Intake migration sequence: #545's 0141, #549's isolated staging harness and #551's retention hard-off are integrated into #562. Those source PRs are closed as superseded. PR #562 head `bcd8258645aabd5efca9d43d90e8f70d23373a2f` passed exact-head full CI [run 45568878812](https://github.com/Atlasez/Admin-Atlasez/actions/runs/45568878812), but requires independent review. Its CI also still reports SEO 0.69 because its base does not include #633's `SITE_URL` correction.
- An isolated combined migration drill applied the full migration set through 0140 and 0141, preserved synthetic application/email rows, confirmed old-0141 Worker insert compatibility, restored the SQLite snapshot, and returned `integrity_check=ok` with zero foreign-key violations. A local Wrangler `--local` drill then failed a synthetic 0142: all 131 prior migrations remained applied, while the failed migration had no ledger entry and left no partial table. Production D1 backup/restore, integrity check and migration apply remain NOT TESTED; the recorded production D1 read was at 0139, and D1 `integrity_check` was denied with `SQLITE_AUTH`.

### Approval and execution sequence

1. A Cloudflare administrator configures `CLOUDFLARE_WORKERS_READ_TOKEN` for the Admin Worker with `Individual Workers Metadata Read-Only`, scoped only to `atlasez01`. The Workers Builds deploy token must separately be `Individual Workers Editor`, scoped only to `atlasez01`. Read back both scopes; do not use account-wide or guessed permissions.
2. Verify the public Workers Builds endpoint and encrypted webhook secret configuration. Confirm the signing secret matches the ADMIN Worker without printing either value. If replacing a secret, approve and record the change and the version impact first.
3. The D1 owner takes and verifies an isolated backup/restore plan, confirms the production ledger and approves 0140. Apply 0140 separately and read back the ledger/schema before merging PR #630, since merging on main can trigger Workers Builds.
4. Repeat the D1 backup/approval for 0141. Apply 0141 and verify its ledger before merging PR #562. Do not run migrations from normal Worker builds.
5. Only after formal reviews, CI, settings and migrations pass, trigger the normal main-based Workers Builds path. Compare checkout SHA, Worker name, Version and 100% allocation, public `build-info.json`, D1 candidate/history, then perform the authenticated ADMIN and public-page acceptance. Stop on any mismatch or failed check.

If configuration or candidate registration fails, remove the public Build endpoint/secret, remove the two Admin Worker tokens, and disable the release path. Leave the currently active public Version untouched unless a reviewed incident plan explicitly authorizes recovery. No secret, Cloudflare setting, D1, route, or Worker deployment was changed during this Phase II work. Production Ready and Limited Intake GO remain withheld.
