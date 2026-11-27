# 実運用受入基準

更新日: 2026-11-27

## 現在の状況

- mainには記事アーカイブの承認フローが含まれる。メンバー受入候補は別系統の記事削除フローと分離している。
- main基準の受入候補はPR [#649](https://github.com/Atlasez/Admin-Atlasez/pull/649)。main baseは `2b407b4374620cebd1e76f8eaa93355ae5e75ce8`。独立レビュー待ち。
- コードを含む直近検証済みheadは `2e11a892a1da2f9a266a6bdc64fa1390e98014f3`。CI run [46012638173](https://github.com/Atlasez/Admin-Atlasez/actions/runs/46012638173) はsuccess。後続は受入文書のみのcommitだが、その最終headに対するworkflow/check statusは未確認。
- Cloudflareの読み取り専用確認で、staging WorkerはPRの作業ブランチではなく `codex/release-staging-647` に接続していた。現在のBuild settingsのSHAガードは `a4dcfc799c0e0ef5b2fb14f96da21e39dd9ad718`、確認した失敗Build画面のコマンドは `f7a3d4edf70d4a0f8736f4d1b4b12d9f8011ef4d` を要求していた。Buildログはコマンド失敗までで、cloneされた実SHAは確認できない。PR headとの一致も未確認。staging配信を止め、この設定差をレビュー後に解消する。
- 同Workerの設定ではstaging用OAuth secretが登録済み。synthetic test-user allowlistは未設定。メール/Discord deliveryはdisabled、Resend/Discord credentialsは未設定、Cron triggerは未設定。画面上のD1 bindingはstaging reports専用。secret値は記録しない。
- 以前のread-only migration ledger確認では専用D1が0140〜0143、mainの0144は未適用。本番・stagingともmigration前に適用時点のledgerを再取得する。
- 個人情報保持のOPSD-03は未承認。180日は候補で本番方針ではない。定期処理も `deleteTerminalApplications: false` で終端応募の自動削除を停止している。保持方針・公開説明・backup上の削除時期が合うまで有効化しない。
- 実stagingのrole別操作、通知到達、backup復元、本番D1 ledger再確認、本番migration/deploy、実利用者受入は未完了。

## リリースゲート

| 順序 | ゲート                 | 現在の状態                                                                                                           | 完了条件                                                                                                                        |
| ---- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1    | ブランチ・CI・レビュー | PR headのCIは確認時点で実行中。独立したコードレビュー待ち。                                                          | 最新headの必須CI成功後、migration順、認可境界、外部通知の副作用、運用手順を独立レビューする。                                     |
| 2    | staging構成            | staging資源は専用だが、Workerの接続branchとSHA guardがPR候補と不一致。allowlistと通知credentialが未設定。            | Build設定をレビュー済みPR headへ整合し、deploy後にcommit、D1 binding、migration ledger、OAuth callback等をread-onlyで再照合する。 |
| 3    | 実ユーザー受入         | 未着手。                                                                                                             | synthetic accountで応募・審査・招待・初回ログイン・role別画面/API・停止/復帰・監査履歴を確認する。通知は承認済みsandboxに限る。  |
| 4    | 運営準備               | 担当と運用条件の決定待ち。                                                                                           | 主担当/代理、対応期限、問い合わせ先、個人情報保持期間、権限表、停止/復旧、backupのRPO/RTOを決めて記録する。                     |
| 5    | データ移行             | 本番D1 ledgerは適用判断時点で未確認。                                                                                | 適用時点のmigration履歴を再取得し、backupと隔離restoreを検証する。D1所有者の明示承認後に別作業で適用する。                      |
| 6    | 本番GO                 | 未承認・未実施。                                                                                                     | 全証跡を責任者が確認し、対象commit、戻し方、監視時間、担当者を記録してから判断する。                                            |

## 次に行う順序

1. 最新headのCIを完了し、PR #649を独立レビューする。
2. レビュー済みの正確なheadへstaging Build branch/SHA guardを整合し、stagingだけに配信してread-backでcommitとD1 bindingを照合する。
3. test-user allowlistを承認済みsynthetic accountに限定して設定し、role別の実操作を確認する。
4. 通知はsandbox設定・受信先・停止方法を読み合わせた後だけ検証する。
5. 運営体制と個人情報保持条件を決め、D1 backup/隔離restoreを確認する。
6. 本番D1 ledgerをその時点で再取得し、必要なmigrationをD1所有者承認後に別作業で行う。
7. 責任者が証跡を見て限定招待のGOを記録する。

## 停止条件

- 必須CI失敗、対象commit不一致、権限漏れ、stagingから本番データへの接続、未承認のメール/Discord送信、backup復元失敗のいずれかで停止する。
- migrationや本番設定変更はコードdeployと分ける。GO記録とD1所有者承認がない状態では適用しない。
- 受入試験で使う個人情報はsynthetic dataに限定し、実応募データを検証用環境へ複製しない。
- 実利用者の招待は、staging受入・担当者合意・責任者GOの完了後に限定する。
