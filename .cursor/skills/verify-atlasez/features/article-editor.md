# 記事編集・保存・再読み込み

- **目的:** 新しい記事の入力が自動保存され、再読込後も同じ原稿に戻ることを確認する。
- **画面:** /admin/editor/?new=1
- **起動:** npm run agent:verify -- run article-editor
- **Fixture:** admin-editor-workspace.spec.tsが文書一覧、作成、更新、取得、版履歴APIを状態保持するブラウザ内Fixtureに置き換える。作成・更新された本文と題名だけをFixtureのメモリに保存する。
- **操作:** 新規記事を開き、題名と本文を入力し、自動保存表示を確認して画面を再読込する。
- **成功条件:** 作成ID付きURLになり、自動保存が完了し、再読込後に題名と本文が復元される。
- **失敗条件:** 入力が消える、別記事へ保存される、保存中の表示が残る、予期しない外部リクエストが発生する。
- **状態検査:** POST/PATCHのFixture状態と、再読込後の入力値を比較する。本番D1には接続しない。
- **証拠:** Playwright JSON、Console Error、遮断した外部origin。失敗時はスクリーンショットとTrace。
- **再現テスト:** tests/e2e/admin-editor-workspace.spec.ts の「新規原稿の自動保存内容は再読み込み後も復元できる」。
