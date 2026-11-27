# ADMINメンバー受入 staging checklist

更新日: 2026-11-27

状態: PR #649は最新headの必須CIと独立レビュー待ち。Cloudflare stagingのBuild branch/SHA guardがPR候補と一致しないため、配信・実利用者受入・本番migration/deployは未実施。読み取り専用の実測差分はreadiness acceptanceとIssue #647へ記録する。

## 現在の確認済み進捗

- [x] main基準のPR #649を作成し、応募・審査・role境界・staging手順・migration検証を統合。
- [x] mainの記事アーカイブ承認フローを維持し、別系統の記事削除migrationと分離。
- [x] PRとIssueにはsecret値、実利用者情報を記録しない。staging Discordの本番比較値は外部Worker設定から読み、欠落時は有効化しない。
- [x] Cloudflare stagingをread-onlyで再確認。WorkerはPR作業branchではなく `codex/release-staging-647` に接続。Build settingsのSHA guardは `a4dcfc799c0e0ef5b2fb14f96da21e39dd9ad718`、確認した失敗Buildのコマンドは `f7a3d4edf70d4a0f8736f4d1b4b12d9f8011ef4d` を要求。cloneされたSHAはログから確認できず、PR headとの一致も未確認。
- [x] staging用OAuth secretの登録を確認。allowlistは未設定。メール/Discord deliveryはdisabled、Resend/Discord credentialは未設定。Cron triggerは未設定。secret値はPRやIssueへ記録しない。
- [x] 以前のread-only migration ledger確認で専用D1が0140〜0143、mainの0144は未適用と確認。次のmigration判断前にledgerを再取得する。
- [ ] 最新PR headのCIと独立レビューを完了する。

## 1. コード・レビュー・migration

- [ ] 独立レビューでmigration順、応募/role認可、外部通知の副作用、運用文書を確認する。
- [ ] stagingを変更する前に、WorkerのGit branch/Build SHA guardをレビュー済みPR headへ整合する。現在の設定差が残る間は配信しない。
- [ ] staging配信後、公開build-info/commit、D1 binding、migration ledgerをread-onlyで再取得する。PR headとの不一致があれば停止する。
- [ ] staging D1の0141適用状態とmainの0144を照合する。0144適用はbackup/read-backと明示承認後に別作業で行う。
- [ ] 本番D1のmigration適用は、このstagingチェックリストの完了だけでは許可しない。

## 2. stagingの分離確認と配信

- [x] staging専用Worker、reports用D1 binding、OAuth secretの存在をread-onlyで確認。
- [ ] staging origin、OAuth callback、cookie domain、CORS、redirect allowlistがstaging専用で一致することを確認する。
- [ ] production比較値を外部環境変数から与える。値はrepository、PR、Issueへ保存しない: ATLASEZ_PRODUCTION_ADMIN_ORIGIN、ATLASEZ_PRODUCTION_D1_NAME、ATLASEZ_PRODUCTION_D1_ID、ATLASEZ_PRODUCTION_DISCORD_GUILD_ID、ATLASEZ_PRODUCTION_DISCORD_CLIENT_ID。
- [ ] Discord stagingのruntime guard用にATLASEZ_PRODUCTION_DISCORD_GUILD_IDとATLASEZ_PRODUCTION_DISCORD_CLIENT_IDをstaging Workerのsecret storeへ設定し、secret値を表示せず名前だけread-backする。どちらかが未設定ならstaging Discordを有効化しない。
- [ ] release staging利用時は既存staging D1との重複を避けるためATLASEZ_EXISTING_STAGING_D1_IDも外部環境から渡す。
- [ ] operatorが承認したsynthetic accountだけをstaging allowlistに設定する。現状はallowlist未設定。
- [ ] exact commit SHAを確認用環境変数へ設定し、dry-runとread-back結果を記録する。branch、SHA guard、CIが揃うまでdeployしない。
- [ ] Resend sandboxとDiscord test guildのcredential、送信先、停止方法をread-backする。未設定・未承認の通知は送らない。
- [ ] Workerのemail/Discord deliveryがdisabledであることを維持し、sandboxの受信確認前に有効化しない。

## 3. role別の実操作

synthetic accountだけを使い、以下をstagingで実行する。

- [ ] 未ログイン: 保護ページ/APIを読めず、応募公開部分だけ利用できる。
- [ ] 応募者: 入力、確認、再ログイン、応募状態表示、誤入力と二重送信を確認する。
- [ ] reviewer: 応募詳細、承認/却下、理由、権限外API拒否、監査履歴を確認する。
- [ ] member: 初回ログイン、所属、許可されたタスク/記事操作、権限外の変更拒否を確認する。
- [ ] operator/admin: member招待、role変更、停止/復帰、監査記録、エラー回復を確認する。
- [ ] 通知は承認済みsandboxの受信確認後にだけ有効化し、重複送信と失敗時の再試行を確認する。

## 4. 運営引継ぎと本番判断

- [ ] 問い合わせ窓口、主担当/代理、応募対応期限、日次queue確認、緊急停止/復旧手順を決める。
- [ ] 個人情報の保持期間と削除基準を責任者が承認し、公開説明に反映する。OPSD-03は未承認で、180日は候補値。定期処理は `deleteTerminalApplications: false` で終端応募の自動削除を停止している。承認・公開説明・backup削除時期の照合前に有効化しない。
- [ ] D1 backupの復元、整合性、RPO/RTOを隔離環境で実測する。
- [ ] 本番migrationは実行時点の履歴・backup・復元結果を確認後、D1所有者が明示承認した別作業で適用する。
- [ ] 全ゲートの証跡と担当者が揃った後に本番GOを記録する。未完了なら実利用者を招待しない。
