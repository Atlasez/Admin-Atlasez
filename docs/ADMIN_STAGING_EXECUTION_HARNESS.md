# ADMIN staging execution harness

更新日: 2026-11-27

この手順は隔離環境の構成確認と受入試験を行う。production deploy、production D1 migration、実利用者招待は別のGO判断が完了するまで実行しない。

## ローカル準備

1. mainをbaseにしたレビュー対象branchをcheckoutし、working treeをcleanにする。
2. 依存関係とローカル検査を実行する。

   - npm ci
   - npm run verify:deploy-config
   - npm run verify:admin-staging-config:template
   - npm run test:admin-staging:isolated
   - npm test
   - npm run check
   - npm run lint
   - npm run format:check

3. ADMIN buildを検証する。
   - ATLASEZ_BUILD_TARGET=admin SITE_URL=https://admin.example BASE_PATH=/ npm run build:ci
   - npm run verify:build-info

4. PlaywrightはCIで実行し、最新commitのE2E/アクセシビリティ結果を確認する。ブラウザー取得ができないローカル環境では、未実施を成功扱いにしない。

## staging config

- wrangler.admin.staging.example.jsoncを雛形として、gitignore対象のローカルconfigを作る。雛形のplaceholderのままdeployできない状態を維持する。
- staging専用のWorker/D1/OAuthを選び、bindingとoriginをread-onlyで照合してから設定する。
- productionとの比較に必要な値は、次の環境変数から取得する。値自体をrepository/PR/Issue/ログに貼り付けない。
  - ATLASEZ_PRODUCTION_ADMIN_ORIGIN
  - ATLASEZ_PRODUCTION_D1_NAME
  - ATLASEZ_PRODUCTION_D1_ID
  - ATLASEZ_PRODUCTION_DISCORD_GUILD_ID
  - ATLASEZ_PRODUCTION_DISCORD_CLIENT_ID
  - release staging利用時はATLASEZ_EXISTING_STAGING_D1_ID
- Discord staging runtime guardにもATLASEZ_PRODUCTION_DISCORD_GUILD_IDとATLASEZ_PRODUCTION_DISCORD_CLIENT_IDが必要。両方をstaging Workerのsecret storeへ設定し、secret値を表示せず名前だけread-backする。production比較値が欠ける場合はDiscord stagingを有効にしない。
- OAuth secret、Cloudflare token、メール/Discord credentialはsecret storeから読み込み、CLI出力へ表示しない。
- 設定チェックはdry-runから始める。

  - npm run verify:admin-staging-config
  - npm run verify:admin-staging-migration
  - npm run deploy:admin:staging -- --dry-run

## デプロイとread-back

- exact commitをCIで通し、clean working treeを確認する。
- staging deployを行う場合は、deploy scriptが要求する確認用環境変数を設定し、commit SHAを一致させる。
- deploy後にread-onlyでWorker version、割当、build-info、D1 migration履歴、OAuth callback、secret名、cron状態を確認する。secret値は表示しない。
- 最初の受入ではメール/Discordをdisabledにする。role別のsynthetic account試験後、承認済みsandboxだけを個別に有効化する。
- 障害時はstaging Workerを停止し、通知先と監査記録を確認して復旧する。production Worker/D1へは切り替えない。

## migration

0141_application_intake_reconciliation.sqlはコードdeployと別に扱う。適用前に、実D1の現在履歴を再取得し、backup/隔離restore、migrationの順序、rollback/forward recoveryを確認する。D1所有者の明示承認なしに本番migrationを実行しない。

## 記録

readiness issueにはcommit、CI結果、staging受入項目ごとのpass/fail、migration履歴の確認有無、担当者、次の作業だけを記録する。secret、識別子、実ユーザー情報は記録しない。
