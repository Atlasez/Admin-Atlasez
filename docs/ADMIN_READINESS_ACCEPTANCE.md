# 実運用受入基準

更新日: 2026-11-28

## 現在の状況

- mainには記事アーカイブの承認フローが含まれる。メンバー受入候補は別系統の記事削除フローと分離している。
- main基準の受入候補はPR [#649](https://github.com/Atlasez/Admin-Atlasez/pull/649)。コード候補 `e9b40d3f284577a0af652e9d180ed2fcc4d4594b`、base main `a902f54059ec032fe49b6aea2464e8e5d6c5198a` のCI run [46126987210](https://github.com/Atlasez/Admin-Atlasez/actions/runs/46126987210) とstaging候補 `99b8139dd9585840fc4f555789de1a5a4bc75217` のCI run [46130190787](https://github.com/Atlasez/Admin-Atlasez/actions/runs/46130190787) はsuccess。追加のdocs-only更新はPR checksで確認してからmergeする。独立レビュー担当は所有者指示で不要だが、PRはstaging受入・運営GO前のため未merge。
- Cloudflare staging Workerは `codex/release-staging-647` に接続し、Build設定のSHA pin `a4dcfc799c0e0ef5b2fb14f96da21e39dd9ad718` とBuild commandの旧SHA `f7a3d4edf70d4a0f8736f4d1b4b12d9f8011ef4d` は候補と一致しない。専用candidate ref `codex/staging-intake-649` は `99b8139dd9585840fc4f555789de1a5a4bc75217` に作成済み。no-Cron dry-runは成功したが、Workerへは配信していない。Cloudflare Build設定は変更していない。
- staging専用Worker/D1 bindingとOAuth secretを確認。test-user allowlistは未設定、email/Discord deliveryはdisabled、Resend/Discord credentialsは未設定、Cron triggerも未設定。synthetic Google accountを許可するまで認証済み受入はできない。
- 本番D1は0144適用済み。0141は2026-11-28に、適用直前のledger確認、所有者限定backup、隔離SQLite restoreと0141適用検証、D1所有者の明示承認を経て適用した。直後のread-backは0141/0144適用済み、未適用migrationなし。
- release staging D1は0141適用済み・0144未適用を確認後、backup/隔離restoreで既存99 tablesと行数維持を確認し、0144を適用した。直後のread-backで0141/0144、archive request tableと3 indexを確認した。
- 2026-11-28のproduction 0141適用後、認証済みChromeでポータル、タスク、カレンダー、プロフィール、管理トップ、記事一覧を再確認した。各画面はログイン状態で表示され、読み込み残り・画面エラーはなく、公開build-infoはmain SHAと一致した。
- 個人情報保持のOPSD-03は未承認。180日は候補で本番方針ではない。定期処理も `deleteTerminalApplications: false` で終端応募の自動削除を停止している。保持方針・公開説明・backup上の削除時期が合うまで有効化しない。
- 実stagingのrole別操作、通知到達、backup復元、本番D1 ledger再確認、本番migration/deploy、実利用者受入は未完了。

## リリースゲート

1. **ブランチ・CI・レビュー** — コード候補 `e9b40d3f` とstaging候補 `99b8139d` のCIはsuccess。独立reviewerは所有者指示で不要。main mergeはstaging受入・運営GO待ち。
2. **staging構成** — 専用資源とcandidate refは準備済みだが、WorkerのBuild branch/SHA guardは候補と不一致で、test-user allowlistもない。Cloudflare設定変更の値・影響・復旧方法をPRでレビューし、設定を整合してから配信する。
3. **実ユーザー受入** — 未着手。所有者承認済みsynthetic Google accountで応募・審査・招待・初回ログイン・role別画面/API・停止/復帰・監査履歴を確認する。通知は承認済みsandboxに限る。
4. **運営準備** — 担当と運用条件の決定待ち。主担当/代理、対応期限、問い合わせ先、個人情報保持期間、権限表、停止/復旧、backupのRPO/RTOを決めて記録する。
5. **データ移行** — production 0141はowner approval、backup、isolated restore後に適用・read-back済み。これは定期backupや運用SLO、本番Worker deployの承認を意味しない。
6. **本番GO** — 未承認・未実施。全証跡を責任者が確認し、対象commit、戻し方、監視時間、担当者を記録してから判断する。

## 次に行う順序

1. staging Google OAuthで使うsynthetic test accountを所有者が指定・承認する。
2. Cloudflare staging Build設定を候補SHAへ整合する設定変更PRをレビューし、作成済み専用refを配信してread-backする。
3. allowlistアカウントでrole別受入を行い、通知とCronは別途承認済みsandboxでのみ確認する。
4. 運営体制・保持期間・停止/復旧・backup SLOを決め、公開説明に反映する。
5. すべての受入証跡と担当者を確認して本番GOを記録し、PR #649をmergeする。
6. Workers Buildsがmainから正確なSHAを配信したことを確認し、認証済みChromeで主要ADMIN画面を再確認する。

## 停止条件

- 必須CI失敗、対象commit不一致、権限漏れ、stagingから本番データへの接続、未承認のメール/Discord送信、backup復元失敗のいずれかで停止する。
- migrationや本番設定変更はコードdeployと分ける。GO記録とD1所有者承認がない状態では適用しない。
- 受入試験で使う個人情報はsynthetic dataに限定し、実応募データを検証用環境へ複製しない。
- 実利用者の招待は、staging受入・担当者合意・責任者GOの完了後に限定する。
