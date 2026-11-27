# 実運用受入基準

更新日: 2026-11-27

## 現在の状況

- mainには記事アーカイブの承認フローが含まれる。メンバー受入候補は別系統の記事削除フローと分離している。
- main基準の受入候補はPR [#649](https://github.com/Atlasez/Admin-Atlasez/pull/649)。最新headは `59c0136d4e21dd92a464ea06b54c66bafc7f8e1a)、63 files、レビュー待ち。
- 最新headのGitHub CI run [45995862329](https://github.com/Atlasez/Admin-Atlasez/actions/runs/45995862329) は成功。単体テスト、build、E2E、アクセシビリティ、Lighthouseを含む。
- ローカル検証はVitest 88 files / 800 tests、astro check、lint、format、deployment config、staging template、ADMIN build、build-info、Wrangler dry-runが成功。ローカルPlaywright browserの取得はHTTP 403で実行できず、E2EはGitHub CIで確認した。
- staging read-only確認では、配信WorkerはPR #649のheadではなく以前の候補。専用D1のmigration ledgerは0140〜0143で、mainの0144は未適用。専用OAuth client/secretは登録済みだが、test-user allowlistは未設定。Resend/Discord credentialsも未設定。
- 実stagingのrole別操作、通知到達、backup復元、本番D1 ledger再確認、本番migration/deploy、実利用者受入は未完了。

## リリースゲート

| 順序 | ゲート | 現在の状態 | 完了条件 |
| --- | --- | --- | --- |
| 1 | ブランチ・CI・レビュー | PRと最新headの必須CIは成功。独立したコードレビュー待ち。 | migration順、認可境界、メール/Discord副作用、運用手順をレビューする。 |
| 2 | staging構成 | 専用Worker/D1/OAuthを確認済みだが、配信commitがPR headと不一致。allowlistと通知credentialが未設定。 | staging専用資源、callback、cookie、CORS、redirect、D1 bindingをread-onlyで照合し、対象commit一致を確認する。 |
| 3 | 実ユーザー受入 | 未着手。 | synthetic accountで応募・審査・招待・初回ログイン・role別画面/API・停止/復帰・監査履歴を確認する。通知は承認済みsandboxに限る。 |
| 4 | 運営準備 | 担当と運用条件の決定待ち。 | 主担当/代理、対応期限、問い合わせ先、個人情報保持期間、権限表、停止/復旧、backupのRPO/RTOを決めて記録する。 |
| 5 | データ移行 | 本番D1 ledgerは未確認。 | 適用時点のmigration履歴を再取得し、backupと隔離restoreを検証する。D1所有者の明示承認後に別作業で適用する。 |
| 6 | 本番GO | 未承認・未実施。 | 全証跡を責任者が確認し、対象commit、戻し方、監視時間、担当者を記録してから判断する。 |

## 次に行う順序

1. PR #649の独立レビューを完了する。
2. レビュー済みの正確なheadを専用stagingへ配信し、read-backでcommitとD1 bindingを照合する。
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
