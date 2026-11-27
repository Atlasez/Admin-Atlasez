# ADMINメンバー受入 staging checklist

更新日: 2026-11-27

状態: 実装候補をmainへ統合中。実ユーザーを招待する前に、以下を順に完了して結果をreadiness issueへ記録する。

## 1. コードとCI

- [ ] mainをbaseにしたPRを作成し、最新commitの必須CI/E2Eが成功する。
- [ ] アーカイブ申請はmainの承認フローを使う。別の削除migrationをこの受入PRへ混ぜない。
- [ ] migration 0141_application_intake_reconciliation.sqlは現行D1履歴との順序を再確認し、本番にはまだ適用しない。
- [ ] secrets、OAuth client secret、API token、実ユーザー情報をcommitやIssueへ書かない。

## 2. stagingの分離確認

- [ ] staging Worker、D1、OAuth clientを専用資源として選び、名前とD1 bindingの対応をread-onlyで確認する。
- [ ] staging origin、OAuth callback、cookie domain、CORS、redirect allowlistがstaging専用で一致する。
- [ ] メール送信とDiscord連携は初期状態でdisabled。実際のsandbox通知先を承認した場合だけ段階的に有効化する。
- [ ] production比較値は次の環境変数から読み込む。値はrepository、PR、Issueへ保存しない: ATLASEZ_PRODUCTION_ADMIN_ORIGIN、ATLASEZ_PRODUCTION_D1_NAME、ATLASEZ_PRODUCTION_D1_ID、ATLASEZ_PRODUCTION_DISCORD_GUILD_ID、ATLASEZ_PRODUCTION_DISCORD_CLIENT_ID。
- [ ] release stagingを使う場合は既存staging D1との重複を避けるためATLASEZ_EXISTING_STAGING_D1_IDも外部環境から渡す。
- [ ] exact commit SHAをデプロイ確認用の環境変数へ設定し、dry-runとread-back結果を記録する。

## 3. role別の実操作

synthetic accountだけを使い、以下をstagingで実行する。

- [ ] 未ログイン: 保護ページ/APIを読めず、応募公開部分だけ利用できる。
- [ ] 応募者: 入力、確認、再ログイン、応募状態表示、誤入力と二重送信を確認する。
- [ ] reviewer: 応募詳細、承認/却下、理由、権限外API拒否、監査履歴を確認する。
- [ ] member: 初回ログイン、所属、許可されたタスク/記事操作、権限外の変更拒否を確認する。
- [ ] operator/admin: member招待、role変更、停止/復帰、監査記録、エラー回復を確認する。
- [ ] メール/Discordはsandboxの受信確認後にだけ有効化し、重複送信と失敗時の再試行を確認する。

## 4. 運営引継ぎと本番判断

- [ ] 問い合わせ窓口、主担当/代理、応募対応期限、日次queue確認、緊急停止/復旧手順を決める。
- [ ] 個人情報の保持期間と削除基準を責任者が承認し、公開説明に反映する。
- [ ] D1 backupの復元、整合性、RPO/RTOを隔離環境で実測する。
- [ ] 本番migrationは現行履歴・backup・復元結果を確認後、D1所有者が明示承認した別作業で適用する。
- [ ] 全ゲートの証跡と担当者が揃った後に本番GOを記録する。未完了なら招待を開始しない。
