# ADMIN staging Build設定変更計画・実施記録

更新日: 2026-11-28

## 実施結果

Cloudflare staging Worker `atlasez-admin-release-staging` は、GitHub branch `codex/staging-intake-649` のcommit `af2c2ae17aa14c6943e60414bcc31db738052259` からWorkers BuildsでBuild/Deploy済み。

- Build run: `05248d8c-ee60-4afc-a813-807cf8fd7bd2`
- Build command / Deploy command: success
- staging Worker Version表示: `f07af8b2`、traffic 100%、Ready
- staging origin `/build-info.json` のcommit: Build対象SHAと一致
- staging source SHAのCI: run [46134265088](https://github.com/Atlasez/Admin-Atlasez/actions/runs/46134265088) success。以降のPR head docs-only更新はmerge前に最新CIをread-backする
- release staging専用D1 bindingをread-back確認。production D1は接続していない。
- `ATLASEZ_STAGING_MODE=true`、email/Discord delivery disabled、Cronなし、Google login allowlist未設定をread-back確認。
- production Worker、Route、D1、secretsは変更していない。

Build run `6c476de7-d452-4dc3-8e82-688d7da5391f` はproduction比較用Build環境変数が未設定で停止した。run `d1f365bc-cc59-403a-84f8-f15680bfc381` はrelease staging D1をlegacy staging D1比較値へ誤設定したため、隔離preflightが停止した。D1一覧をread-onlyで照合して比較値を修正後、run `05248d8c-ee60-4afc-a813-807cf8fd7bd2` がpreflight、Build、Deployとも成功した。比較用D1 IDなどの値はCloudflare Build環境にだけ置き、この文書、repository、PR、Issueには記録しない。

## 前回Build候補とCloudflare設定

- 対象Worker: `atlasez-admin-release-staging`
- Repository: `Atlasez/Admin-Atlasez`
- Production branch: `codex/staging-intake-649`
- candidate SHA: `af2c2ae17aa14c6943e60414bcc31db738052259`
- コード候補: `e9b40d3f284577a0af652e9d180ed2fcc4d4594b`
- base main: `a902f54059ec032fe49b6aea2464e8e5d6c5198a`
- `99b8139dd9585840fc4f555789de1a5a4bc75217` からの差分はdocs-only。候補SHA CIとCloudflare Buildが成功した。

Build command:

```bash
test "$(git rev-parse HEAD)" = 'af2c2ae17aa14c6943e60414bcc31db738052259' && printf '%s' "$RELEASE_CONFIG_JSON" > wrangler.admin.staging.compat.jsonc && npm ci && npm run verify:admin-staging-config:compat && ATLASEZ_BUILD_TARGET=admin SITE_URL=https://atlasez-admin-release-staging.atlasez-adm.workers.dev BASE_PATH=/ npm run build && npm run verify:build-info
```

Deploy command:

```bash
test "$(git rev-parse HEAD)" = 'af2c2ae17aa14c6943e60414bcc31db738052259' && npm run verify:admin-staging-config:compat && npx wrangler deploy --config wrangler.admin.staging.compat.jsonc --keep-vars
```

Build環境には比較専用の次の変数名を登録した。各値はCloudflare外へ記録しない。

- `ATLASEZ_PRODUCTION_ADMIN_ORIGIN`
- `ATLASEZ_PRODUCTION_D1_NAME`
- `ATLASEZ_PRODUCTION_D1_ID`
- `ATLASEZ_PRODUCTION_DISCORD_GUILD_ID`
- `ATLASEZ_PRODUCTION_DISCORD_CLIENT_ID`
- `ATLASEZ_EXISTING_STAGING_D1_ID`

これらはBuild時の分離preflight用で、Worker runtime secrets/varsやstaging configには追加していない。OAuth allowlistも設定していない。

## Read-backと次の作業

Workers Builds runのbranch/commit、Build/Deploy結果、Worker Version、100% traffic、staging `build-info.json` SHA、D1 binding、email/Discord disabled、Cronなしを照合した。stagingポータルの未認証アクセスはGoogle OAuth account chooserへ遷移したが、synthetic test accountがまだ指定されていないため、アカウントを選ばず終了した。role別の認証済み受入は未完了。

次のBuildでは、Build/Deploy SHA guardとstaging branch refを、その時点でCI success済みの完全なSHAへ一致させてからWorkers Buildsを起動する。Build起動時にD1 migrationを自動適用しない。production Worker/D1への配信は、staging受入と運営GOの記録が揃うまで行わない。

## 復旧

予期しないcheckout SHA、Worker、Version、binding、認証動作を確認した場合はstagingで停止し、productionへ切り替えない。Build設定とactive staging Versionを読み取り専用で照合する。別のVersionへのrollback/promote、Route変更、productionへの手動deployは推測で実行しない。

過去の安定設定へ戻す必要がある場合は、次の設定を復旧候補としてread-backし、意図しない変更を含まないことを確認する。

- Production branch: `codex/release-staging-647`
- Build command SHA guard: `a4dcfc799c0e0ef5b2fb14f96da21e39dd9ad718`
- Deploy command SHA guard: `a4dcfc799c0e0ef5b2fb14f96da21e39dd9ad718`

復旧後はBuild設定、active staging Version、Worker/D1 bindingをread-onlyで照合する。0144は追加型schemaのため逆migrationで削除せず、必要な修正はstaging上のforward-fixとして扱う。本番Worker/D1はこの復旧手順の対象外。

## 2026-11-28 main追従後の本番確認

- GitHub main `76e5fad87e01f6894d3917bec6bf494e99ebe888` のproduction Workers Build `76517dd7-8166-41d7-81b9-bf5f0dbd46e2` はBuild/Deployとも成功。
- Worker `atlasez-admin` のVersion `902fd2f0-e906-4800-b353-13afb355e969` は100% traffic、Ready。公開 `https://admin.atlasez.org/build-info.json` のcommitはmain SHAと一致。
- 認証済みChromeでポータル、タスク、カレンダー、プロフィール、`/admin/manage/?project=atlas`、記事一覧、記事削除申請を確認し、各画面が表示されることを確認した。
- PR #649 runtime候補 `f0f4ee753c305c59f4c5efcdced7d4d14d7821d3` はmainを取り込み、GitHub CI run [46139876980](https://github.com/Atlasez/Admin-Atlesez/actions/runs/46139876980) が全job success。PR docs head `6e0adc4dab42cb60eafa623aa277947ac6697080` のCI run [46140848291](https://github.com/Atlasez/Admin-Atlesez/actions/runs/46140848291) も全job success。この後の受入記録更新はdocs-onlyで、新head CIはmerge前に確認します。
- staging専用Workerはruntime候補 `f0f4ee753c305c59f4c5efcdced7d4d14d7821d3` / Version `dbf58dc9` を100%配信中。staging専用D1のmigration ledgerはread-onlyで確認し、未適用migrationなし。run、build-info、runtime isolationの記録は次節にあります。

## 2026-11-28 runtime候補staging Build結果

PR #649の最新head CI success、設定値、影響、復旧方法を確認した後、Build/Deploy SHA guardをruntime候補 `f0f4ee753c305c59f4c5efcdced7d4d14d7821d3` に固定し、staging専用ref `codex/staging-intake-649` をfast-forwardしました。

- Workers Build [#78471160](https://dash.cloudflare.com/812021e62fa20465950b61be55dfe064/workers/services/view/atlasez-admin-release-staging/production/builds/78471160-5e0e-4b93-8f9f-8a7fc111daaa) はcheckout SHAとガードが一致し、Initializing、Cloning、Installing、Building、Deployingの全段階が成功しました。
- 対象Worker `atlasez-admin-release-staging` の新Version `dbf58dc9` は100% traffic、Ready。GitHub branch `codex/staging-intake-649` のruntime候補 `f0f4ee753c305c59f4c5efcdced7d4d14d7821d3` とDeployment recordをread-backしました。
- 公開 [staging build-info.json](https://atlasez-admin-release-staging.atlasez-adm.workers.dev/build-info.json) のcommitは同SHA、targetは `admin`、`ref` は `unknown` です。branchはCloudflare Build recordで同一性を確認済みです。
- staging専用D1 binding `atlasez-admin-release-staging-reports` をread-backし、Buildではmigrationを実行していません。staging D1 migration ledgerは事前確認で未適用なしです。
- 再read-backでstaging mode有効、email/Discord delivery disabled、Cronなし、Google login allowlist未設定を確認しました。production Worker/Route/D1/secretsには変更なし。

影響範囲はstaging Workerと専用D1だけです。production Worker/Route/D1、production secrets、email/Discord delivery、Cron、migrationは変更していません。失敗した場合は旧active staging Version `f07af8b2` が配信状態に残ることを事前の影響評価に記録していました。今回は新VersionがReadyになり100%配信中です。復旧候補は上記「復旧」に記録した旧staging branch/guardです。推測によるrollback/promoteやproductionへの手動deployは行いません。

今回使ったBuild command:

```bash
test "$(git rev-parse HEAD)" = 'f0f4ee753c305c59f4c5efcdced7d4d14d7821d3' && printf '%s' "$RELEASE_CONFIG_JSON" > wrangler.admin.staging.compat.jsonc && npm ci && npm run verify:admin-staging-config:compat && ATLASEZ_BUILD_TARGET=admin SITE_URL=https://atlasez-admin-release-staging.atlasez-adm.workers.dev BASE_PATH=/ npm run build && npm run verify:build-info
```

今回使ったDeploy command:

```bash
test "$(git rev-parse HEAD)" = 'f0f4ee753c305c59f4c5efcdced7d4d14d7821d3' && npm run verify:admin-staging-config:compat && npx wrangler deploy --config wrangler.admin.staging.compat.jsonc --keep-vars
```

## 応募受付停止switch候補のstaging設定計画（実施前記録）

staging対象のruntime candidateは `f02421d4cadacc0f8043950e276de368558d86d8`。以下はBuild/Deploy前のstaging専用設定計画と、実行時に使用したSHA guardである。設定変更と配信の実績は後続の「runtime候補staging Build結果」へ記録する。Build/Deploy commandのほかの部分は変更しない。

Build commandのSHA guard:

```bash
test "$(git rev-parse HEAD)" = 'f02421d4cadacc0f8043950e276de368558d86d8' && printf '%s' "$RELEASE_CONFIG_JSON" > wrangler.admin.staging.compat.jsonc && npm ci && npm run verify:admin-staging-config:compat && ATLASEZ_BUILD_TARGET=admin SITE_URL=https://atlasez-admin-release-staging.atlasez-adm.workers.dev BASE_PATH=/ npm run build && npm run verify:build-info
```

Deploy commandのSHA guard:

```bash
test "$(git rev-parse HEAD)" = 'f02421d4cadacc0f8043950e276de368558d86d8' && npm run verify:admin-staging-config:compat && npx wrangler deploy --config wrangler.admin.staging.compat.jsonc --keep-vars
```

影響範囲はstaging Worker `atlasez-admin-release-staging`と専用D1だけ。migration、Cron、メール、Discord、本番Worker/Route/D1/secretsは変更しない。Build/Deploy前にGitHub CI success、Build設定のAccount/Worker/repository、専用D1 binding、production比較用Build variablesをread-backする。失敗・SHA不一致時はDeployせず、原因とrunを記録する。既存のactive staging Versionはread-onlyで照合し、推測によるrollback/promoteは行わない。

今回のruntime variable `ADMIN_APPLICATION_INTAKE_MODE`はWrangler設定へ追加しない。Dashboard runtime変数の `open → paused → open` を受入する際は、staging Workerだけに適用し、変数設定後のWorker Version、3書込経路の503、DB未更新、応募画面案内を確認する。

## 2026-11-28 runtime候補staging Build結果

最新PR head `bc2b55761f298b67ae65f1ae013182990aeba5c6` とruntime candidate `f02421d4cadacc0f8043950e276de368558d86d8` のGitHub CI success後、release staging専用Build guardをcandidate SHAへ合わせ、staging専用refをfast-forwardしてWorkers Buildsを実行した。

- Workers Build [`abebebec-31d3-49ba-96d4-5e6595f6c68f`](https://dash.cloudflare.com/812021e62fa20465950b61be55dfe064/workers/services/view/atlasez-admin-release-staging/production/builds/abebebec-31d3-49ba-96d4-5e6595f6c68f) はbranch `codex/staging-intake-649`、checkout/guard SHA `f02421d4cadacc0f8043950e276de368558d86d8`。Initializing、Cloning、Installing、Building、Deployingが成功。
- Build logの `verify:build-info` は同SHAを確認。公開 [staging build-info.json](https://atlasez-admin-release-staging.atlasez-adm.workers.dev/build-info.json) はcommit `f02421d4cadacc0f8043950e276de368558d86d8`、target `admin`、builtAt `2026-11-28T13:24:12.476Z`。refは `unknown` のため、branchはBuild recordで確認。
- Worker `atlasez-admin-release-staging` Version `56afd06e-5679-4cee-98f9-6330ac0504fd` は100%配信、Ready。専用D1 bindingは維持され、Build中にmigrationは実行されていない。
- この変更はstaging Worker/D1だけに適用。production Worker/Route/D1/secrets、Cron、メール、Discordは変更していない。stagingの認証allowlistは未設定で、pause switch runtime演習、role別OAuth受入は未完了。

次の受入操作はDashboard上のruntime variable `ADMIN_APPLICATION_INTAKE_MODE` をstaging Workerに設定する。値を切り替えるたびWorker Versionが変わるため、`open`、`paused`、`open`各段階のVersionを記録し、3書込経路の503/DB不更新と画面状態を同じ合成データの隔離状態で確認する。role別API確認ではmemberとmanager/reviewerの別々の合成Google identityを使う。
