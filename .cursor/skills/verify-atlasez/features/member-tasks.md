# 参加者タスク

- **目的:** タスク一覧を絞り込み、状態変更を送信して一覧へ反映できることを確認する。
- **画面:** /admin/action-center/ またはポータルのアクションセンター。
- **起動:** npm run agent:verify -- run member-tasks
- **Fixture:** admin-action-center.spec.tsのローカルルートFixtureがタスク、担当者、変更応答を返す。
- **操作:** アクションセンターを開き、状態または検索条件で絞り込み、タスク状態を変更する。
- **成功条件:** 条件に合う項目だけが残り、変更後の状態が画面に表示される。
- **失敗条件:** 無関係なタスクが混ざる、変更結果が遅い応答で戻る、Fixture外の通知・メールへ送信する。
- **状態検査:** 送信API payloadと更新後のDOMを照合する。テストFixture以外の永続化はない。
- **証拠:** JSONレポート、Console Error添付、外部origin遮断一覧。失敗時はスクリーンショットとTrace。
- **再現テスト:** tests/e2e/admin-action-center.spec.ts の「アクションセンターで絞り込みと状態変更を操作できる」。
