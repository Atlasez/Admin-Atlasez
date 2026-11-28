# ADMIN staging Build設定変更計画

更新日: 2026-11-28

状態: 計画のみ。Cloudflare設定、Worker、Route、secretは変更していない。Cloudflare設定変更のレビューと、OAuth受入用synthetic accountの所有者承認が完了するまで適用しない。

## 対象と候補

- 対象Worker: `atlasez-admin-release-staging`
- GitHub repository: `Atlasez/Admin-Atlasez`
- 現在のProduction branch: `codex/release-staging-647`
- 現在のBuild/Deploy SHA guard: `a4dcfc799c0e0ef5b2fb14f96da21e39dd9ad718`
- 候補branch: `codex/staging-intake-649`。現在のPR #649 head `99b8139dd9585840fc4f555789de1a5a4bc75217` を指す専用refとして作成し、候補CIが成功した後は移動しない。
- 候補SHA: `99b8139dd9585840fc4f555789de1a5a4bc75217`。コード候補 `e9b40d3f284577a0af652e9d180ed2fcc4d4594b` からの差分は受入・復旧記録だけ。
- binding、Runtime vars/secrets、Workers.dev origin、email/Discord無効、Cronなし、staging D1は現状のままにする。D1 0141/0144は適用・read-back済み。

候補SHAのGitHub CI成功、専用branchの存在、test-user allowlist、Cloudflare設定レビューが揃う前にProduction branchやBuild commandを変更しない。設定変更が即時Buildを起動する可能性を考慮し、OAuth allowlistを先に準備する。

## 変更するCloudflare設定

Production branchだけを `codex/release-staging-647` から `codex/staging-intake-649` に変更する。Build commandとDeploy commandの既存処理は保ち、SHA guardだけを上記候補SHAに合わせる。

Build command:

```bash
test "$(git rev-parse HEAD)" = '99b8139dd9585840fc4f555789de1a5a4bc75217' && printf '%s' "$RELEASE_CONFIG_JSON" > wrangler.admin.staging.compat.jsonc && npm ci && npm run verify:admin-staging-config:compat && ATLASEZ_BUILD_TARGET=admin SITE_URL=https://atlasez-admin-release-staging.atlasez-adm.workers.dev BASE_PATH=/ npm run build && npm run verify:build-info
```

Deploy command:

```bash
test "$(git rev-parse HEAD)" = '99b8139dd9585840fc4f555789de1a5a4bc75217' && npm run verify:admin-staging-config:compat && npx wrangler deploy --config wrangler.admin.staging.compat.jsonc --keep-vars
```

既存の `RELEASE_CONFIG_JSON`、Google OAuth client secret、Worker/D1 binding、API token、watch pathsは変更しない。Cronは未設定のままにし、email/Discord deliveryをdisabledのまま維持する。Production Worker `atlasez-admin`、本番D1、公開サイトのrouteやsecretsへは変更を加えない。

## 影響とread-back

Build branchまたはcommandの保存でstaging Workerに新Versionが配信される可能性がある。変更後はCloudflare上でbranch、Build/Deploy command、Build checkout SHA、Worker名、traffic 100%、Version、staging D1 bindingを読み戻す。staging originの `build-info.json` のSHAが候補SHAと一致し、OAuth allowlist以外のログインが拒否されることを確認する。Secret値やユーザー行は出力・記録しない。

## 復旧

想定外のcheckout SHA、Worker、Version、binding、auth動作を確認したら、staging WorkerのBuildを停止してから設定を次へ戻す。

- Production branch: `codex/release-staging-647`
- Build command SHA guard: `a4dcfc799c0e0ef5b2fb14f96da21e39dd9ad718`
- Deploy command SHA guard: `a4dcfc799c0e0ef5b2fb14f96da21e39dd9ad718`

復旧後はBuild設定、active staging Version、Worker/D1 bindingをread-onlyで照合する。Versionが期待と異なる場合は、承認なしでpromote、rollback、Route変更を推測実行しない。0144は追加型schemaのため逆migrationで削除せず、必要な修正はstaging上でforward-fixする。本番Worker/D1はこの復旧手順の対象外。
