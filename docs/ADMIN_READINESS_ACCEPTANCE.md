# 実運用受入基準

更新日: 2026-11-28

## 現在の状況

- mainは `76e5fad87e01f6894d3917bec6bf494e99ebe888`。記事アーカイブ承認と個別記事削除申請は別フローとして運用する。
- 本番Workers Build `76517dd7-8166-41d7-81b9-bf5f0dbd46e2` はmain SHAをBuild/Deployし、Worker `atlasez-admin` のVersion `902fd2f0-e906-4800-b353-13afb355e969` が100% Ready。公開 `build-info.json` のcommitもmain SHAと一致した。
- PR [#649](https://github.com/Atlasez/Admin-Atlesez/pull/649) のruntime候補 `f0f4ee753c305c59f4c5efcdced7d4d14d7821d3` は最新mainを取り込んだ。GitHub CI run [46139876980](https://github.com/Atlasez/Admin-Atlesez/actions/runs/46139876980) は全job success。この記録更新はdocs-onlyで、更新後のPR head CIを再確認する。独立reviewerは所有者指示で不要だが、synthetic accountによるrole別受入と運営GO前のためPRは未merge。
- Cloudflare staging Worker `atlasez-admin-release-staging` はbranch `codex/staging-intake-649` のruntime候補SHA `f0f4ee753c305c59f4c5efcdced7d4d14d7821d3` からBuild/Deploy済み。Workers Build `78471160-5e0e-4b93-8f9f-8a7fc111daaa` が全段階success、Version `dbf58dc9` は100% Ready。公開build-infoのcommitも候補SHAと一致し、`ref` は `unknown`（branchはBuild recordで照合）。専用D1 bindingは維持し、migrationなし。影響・復旧方法と証跡は[Build設定実施記録](ADMIN_STAGING_BUILD_SETTINGS_PLAN_2026-11-28.md)に記録する。
- staging専用Worker/D1 bindingは確認済みで、本番D1を参照していない。staging D1 migration ledgerはread-only照合で未適用なし。email/Discord delivery disabled、Cronなし、Google login allowlist未設定。未認証ポータルはGoogle OAuth account chooserへ遷移したが、synthetic account未指定のためアカウント選択はしていない。role別の認証済み受入は未完了。
- 本番D1は0141/0144適用済み。0141は2026-11-28に、適用直前ledger、所有者限定backup、隔離SQLite restoreと適用検証、D1所有者の明示承認を経て適用した。read-backで未適用migrationなしを確認した。release staging D1の0144もbackup/隔離restore後に適用済み。
- 本番配信後、認証済みChromeでポータル、タスク、カレンダー、プロフィール、管理トップ、記事一覧、記事削除申請を確認した。各画面は表示され、読み込み残り・画面エラーはなかった。
- 個人情報保持のOPSD-03は未承認。180日は候補で本番方針ではない。定期処理の `deleteTerminalApplications` は無効のまま。保持方針・公開説明・backup上の削除時期が合うまで有効化しない。
- synthetic accountによるrole別操作、通知到達、backup復元、運営担当/SLA/RPO/RTOの合意、本番WorkerへのPR #649配信、実利用者受入は未完了。

## リリースゲート

1. **ブランチ・CI・レビュー** — runtime候補 `f0f4ee75` のCI success。独立reviewerは所有者指示で不要。docs-only更新後はmerge前に最新PR head CIを再確認する。PRはstaging受入・運営GO待ち。
2. **staging構成** — runtime候補 `f0f4ee75` のWorkers Build、専用Worker/D1、Version `dbf58dc9` の100%配信、build-info SHAを照合済み。OAuth test-user allowlistは未設定のため認証済み受入は保留。
3. **実ユーザー受入** — 未完了。所有者承認済みsynthetic Google accountで応募・審査・招待・初回ログイン・role別画面/API・停止/復帰・監査履歴を確認する。通知は承認済みsandboxに限る。
4. **運営準備** — 担当と運用条件の決定待ち。主担当/代理、対応期限、問い合わせ先、個人情報保持期間、権限表、停止/復旧、backupのRPO/RTOを決めて記録する。
5. **データ移行** — production 0141はowner approval、backup、isolated restore後に適用・read-back済み。これは定期backupや運用SLO、本番Worker deployの承認を意味しない。
6. **本番GO** — 未承認・未実施。全証跡を責任者が確認し、対象commit、戻し方、監視時間、担当者を記録してから判断する。

## 次に行う順序

1. docs-only記録更新後のPR #649最新head CIがsuccessであることをmerge前に確認する。
2. 所有者がsynthetic test accountを指定し、staging Workerだけのallowlistへ設定する。
3. allowlistアカウントでrole別受入を行い、通知とCronは承認済みsandboxで個別に確認する。
4. 運営体制・保持期間・停止/復旧・backup SLOを決め、公開説明に反映する。
5. 全証跡と担当者を確認して本番GOを記録し、PR #649をmergeする。その後mainのWorkers Buildと認証済みChromeで本番SHA・画面を確認する。

## 停止条件

- 必須CI失敗、対象commit不一致、権限漏れ、stagingから本番データへの接続、未承認のメール/Discord送信、backup復元失敗のいずれかで停止する。
- migrationや本番設定変更はコードdeployと分ける。GO記録とD1所有者承認がない状態では適用しない。
- 受入試験で使う個人情報はsynthetic dataに限定し、実応募データを検証用環境へ複製しない。
- 実利用者の招待は、staging受入・担当者合意・責任者GOの完了後に限定する。
