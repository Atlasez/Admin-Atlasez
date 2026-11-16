# Atlasezローカル検証

このSkillは、ADMIN画面をローカルで起動し、Playwrightで実際に操作して結果を保存する。既存のE2EとAPIモックを使う。実サービス、Cloudflare、GitHub、メール、Discord、本番D1へ書き込まない。

## 起動前の安全条件

- リポジトリのルートで実行する。依存関係がなければ npm ci を実行する。
- npm run agent:verify -- run <journey> はADMIN用ビルド、build-info照合、Doctor、Playwright操作を順に実行する。Playwrightが静的サーバーを一時ポートで起動し、終了時に止める。
- 実行器は外部の E2E_BASE_URL と E2E_AUTH_STORAGE_STATE を拒否する。Playwright fixtureもローカルorigin以外へのブラウザ通信を遮断する。
- 認証済み本番Smoke Test (npm run test:e2e:admin-live) はこのSkillから実行しない。

## Launch

少なくとも3つの完全なユーザージャーニーがある。

    npm run agent:verify -- run portal
    npm run agent:verify -- run article-editor
    npm run agent:verify -- run publication

他の機能を確認するときは member-tasks、calendar、permissions を指定する。各JourneyはローカルADMINビルドを作り、対象E2Eを1 workerで実行する。PlaywrightのWebServer fixtureがテスト前に起動し、終了時に停止するため、別の開発サーバーは起動しない。

## Doctor

ビルド後の環境を診断する。

    npm run agent:verify -- doctor

リポジトリ、依存関係、dist/admin/portal/index.html、dist/build-info.json を確認し、npm run verify:build-info でSHAを照合する。続けて認証境界と隔離D1統合テストを実行する。E2Eのbase URLが外部サイト、またはStorage Stateが設定されている場合は停止する。本番D1には接続しない。

## Drive

| Journey        | 画面と操作                                                              | 再現テスト                               |
| -------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| portal         | ポータルを開き、運営・参加者プロジェクトの表示を確認                    | tests/e2e/admin-nav-portal.spec.ts       |
| article-editor | 新規記事に入力し、自動保存後の再読み込みで内容を確認                    | tests/e2e/admin-editor-workspace.spec.ts |
| publication    | 公開Run一覧で状態を切り替え、古い応答が最新表示を上書きしないことを確認 | tests/e2e/admin-publication-runs.spec.ts |
| member-tasks   | アクションセンターでタスクを絞り込み、状態を変更                        | tests/e2e/admin-action-center.spec.ts    |
| calendar       | 月を切り替え、古い応答を破棄して読み込み失敗から再試行                  | tests/e2e/admin-calendar.spec.ts         |
| permissions    | ユーザー別の閲覧・編集・承認範囲を確認                                  | tests/e2e/admin-permissions.spec.ts      |

操作手順、必要なFixture、成功・失敗条件、状態確認、保存証拠は features/ 以下に記載する。FixtureがPlaywrightのAPI応答をローカルで代替する。UIから実サービスへのデータ送信は行わない。

## Evidence

テスト結果は verification-artifacts/test-results/<journey>/ に保存する。JSONレポート、失敗時スクリーンショット、失敗時Trace、ブラウザConsole Error、遮断した外部originの一覧が含まれる。ビルドSHAとテスト集計は verification-artifacts/summary-<journey>.json に記録する。これらは生成物でありGitには追加しない。

Traceは次で確認できる。

    npx playwright show-trace verification-artifacts/test-results/<journey>/<trace-file>.zip

## Cleanup

    npm run agent:verify -- cleanup

一時ポートの応答が残っていないことを確認し、ローカルセッション状態ファイルだけを削除する。ポートが応答している場合は、別プロセスの可能性があるため停止しない。検証証拠は保持する。

## Failure Recovery

1. npm run agent:verify -- doctor を実行し、ビルド・依存関係・SHAを確認する。
2. npx playwright test --list tests/e2e/<対象>.spec.ts で対象テスト名を確認する。
3. 固定した1 workerで再現する: npm run test:e2e -- tests/e2e/<対象>.spec.ts --grep '<テスト名>' --workers=1
4. test-results/ または verification-artifacts/test-results/<journey>/ のJSON、スクリーンショット、Trace、Console Errorを確認する。
5. 失敗を直したら同じJourneyを再実行する。失敗したテストの削除、skip化、期待値緩和で回復扱いにしない。
6. npm run agent:verify -- cleanup で一時ポートの終了を確認する。

認証Cookie、Storage State、外部サービスの秘密情報をテスト成果物やGitに保存しない。

## Agentの修正・Draft PRフロー

再現、修正後の検証、開発用Draft PRを同じ記録へ保存する。

    npm run agent:fix -- reproduce tests/unit/<対象>.test.ts
    npm run agent:fix -- verify --journey <対象Journey>
    npm run agent:fix -- draft-pr --title "修正内容" --description "原因と対応内容"

`reproduce`は指定したローカルテストだけを実行し、成否とログを保存する。`verify`はdeploy設定、型、Lint、Format、Unit、公開状態モデル、ADMINビルド、build-infoを順に確認する。`--journey`を指定すると対象E2Eも実行する。`draft-pr`は全検証成功と非mainブランチを確認してDraft PRだけを作成する。MergeやDeployは行わない。ログとworkflow.jsonはverification-artifacts/agent-fix/へ保存し、Gitには追加しない。
