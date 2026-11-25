# 公開サイトの記事公開チェックリスト

公開サイトの正本は `Atlasez/Atlasez01` の `main`、本番Workerは `atlasez01`、公開URLは
`https://atlasez.org` と `https://www.atlasez.org` です。本番配信はCloudflare Workers Buildsに一本化し、
GitHub Actions、Pages、ローカルからの直接deployを本番配信と扱いません。

記事公開は公開専用GitHub AppがPRを作成し、CI成功後にmainへ取り込みます。Workers Builds内の
`npm run deploy:production` は候補Versionのアップロード、候補内容のD1記録、候補Versionの100%配信、
公開履歴のD1記録の順に処理します。候補内容の記録が失敗したときは配信を切り替えません。
切替後の履歴記録が失敗したときはADMIN Workerが有効VersionとD1候補記録を照合して補修します。

## 1. 記事を査読に出す

1. [`ADDING_ARTICLES.md`](ADDING_ARTICLES.md) と
   [`EDITORIAL_WORKFLOW.md`](EDITORIAL_WORKFLOW.md) に従い記事を作成します。
2. ローカルで下書きと公開後の表示を確認し、内容・引用・ライセンス・参照リンクを担当者が確認します。
3. 内容確認と公開判断が終わるまで `status: draft` または `status: in-review` を保ちます。
   これらは本番ビルドから除外されます。
4. 公開判断後にだけ `status: published` とし、対象記事、URL、概念・前提関係への影響をPR本文に記録します。
5. CI成功と通常のPR手順での確認後に `Atlasez/Atlasez01` の `main` へ反映します。
   required approving reviewsの設定は変更しません。

## 2. 本番反映を確認する

Workers Buildsの対象main SHA、候補登録、Cloudflare Versionを照合します。Build失敗、候補D1保存失敗、
SHA不一致、WorkerやVersionの不一致がある場合は配信完了とせず、原因を記録して担当者へ引き継ぎます。
別経路のdeployで埋め合わせません。

公開完了とする前に、次を確認してPRまたは運用記録へ残します。

- GitHub CIが成功し、Workers Buildsが対象のmain SHAを処理してDeployまで成功した。
- D1候補記録にmain SHA・Cloudflare Version ID・記事ID・記事版IDが保存された。
- CloudflareのDeployment/VersionでWorker `atlasez01`、同じVersion ID、配信率100%を確認した。
- D1公開履歴にCloudflare Version IDとDeployment IDが保存され、記事ごとの公開版IDが一致した。
- `https://atlasez.org/build-info.json` のcommit SHAが対象main SHAと一致した。
- 公開トップ、記事、検索、学習地図、数式を認証済みChromeで確認した。
- 公開記事URL、確認時刻、確認者、対象SHAを記録した。

`build-info.json`欠落、Source不明、画面異常、SHA/Version不一致があれば公開完了とせず、
状況を記録して担当者へ引き継ぎます。推測でrollback、Version promote、cache purge、Route変更を行いません。

## 3. 訂正と非公開化

訂正は承認済み原稿から差分を作り、理由、影響する記事・リンク、旧版との関係をPRに記録します。
本番の公開本文を直接書き換えません。

記事を非公開にする場合は、理由、対象URL、参照元記事・概念グラフ・検索への影響、復旧方法を確認します。
`status: draft`または`status: in-review`へ変更してPRを作り、CI、通常のPR確認、main反映後のWorker配信、
公開URL・一覧・検索からの除外を確認します。履歴を残し、影響を調べずに削除しません。

## 4. 閲覧者向け確認

- トップ `/` と学習サイト `/atlas/ja/` が開く。
- 公開記事URLが正しく表示され、確認した版と一致する。
- 検索 `/atlas/ja/search/` と学習地図 `/atlas/ja/map/` に公開状態が反映される。
- `/robots.txt` と sitemap が `atlasez.org` を指し、公開ページに意図しない `noindex` がない。
- PC幅と390px幅で横はみ出しがなく、数式やリンクが使用できる。

## 5. ローカル確認

記事のstatusを公開にせず、ローカル表示を確認できます。

```bash
npm ci
npm run dev
```

本番へ出す場合は、公開repositoryの現在の運用方針とWorkers Buildsの証拠を確認してください。
