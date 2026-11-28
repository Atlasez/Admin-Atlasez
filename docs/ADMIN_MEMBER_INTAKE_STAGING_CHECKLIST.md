# ADMINメンバー受入 staging checklist

更新日: 2026-11-28

状態: runtime候補 `f0f4ee753c305c59f4c5efcdced7d4d14d7821d3` は最新mainを取り込み、GitHub CI run [46139876980](https://github.com/Atlasez/Admin-Atlesez/actions/runs/46139876980) が全job success。staging Workers Build [78471160](https://dash.cloudflare.com/812021e62fa20465950b61be55dfe064/workers/services/view/atlasez-admin-release-staging/production/builds/78471160-5e0e-4b93-8f9f-8a7fc111daaa) も全段階successで、Version `dbf58dc9` / 100% Ready、公開build-info SHA一致を確認。production D1 0141とrelease staging D1 0144はbackup・隔離restore後に適用済みで、staging D1に未適用migrationはない。独立reviewerは所有者指示で不要。Cloudflare設定では専用Google allowlist secretの名前を確認し、値は暗号化されたまま閲覧していない。Issue #647の記録では応募者役の合成identity 1件の受入済み。PR #649に応募受付停止スイッチの実装とunit/E2Eテストを追加中。manager/reviewerの別identity、停止スイッチのstaging runtime受入、運営GO、本番Worker反映、実利用者受入は未完了。

## 現在の確認済み進捗

- [x] main基準のPR #649を作成し、応募・審査・role境界・staging手順・migration検証を統合。
- [x] mainの記事アーカイブ承認フローを維持し、別系統の記事削除migrationと分離。
- [x] PRとIssueにはsecret値、実利用者情報、Cloudflare比較ID値を記録しない。
- [x] runtime候補 `f0f4ee753c305c59f4c5efcdced7d4d14d7821d3` のCI success。最新確認済みPR head `6e0adc4dab42cb60eafa623aa277947ac6697080` のdocs-only更新もCI success。追加の記録更新後はmerge前に最新PR CIをread-backする。独立reviewerは所有者指示で不要。main mergeはstaging受入・運営GO待ち。
- [x] Cloudflare staging WorkerのProduction branch `codex/staging-intake-649`、Build/Deploy SHA guard、run checkout SHAをruntime候補 `f0f4ee75` へ揃えた。Build `78471160`、Version `dbf58dc9` / 100% Ready、staging `build-info.json` SHA一致を確認。
- [x] staging専用Worker/D1 bindingをread-only確認。release staging D1と既存staging D1は異なり、isolation preflightが成功。production D1は接続していない。
- [x] production比較値のBuild環境変数名をCloudflare Build設定でread-backし、値を表示・記録せずにpreflight成功を確認。
- [x] staging用OAuth allowlist secret `ATLASEZ_STAGING_GOOGLE_LOGIN_ALLOWLIST` の存在をread-back確認。値は暗号化されており閲覧・記録しない。Issue #647に応募者役の合成identity 1件での受入記録がある。email/Discord delivery disabled、Resend/Discord credential未設定、Cron trigger未設定。
- [x] production D1の0141適用前exportを隔離復元し、整合性・外部キー・0141適用後の集計を確認した上で、所有者承認により本番0141を適用。直後のmigration ledgerは未適用なし。
- [x] release staging D1のmigration ledgerで0141適用済み・0144未適用を確認。バックアップと隔離復元後に0144を適用し、直後のledger、table、indexをread-back確認。
- [x] main `76e5fad87e01f6894d3917bec6bf494e99ebe888` のproduction Workers Build `76517dd7-8166-41d7-81b9-bf5f0dbd46e2`、Version `902fd2f0-e906-4800-b353-13afb355e969` の100%配信、公開build-info SHAを照合。Chromeでポータル、タスク、カレンダー、プロフィール、管理トップ、記事一覧、記事削除申請を確認。
- [x] 未認証stagingポータルのGETがGoogle OAuth account chooserへ遷移することを確認。synthetic account未指定のためアカウントを選ばず終了し、認証済み受入へ進んでいない。

## 1. コード・レビュー・migration

- [x] 既存候補のCI successと `99b8139d` からのdocs-only差分を確認し、前回Build/Deploy SHA guardとstaging refを合わせて配信した。
- [x] Build設定計画とPR head CI successを確認し、Build/Deploy SHA guardを `f0f4ee753c305c59f4c5efcdced7d4d14d7821d3` に更新した。staging専用refを同SHAへfast-forwardしてWorkers Buildを起動し、run `78471160-5e0e-4b93-8f9f-8a7fc111daaa` のcheckout SHA/全段階successをread-backした。
- [x] 応募者役の合成identity 1件は所有者指定後にstaging allowlistへ設定したとIssue #647に記録。Cloudflareではsecret名だけをread-backし、値を表示・記録しない。
- [ ] manager/reviewer役には応募者役と別のGoogle identityを使う。正確なemailの所有者承認後にだけallowlistへ追加し、他のrole accountを同時に追加しない。
- [ ] role別OAuth受入には、同じ人の別名ではなく、別々のGoogle identityを持つstaging専用synthetic accountを2件使う。member役とAtlas project manager/reviewer役を分け、両方の正確なemailが明示承認された場合だけstaging allowlistへ追加する。account情報はこのrepositoryへ記録しない。
- [ ] Build設定、OAuth callback、cookie domain、CORS、redirect allowlistをstaging専用でread-back確認する。
- [x] Build run/checkout SHA、公開build-info、Worker名・Version・100%配信、D1 bindingをread-onlyで再取得。staging D1 migration ledgerもread-back済み。想定SHA/workerとの不一致なし。
- [x] staging D1の0141/0144適用状態をread-back照合。0144はbackup/隔離restore後に適用済み。
- [x] production D1の0141は所有者承認、backup、isolated restore後に適用・read-back済み。staging受入の完了とは別に扱う。
- [x] main由来0140を含めstaging専用D1のmigration ledgerをread-onlyで再確認し、未適用migrationなし。

## 2. stagingの分離確認と配信

- [x] staging専用Workerとreports用D1 bindingを確認。Build branch/SHA guardは `codex/staging-intake-649` / `f0f4ee75` に整合し、run `78471160`、Version `dbf58dc9`、100%配信、build-info、専用D1 bindingをread-backした。
- [x] runtime候補Build後にrun/checkout SHA、Build/Deploy、Worker Version、100%配信、build-info、staging D1 bindingを照合した。
- [ ] staging origin、OAuth callback、cookie domain、CORS、redirect allowlistがstaging専用で一致することを確認する。
- [x] production比較値をCloudflare Build環境からstaging isolation preflightへ与えた。値はrepository、PR、Issueへ保存しない。
- [ ] Discord staging runtime guard用のproduction比較secret名をstaging Workerでread-backする。どちらかが未設定ならstaging Discordを有効化しない。
- [x] release staging用D1と既存staging D1が異なることをread-onlyで照合し、isolation preflight成功を確認した。
- [x] Issue #647の応募者受入記録で、所有者指定の合成identityをstaging allowlistへ設定したことを確認。Cloudflare設定ではsecret名のみread-backし、値は暗号化されたまま扱う。
- [ ] manager/reviewer用の別identityを所有者が指定するまで追加しない。指定後は既存の応募者役と明示承認済みのmanager/reviewer役だけをstaging専用allowlistへ残し、role scopeを受入する。
- [x] exact code commit SHA `e9b40d3f284577a0af652e9d180ed2fcc4d4594b` のno-Cron dry-runが成功。
- [x] candidate Build後にrun/checkout SHA、Build/Deploy、Worker Version、100%配信、build-info、staging D1 bindingを照合した。
- [ ] Resend sandboxとDiscord test guildのcredential、送信先、停止方法をread-backする。未設定・未承認の通知は送らない。
- [x] Workerのemail/Discord deliveryがdisabled、Cron triggerなしをread-back確認。sandboxの受信確認前に有効化しない。
- [ ] `ADMIN_APPLICATION_INTAKE_MODE` の `open → paused → open` をstagingで演習し、応募profile・同一origin応募・公開取り込みがpaused時にすべて503となり、D1未更新、応募フォーム案内、Worker Versionを記録する。既存queue/Cron/通知はこのスイッチの対象外として別手順を確認する。

## 3. role別の実操作

synthetic accountだけを使い、以下をstagingで実行する。

role scopeの受入スクリプトは2つの別identityで実行する。member役は応募一覧・他project情報を閲覧できず、manager/reviewer役は割り当てられたproject内だけを閲覧できることをそれぞれ確認する。どちらかのidentityまたは権限設定が不足している場合は、未実施のまま記録して実利用者アカウントへ置き換えない。

- [ ] 未ログイン: 保護ページ/API拒否と応募公開部分の利用可否を確認する。OAuth account chooser表示だけでは認証ガード受入を完了扱いしない。
- [ ] 応募者: 入力、確認、再ログイン、応募状態表示、誤入力と二重送信を確認する。
- [ ] reviewer: 応募詳細、承認/却下、理由、権限外API拒否、監査履歴を確認する。
- [ ] member: 初回ログイン、所属、許可されたタスク/記事操作、権限外の変更拒否を確認する。
- [ ] operator/admin: member招待、role変更、停止/復帰、監査記録、エラー回復を確認する。
- [ ] 通知は承認済みsandboxの受信確認後にだけ有効化し、重複送信と失敗時の再試行を確認する。

## 4. 運営引継ぎと本番判断

- [ ] 問い合わせ窓口、主担当/代理、応募対応期限、日次queue確認、緊急停止/復旧手順を決める。
- [ ] 個人情報の保持期間と削除基準を責任者が承認し、公開説明に反映する。OPSD-03は未承認で、180日は候補値。定期処理は `deleteTerminalApplications: false` で終端応募の自動削除を停止している。承認・公開説明・backup削除時期の照合前に有効化しない。
- [ ] D1 backupの復元、整合性、RPO/RTOを隔離環境で実測する。
- [ ] 全ゲートの証跡と担当者が揃った後に本番GOを記録する。未完了ならPR #649をmergeせず、実利用者を招待しない。
