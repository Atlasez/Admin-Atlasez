# ADMINメンバー受入 staging checklist

更新日: 2026-11-28

状態: コード候補 `e9b40d3f284577a0af652e9d180ed2fcc4d4594b` とstaging候補 `99b8139dd9585840fc4f555789de1a5a4bc75217` の必須CI、PR head `54643d261efa9c9ff87fb1c72f72f4eaa10e44cf` の全CIは成功。独立レビュー担当は所有者指示で不要。production 0141とrelease staging D1の0144はbackup・隔離restore後に適用済み。Cloudflare staging Workerのbranch/SHA guardは専用candidate `codex/staging-intake-649` / `99b8139d` に整合して保存・read-back済みだが、Buildは未起動でactive Versionは旧SHA `a4dcfc79` のまま。OAuth test-user allowlist未設定のため、staging配信後の認証済みrole別受入、本番Worker deploy、実利用者受入は未完了。

## 現在の確認済み進捗

- [x] main基準のPR #649を作成し、応募・審査・role境界・staging手順・migration検証を統合。
- [x] mainの記事アーカイブ承認フローを維持し、別系統の記事削除migrationと分離。
- [x] PRとIssueにはsecret値、実利用者情報を記録しない。staging Discordの本番比較値は外部Worker設定から読み、欠落時は有効化しない。
- [x] Cloudflare staging WorkerのProduction branchを `codex/staging-intake-649`、Build/Deploy SHA guardをcandidate `99b8139dd9585840fc4f555789de1a5a4bc75217` に揃えて保存。read-backで両command、staging D1 binding、allowlist不在、email/Discord disabled、Cronなしを確認。設定変更後もactive Versionは旧SHA `a4dcfc799c0e0ef5b2fb14f96da21e39dd9ad718` の `65f6359d` / 100%であり、candidate Buildは未起動。
- [x] staging用OAuth secretの存在、test-user allowlist未設定、email/Discord delivery disabled、Resend/Discord credential未設定、Cron trigger未設定をread-only確認。secret値は記録しない。
- [x] production D1の0141適用前exportを隔離復元し、整合性・外部キー・0141適用後の集計を確認した上で、所有者承認により本番0141を適用。直後のmigration ledgerは未適用なし。
- [x] release staging D1のmigration ledgerで0141適用済み・0144未適用を確認。バックアップと隔離復元後に0144を適用し、直後のledger、table、indexをread-back確認。
- [x] コード候補 `e9b40d3f` とstaging candidate SHA `99b8139dd9585840fc4f555789de1a5a4bc75217` の必須CIが成功。専用refと同SHAのno-Cron staging dry-runを確認。dry-runではWorker deploy・D1 migrationを行っていない。専用refはCloudflare staging Workerへ接続済みだが、Buildは未起動。
- [x] 2026-11-28にproduction migration 0141 read-back後のbuild-infoと、ポータル、タスク、カレンダー、プロフィール、管理トップ、記事一覧を認証済みChromeで再確認。主要画面はログイン状態で表示され、読み込み残り・画面エラーなし。
- [x] 独立レビュー担当は所有者指示で不要。staging Build設定の値・影響・復旧方法を計画書へ記録し、staging Workerへ適用・read-back済み。candidate Build、role別受入、限定運用GOは未完了。

## 1. コード・レビュー・migration

- [ ] docs-only PR headのCI成功と `99b8139d` からのdocs-only差分を確認後、staging Build/Deploy SHA guardを新headへ合わせ、candidate branchをそのheadへfast-forwardしてWorkers Buildsを起動する。
- [ ] test-user allowlistを所有者が承認したsynthetic Google accountに限定し、secret名をread-backする。許可アカウント未設定のままstagingログイン試験を行わない。
- [ ] Build設定、OAuth callback、cookie domain、CORS、redirect allowlistをstaging専用でread-back確認する。
- [ ] candidate Build後、run/checkout SHA、公開build-info、Worker名・Version・100%配信、D1 binding、migration ledgerをread-onlyで再取得する。想定SHA/workerとの不一致があれば停止する。
- [x] staging D1の0141/0144適用状態をread-back照合。0144はbackup/隔離restore後に適用済み。
- [ ] 本番D1のmigration適用は、このstagingチェックリストの完了だけでは許可しない。

## 2. stagingの分離確認と配信

- [x] staging専用Worker、reports用D1 binding、OAuth secretの存在をread-onlyで確認。Build branch/SHA guardをcandidate `codex/staging-intake-649` / `99b8139d` に合わせて保存した。
- [ ] staging origin、OAuth callback、cookie domain、CORS、redirect allowlistがstaging専用で一致することを確認する。
- [x] production比較値を外部環境からstaging isolation preflightへ与えた。値はrepository、PR、Issueへ保存しない。
- [ ] Discord stagingのruntime guard用にATLASEZ_PRODUCTION_DISCORD_GUILD_IDとATLASEZ_PRODUCTION_DISCORD_CLIENT_IDをstaging Workerのsecret storeへ設定し、secret値を表示せず名前だけread-backする。どちらかが未設定ならstaging Discordを有効化しない。
- [x] release staging用D1と既存staging D1が異なることをread-onlyで照合し、isolation preflightへ渡した。
- [ ] operatorが承認したsynthetic accountだけをstaging allowlistに設定する。現状はallowlist未設定。
- [x] exact code commit SHA `e9b40d3f284577a0af652e9d180ed2fcc4d4594b` のno-Cron dry-runが成功。候補 `99b8139d` のBuildは未起動で、active staging Versionは旧SHAのまま。
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
