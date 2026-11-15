# Agent向け実装・検証基盤

この文書は、既存の管理機能の品質を保ちながら、コード構造と実行可能な検証で危険な変更を早く検出するための仕組みをまとめる。Cloudflareの本番Worker、Production設定、本番D1には変更を加えない。

## 繰り返し現れた不具合パターン

| 確認できる証拠                                                                                                                                                                                                                           | 防止・検出方法                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| プロジェクト担当者の権限を扱う既存テストが、別プロジェクトの操作拒否とAtlas所属のない担当者の操作を検証する（`tests/unit/admin-project-member-access.test.ts`、`tests/unit/admin-worker-auth.test.ts`）                                  | ADMIN APIは共通ポリシーで認証境界を決め、未知のAPIやメソッドは管理者スコープに倒す。参加者向け例外はパス・メソッドのallowlistだけで認める。         |
| 複数テーブル更新と再送の整合性を扱う既存テストがある（`tests/unit/admin-workflow-atomicity.test.ts`）                                                                                                                                    | 既存のD1バッチ・idempotency実装を維持し、API境界と状態遷移のテストを実行する。今回追加した公開状態モデルは同一キー再試行を明示的に探索する。        |
| 遅れて到着した応答によるUIの巻き戻りを防ぐ既存テストがある（`tests/e2e/admin-calendar.spec.ts`、`tests/e2e/admin-publication-runs.spec.ts`）。履歴にも古い状態の通知・一覧を修正したcommitがある（`ce769c6d`、`0a4c9d3a`、`7a44eacd`）。 | 実ブラウザー操作で古い応答を破棄するJourneyを実行し、Console Errorと失敗時Traceを保存する。                                                         |
| 記事編集から離れた後に遅い新規保存が完了すると、旧画面の応答が現在のURLを書き換えることを`tests/e2e/admin-editor-workspace.spec.ts`で再現した。                                                                                          | Astroの画面遷移時に自動保存を中断し、記事読込世代も無効化する。遅延応答テストを全E2Eで実行する。                                                    |
| 記事編集のE2Eが外部originを遮断したとき、CodeMirrorが`esm.sh`から読み込めずエディタ一式が失敗した。                                                                                                                                      | CodeMirrorをnpm依存としてAstroのローカルバンドルへ移し、検証環境で外部CDNを必要としないようにする。                                                 |
| 公開確認後にD1文書が更新される競合をWorkerの実行テストで確認する。                                                                                                                                                                       | `updated_at` compare-and-setが0件なら`needs_operator`へ遷移し、公開完了にしない。ESLint AST guardとD1アダプターを使うWorkerテストの両方で確認する。 |

予防的な候補として、記事の権限・データ境界、二重操作、非同期応答の順序、D1への直接書き込みを、担当画面ごとの実装に任せず、既存の共通入口と状態遷移へ寄せていく。デプロイ先とmainの不一致は、既存の`verify:deploy-config`、`verify:build-info`、Workers Buildsの運用規則で引き続き検証する。

## Architecture Guards

`eslint.config.mjs`で有効にしているASTベースのGuard:

1. `handleAdminRequest`は、`/api/admin/*`のdispatch前に共通アクセス方針を解決・適用する。
2. 管理者、参加者、プロフィールのポリシーを、それぞれ対応するスコープ関数へ渡す。
3. 参加者向けAPIの例外は明示allowlistに限定し、未知の管理APIは管理者スコープにする。
4. 記事公開のD1更新は`id`と`updated_at`の両方でcompare-and-setし、競合を公開失敗として記録する。

`tests/unit/architecture-eslint-guards.test.ts`で各Guardについて正常例はLint成功、違反例・必要な関数の欠落はLint失敗を確認する。管理APIの実リクエストとD1の公開競合は別のWorkerテストでも検証する。Astroテンプレートには`eslint-plugin-astro`推奨ルールを適用する。

## ローカルJourneyと証拠

詳細な起動・診断・操作・証拠・終了方法は[verify-atlasez Skill](../.cursor/skills/verify-atlasez/SKILL.md)に記載する。少なくとも次の6Journeyを固定Fixtureで実行できる。

- ポータル、記事の保存と再読み込み、公開一覧の非同期応答
- 参加者タスク、カレンダーの月移動、権限プレビュー

JourneyはローカルのADMINビルドとPlaywrightを使い、APIのFixtureをページ内で提供する。認証情報を使わず、外部originへのブラウザー通信を遮断する。Cloudflare、GitHub API、メール、Discord、本番D1には接続しない。証拠にはPlaywright JSON、失敗時のスクリーンショットとTrace、Console Error、build SHAが含まれる。

## CI検証成果物

`.github/workflows/ci.yml`は、既存のdeploy-config・型・Lint・Format・Unit・build-info・E2E検証に、公開状態モデルとLighthouseを加える。Lighthouse測定と品質判定は独立したステップで実行する。現行サイトの計測ベースラインではアクセシビリティは1.00、性能はトップページ1.00・記事ページ0.94だったため、アクセシビリティは0.95以上をエラー、性能・best-practices・SEOは0.90未満を警告とする。測定失敗はステップ失敗のまま残す。個別の既定auditを`|| true`で無視しない。

PRごとに`verification-<run id>-<attempt>` Artifactを作成し、summary、Playwright結果、Lighthouse測定、プレビュー起動ログを14日保存する。`verification-artifacts/`等の出力はGitにコミットしない。

## 公開状態モデル

`npm run verify:publication-model`は深さ10の有限状態探索を実行する。現行モデルでは114状態・912遷移を調べ、未承認公開、古い版の上書き、同一キーでの二重Run、キャンセル後の公開、compare-and-set競合時の公開確定を検査する。

このモデルは`src/admin-worker.ts`の`progressEditorialPublicationRun`による初回記事公開の承認版・`updated_at` compare-and-setを抽象化する。GitHub PR、Actions、Workers Builds、ネットワーク障害全体をモデル化したものではなく、実Workerの正しさの証明ではない。公開Runの状態やトランザクションを変更した場合は、モデルと`tests/unit/admin-publication-safety.test.ts`を合わせて更新する。

## Agent修正フローとリリース境界

`npm run agent:fix -- reproduce <test>`で再現テストを記録し、`npm run agent:fix -- verify [--journey <name>]`でローカル検証を順に実行する。すべて成功した非mainブランチでは`npm run agent:fix -- draft-pr --title "..." --description "..."`からDraft PRを作成できる。ログ・実行結果は`verification-artifacts/agent-fix/`に保存する。

この仕組みはDraft PR作成までで止まる。Merge・本番Worker更新・D1 migrationは行わず、既存のデプロイポリシーと人間のレビューに委ねる。

## 残存する依存関係リスク

実装検証時の`npm audit --omit=dev`は5件（moderate 1件、low 4件）を報告した。対象はAstro、`date-holidays`経由の`deepmerge`、`fast-xml-parser`で、CodeMirror依存からの報告ではない。`date-holidays`の自動修正は破壊的なメジャー変更を提案するため、この作業では依存更新を混在させず、専用の依存更新PRで互換性を確認する。
