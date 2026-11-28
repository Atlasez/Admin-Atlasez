# ADMIN staging Build設定変更計画

更新日: 2026-11-28

状態: staging WorkerのBuild設定は2026-11-28に保存・read-back済み。Production branchは候補branch、Build/Deploy SHA guardは候補SHAを指す。設定保存だけではBuildは起動せず、active staging Versionは旧SHAのまま。候補Worker Versionはまだ配信していない。production Worker・Route・D1は変更していない。

## 対象と候補

- 対象Worker: `atlasez-admin-release-staging`
- GitHub repository: `Atlasez/Admin-Atlasez`
- 現在のProduction branch: `codex/staging-intake-649`
- 現在のBuild/Deploy SHA guard: `99b8139dd9585840fc4f555789de1a5a4bc75217`
- active staging Version: `65f6359d`、commit `a4dcfc799c0e0ef5b2fb14f96da21e39dd9ad718`、traffic 100%。候補SHAのVersionは未作成。
- 候補branch: `codex/staging-intake-649`。candidate SHA `99b8139dd9585840fc4f555789de1a5a4bc75217` を指しています。同SHAのCI run [46130190787](https://github.com/Atlasez/Admin-Atlasez/actions/runs/46130190787) とno-Cron dry-runは成功済みです。
- 候補SHA: `99b8139dd9585840fc4f555789de1a5a4bc75217`。コード候補 `e9b40d3f284577a0af652e9d180ed2fcc4d4594b` からの差分は受入・復旧記録だけ。
- binding、Runtime vars/secrets、Workers.dev origin、email/Discord無効、Cronなし、staging D1は現状のままにする。D1 0141/0144は適用・read-back済み。

設定変更時点でProduction branchとBuild/Deploy commandのSHA guardを上記値に揃え、Cloudflare dashboardからread-backした。OAuth allowlistは未設定なのでログイン受入はまだできない。Production branch設定の保存後もBuildは自動起動しなかった。次のBuildは、最新PR headのCI成功と `99b8139d` からの差分がdocs-onlyであることを確認し、Build/Deploy guardをそのfull SHAに揃えた後、candidate refを同じfull SHAへfast-forwardしてWorkers Buildsのpush triggerで開始する。コード候補は変わらないが、対象SHA・Build・Versionは別途照合する。

## 変更するCloudflare設定

保存済み設定はProduction branch `codex/staging-intake-649`、Build/Deploy commandのSHA guard `99b8139dd9585840fc4f555789de1a5a4bc75217`。次のBuild起動時は、PR headに追記されたdocs-only変更を含むCI成功SHAへ両guardを更新してから、candidate refを同じSHAへfast-forwardする。Build commandとDeploy commandの他の処理は保つ。

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

Build branchまたはcommandの保存だけで新Versionが配信されたことにはしない。Cloudflare上でbranch、Build/Deploy commandをread-backしたが、その時点のactive Versionは旧SHAのまま。Build開始後はWorkers Builds runとcheckout SHA、Worker名、traffic 100%、Version、staging D1 bindingを読み戻す。staging originの `build-info.json` のSHAがBuild対象SHAと一致することを確認する。OAuth allowlistが未設定の間は認証済み受入に進まず、Secret値やユーザー行を出力・記録しない。

Build triggerは、レビュー済みの最新PR docs-only headへ専用branchをfast-forwardしてWorkers Buildsのpushを発生させる。候補コードSHA `e9b40d3f284577a0af652e9d180ed2fcc4d4594b` とstaging candidate `99b8139dd9585840fc4f555789de1a5a4bc75217` のCI/no-Cron dry-runは既に成功している。新しいPR docs-only headのCIが成功するまでbranchを動かさない。

## 復旧

想定外のcheckout SHA、Worker、Version、binding、auth動作を確認したら、staging WorkerのBuildを停止してから設定を次へ戻す。

- Production branch: `codex/release-staging-647`
- Build command SHA guard: `a4dcfc799c0e0ef5b2fb14f96da21e39dd9ad718`
- Deploy command SHA guard: `a4dcfc799c0e0ef5b2fb14f96da21e39dd9ad718`

復旧後はBuild設定、active staging Version、Worker/D1 bindingをread-onlyで照合する。Versionが期待と異なる場合は、承認なしでpromote、rollback、Route変更を推測実行しない。0144は追加型schemaのため逆migrationで削除せず、必要な修正はstaging上でforward-fixする。本番Worker/D1はこの復旧手順の対象外。
