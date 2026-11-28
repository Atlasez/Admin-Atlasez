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
- PR #649 runtime候補 `f0f4ee753c305c59f4c5efcdced7d4d14d7821d3` はmainを取り込み、GitHub CI run [46139876980](https://github.com/Atlasez/Admin-Atlesez/actions/runs/46139876980) が全job success。今回の記録更新はdocs-onlyで、最新head CIは更新後に確認する。
- stagingは前回のBuild SHA `af2c2ae17aa14c6943e60414bcc31db738052259` / Version `f07af8b2` を100%配信中。staging専用D1のmigration ledgerはread-onlyで確認し、未適用migrationなし。新しいruntime候補はまだBuildしていない。

## 次回staging Buildの設定計画

この設定変更はPR #649で計画・復旧方法を記録し、PRの最新head CIが成功した後に行う。Build/Deploy SHA guardをCI成功済みruntime候補 `f0f4ee753c305c59f4c5efcdced7d4d14d7821d3` に固定し、staging専用ref `codex/staging-intake-649` を同SHAへfast-forwardする。Worker Buildsが対象Worker `atlasez-admin-release-staging` だけをBuild/Deployすることを確認する。

影響範囲はstaging Workerと専用D1だけで、production Worker/Route/D1、production secrets、email/Discord delivery、Cronは変更しない。migrationは実行しない。preflight/Build/Deployが失敗した場合は現行のstaging Version `f07af8b2` がそのまま配信され、productionには影響しない。設定・接続の復旧候補は上記「復旧」に記録した旧staging branch/guardであり、推測によるrollback/promoteやproductionへの手動deployは行わない。

予定Build command:

```bash
test "$(git rev-parse HEAD)" = 'f0f4ee753c305c59f4c5efcdced7d4d14d7821d3' && printf '%s' "$RELEASE_CONFIG_JSON" > wrangler.admin.staging.compat.jsonc && npm ci && npm run verify:admin-staging-config:compat && ATLASEZ_BUILD_TARGET=admin SITE_URL=https://atlasez-admin-release-staging.atlasez-adm.workers.dev BASE_PATH=/ npm run build && npm run verify:build-info
```

予定Deploy command:

```bash
test "$(git rev-parse HEAD)" = 'f0f4ee753c305c59f4c5efcdced7d4d14d7821d3' && npm run verify:admin-staging-config:compat && npx wrangler deploy --config wrangler.admin.staging.compat.jsonc --keep-vars
```
