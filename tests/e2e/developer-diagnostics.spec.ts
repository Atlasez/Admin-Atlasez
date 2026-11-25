import { expect, test, type Page } from "@playwright/test";

const mockSession = async (page: Page) => {
  await page.route("**/api/admin/auth-status", (route) =>
    route.fulfill({ json: { email: "admin@example.com", isManager: true } }),
  );
  await page.route("**/api/admin/notifications", (route) =>
    route.fulfill({ json: { notifications: [] } }),
  );
};

const jobRecord = (
  id: string,
  label: string,
  status: string,
  detail: string,
) => ({
  id,
  label,
  ownerRole: "開発担当",
  scheduleLabel: "1分ごと",
  status,
  detail,
  lastStartedAt: "2026-11-25T01:00:00.000Z",
  lastFinishedAt: "2026-11-25T01:00:02.000Z",
  lastSucceededAt: "2026-11-25T01:00:02.000Z",
  lastFailedAt: null as string | null,
  consecutiveFailures: 0,
  lastDurationMs: 2000,
  lastErrorCode: null as string | null,
});

const monitoringResponse = () => ({
  generatedAt: "2026-11-25T01:01:00.000Z",
  prototypeAccess: true,
  checks: [
    {
      id: "database",
      label: "運用データベース",
      status: "ok",
      detail: "接続できています",
    },
  ],
  scheduledJobs: {
    available: true,
    generatedAt: "2026-11-25T01:01:00.000Z",
    jobs: [
      jobRecord(
        "publication",
        "公開状態の照合",
        "ok",
        "直近の処理は成功しました",
      ),
      {
        ...jobRecord(
          "mail",
          "メール処理",
          "error",
          "メール処理が連続して失敗しています",
        ),
        lastFailedAt: "2026-11-25T01:00:02.000Z",
        consecutiveFailures: 3,
        lastErrorCode: "delivery_failed",
      },
      jobRecord(
        "discord",
        "Discord同期",
        "warning",
        "必要な設定が不足しています",
      ),
      jobRecord(
        "backup",
        "記事バックアップ",
        "running",
        "処理を実行しています",
      ),
    ],
  },
  queues: [
    {
      id: "publication",
      label: "記事公開",
      ownerRole: "開発担当・記事公開担当",
      status: "warning",
      detail: "作成から30分以上経過した未完了処理があります",
      pendingCount: 4,
      retryCount: 2,
      failedCount: 1,
      oldestPendingAt: "2026-11-25T00:21:00.000Z",
      oldestPendingAgeMs: 2_400_000,
    },
    {
      id: "mail",
      label: "メール配送",
      ownerRole: "開発担当",
      status: "unknown",
      detail: "配送キューを取得できません",
      pendingCount: null,
      retryCount: null,
      failedCount: null,
      oldestPendingAt: null,
      oldestPendingAgeMs: null,
    },
  ],
});

test("開発者向け診断は状態を一覧表示し、再確認できる", async ({ page }) => {
  await page.route("**/api/admin/auth-status", (route) =>
    route.fulfill({ json: { email: "admin@example.com", isManager: true } }),
  );
  await page.route("**/api/admin/notifications", (route) =>
    route.fulfill({ json: { notifications: [] } }),
  );
  let requests = 0;
  await page.route("**/api/admin/developer/diagnostics", async (route) => {
    requests += 1;
    await route.fulfill({
      json: {
        generatedAt: "2026-09-10T00:00:00.000Z",
        build: { commit: "test-sha" },
        prototypeAccess: true,
        checks: [
          {
            id: "database",
            label: "運用データベース",
            status: "ok",
            detail: "接続できています",
            durationMs: 2,
          },
          {
            id: "schema",
            label: "管理データのスキーマ",
            status: "warning",
            detail: "未適用のテーブルがあります",
          },
        ],
      },
    });
  });

  await page.goto("admin/developer/?mode=developer");
  await expect(
    page.getByRole("heading", { name: "開発者モード" }),
  ).toBeVisible();
  await expect(page.getByText("運用データベース")).toBeVisible();
  await expect(page.getByText("正常")).toBeVisible();
  await expect(page.getByText("確認が必要")).toBeVisible();
  await expect(page.getByText("2ms")).toBeVisible();
  await expect(page.locator("[data-scheduled-state]")).toContainText(
    "監視データ未取得",
  );
  await expect(page.locator("[data-queue-state]")).toContainText(
    "監視データ未取得",
  );
  await expect(page.locator("[data-scheduled-jobs]")).toBeHidden();
  await expect(page.getByRole("link", { name: "操作履歴" })).toHaveAttribute(
    "href",
    "/admin/audit-log/",
  );
  await expect(
    page.getByRole("link", { name: "状態遷移・整合性" }),
  ).toHaveAttribute("href", "/admin/workflow/");
  await expect(
    page.getByRole("link", { name: "XAI UIプロトタイプ" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "ポータル UIプロトタイプ" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "ログイン・エラー画面案" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "運営UIレビュー" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "再確認" }).click();
  await expect.poll(() => requests).toBe(2);
});

test("定期処理の未確認から成功・失敗・設定不足・実行中へ更新し、キューの滞留を区別する", async ({
  page,
}) => {
  await mockSession(page);
  let requests = 0;
  await page.route("**/api/admin/developer/diagnostics", (route) => {
    requests += 1;
    const data = monitoringResponse();
    if (requests === 1) {
      return route.fulfill({
        json: {
          ...data,
          scheduledJobs: {
            ...data.scheduledJobs,
            jobs: data.scheduledJobs.jobs.map((job) => ({
              ...job,
              status: "unknown",
              detail: "まだ実行記録がありません",
              lastStartedAt: null,
              lastFinishedAt: null,
              lastSucceededAt: null,
              lastFailedAt: null,
              lastDurationMs: null,
              lastErrorCode: null,
              consecutiveFailures: 0,
            })),
          },
        },
      });
    }
    return route.fulfill({ json: data });
  });

  await page.goto("admin/developer/?mode=developer");
  const jobs = page.locator("[data-scheduled-jobs]");
  await expect(jobs.locator('[data-status="unknown"]')).toHaveCount(4);
  await expect(jobs.locator('[data-status="ok"]')).toHaveCount(0);
  await expect(jobs.getByText("記録なし").first()).toBeVisible();
  await page.getByRole("button", { name: "再確認", exact: true }).click();

  const publication = jobs.locator('[data-monitoring-id="publication"]');
  await expect(publication.locator('[data-status="ok"]')).toHaveText("正常");
  await expect(publication.getByText("確認先（役割）")).toBeVisible();
  await expect(
    publication.getByText("開発担当", { exact: true }),
  ).toBeVisible();
  await expect(publication.locator("time").first()).toHaveAttribute(
    "datetime",
    "2026-11-25T01:00:00.000Z",
  );
  await expect(
    jobs.locator('[data-monitoring-id="mail"] [data-status="error"]'),
  ).toHaveText("エラー");
  await expect(jobs.getByText("3回", { exact: true })).toBeVisible();
  await expect(
    jobs.getByText("delivery_failed", { exact: true }),
  ).toBeVisible();
  await expect(
    jobs.locator('[data-monitoring-id="discord"] [data-status="warning"]'),
  ).toHaveText("確認が必要");
  await expect(jobs.getByText("必要な設定が不足しています")).toBeVisible();
  await expect(
    jobs.locator('[data-monitoring-id="backup"] [data-status="running"]'),
  ).toHaveText("実行中");

  const queue = page.locator(
    '[data-scheduled-queues] [data-monitoring-id="publication"]',
  );
  await expect(queue.locator('[data-status="warning"]')).toBeVisible();
  await expect(queue.getByText("4件", { exact: true })).toBeVisible();
  await expect(
    queue.getByText("うち再試行待ち", { exact: true }),
  ).toBeVisible();
  await expect(
    queue.getByText("要対応（24時間）", { exact: true }),
  ).toBeVisible();
  await expect(queue.getByText("40分", { exact: true })).toBeVisible();
  const unavailableQueue = page.locator(
    '[data-scheduled-queues] [data-monitoring-id="mail"]',
  );
  await expect(unavailableQueue.locator('[data-status="unknown"]')).toHaveText(
    "未確認",
  );
  await expect(
    unavailableQueue.getByText("未取得", { exact: true }),
  ).toHaveCount(3);
  await expect(page.locator("[data-monitoring-timezone]")).toContainText(
    "端末のタイムゾーン",
  );
  await expect(page.getByText(/外部サービスでの到達は別途確認/)).toBeVisible();
});

test("監視記録を取得できない場合は正常なカードを表示しない", async ({
  page,
}) => {
  await mockSession(page);
  const data = monitoringResponse();
  data.scheduledJobs.available = false;
  await page.route("**/api/admin/developer/diagnostics", (route) =>
    route.fulfill({ json: data }),
  );

  await page.goto("admin/developer/?mode=developer");
  await expect(page.locator("[data-scheduled-state]")).toHaveText(
    "監視データ未取得。定期処理の実行結果を確認できていません。",
  );
  await expect(page.locator("[data-scheduled-jobs]")).toBeHidden();
  await expect(
    page.locator('[data-scheduled-jobs] [data-status="ok"]'),
  ).toHaveCount(0);
  await expect(page.locator("[data-scheduled-queues]")).toBeVisible();
});

test("再確認に失敗すると古い正常結果と権限付きリンクを隠し、再試行で復旧する", async ({
  page,
}) => {
  await mockSession(page);
  let requests = 0;
  await page.route("**/api/admin/developer/diagnostics", (route) => {
    requests += 1;
    return requests === 2
      ? route.fulfill({
          status: 503,
          json: { error: "診断の接続確認に失敗しました" },
        })
      : route.fulfill({ json: monitoringResponse() });
  });

  await page.goto("admin/developer/?mode=developer");
  await expect(
    page.locator('[data-scheduled-jobs] [data-status="ok"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "XAI UIプロトタイプ" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "再確認", exact: true }).click();
  await expect(page.locator("[data-admin-load-error]")).toContainText(
    "診断の接続確認に失敗しました",
  );
  await expect(page.locator("[data-scheduled-state]")).toContainText(
    "最新の状態を確認できません",
  );
  await expect(page.locator("[data-queue-state]")).toContainText(
    "最新の状態を確認できません",
  );
  await expect(page.locator("[data-diagnostic-list]")).toBeHidden();
  await expect(page.locator("[data-scheduled-jobs]")).toBeHidden();
  await expect(page.locator("[data-scheduled-queues]")).toBeHidden();
  await expect(page.locator('[data-status="ok"]')).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "XAI UIプロトタイプ" }),
  ).toBeHidden();
  await expect(page.locator("[data-developer-page]")).toHaveAttribute(
    "data-admin-load-state",
    "error",
  );

  await page.getByRole("button", { name: "再試行", exact: true }).click();
  await expect(
    page.locator('[data-scheduled-jobs] [data-status="ok"]'),
  ).toBeVisible();
  await expect(page.locator("[data-admin-load-error]")).toBeHidden();
  await expect(page.locator("[data-developer-page]")).toHaveAttribute(
    "data-admin-load-state",
    "ready",
  );
});

test("診断APIの権限拒否を表示し、監視結果や試作リンクを表示しない", async ({
  page,
}) => {
  await mockSession(page);
  await page.route("**/api/admin/developer/diagnostics", (route) =>
    route.fulfill({ status: 403, json: { error: "開発者権限が必要です。" } }),
  );

  await page.goto("admin/developer/?mode=developer");
  await expect(page.locator("[data-admin-load-error]")).toContainText(
    "開発者権限が必要です。",
  );
  await expect(page.locator("[data-scheduled-state]")).toContainText(
    "監視データ未取得",
  );
  await expect(page.locator("[data-scheduled-jobs]")).toBeHidden();
  await expect(page.locator("[data-scheduled-queues]")).toBeHidden();
  await expect(page.locator('[data-status="ok"]')).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "XAI UIプロトタイプ" }),
  ).toBeHidden();
});

test("診断内容と監視詳細はHTMLとして解釈しない", async ({ page }) => {
  await mockSession(page);
  const data = monitoringResponse();
  const unsafe = '<img src="x" onerror="document.body.dataset.injected=1">';
  data.checks[0].detail = unsafe;
  data.scheduledJobs.jobs[0].label = unsafe;
  data.scheduledJobs.jobs[0].detail =
    "<script>document.body.dataset.injected=1</script>";
  data.scheduledJobs.jobs[0].lastErrorCode = unsafe;
  data.queues[0].detail = unsafe;
  data.queues[0].ownerRole = unsafe;
  await page.route("**/api/admin/developer/diagnostics", (route) =>
    route.fulfill({ json: data }),
  );

  await page.goto("admin/developer/?mode=developer");
  await expect(
    page.locator("[data-diagnostic-list]").getByText(unsafe, { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-scheduled-jobs] [data-monitoring-id="publication"] h3'),
  ).toHaveText(unsafe);
  await expect(
    page.locator(
      '[data-scheduled-queues] [data-monitoring-id="publication"] .monitoring-card-detail',
    ),
  ).toHaveText(unsafe);
  await expect(
    page.locator(
      "[data-scheduled-jobs] img, [data-scheduled-jobs] script, [data-scheduled-queues] img, [data-diagnostic-list] img",
    ),
  ).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-injected", "1");
});

test("390px幅でも長いエラーコードや時刻を横にはみ出さず読める", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSession(page);
  const data = monitoringResponse();
  data.scheduledJobs.jobs[1].lastErrorCode = `delivery_${"failure".repeat(40)}`;
  data.queues[0].detail = `確認対象：${"pending".repeat(35)}`;
  await page.route("**/api/admin/developer/diagnostics", (route) =>
    route.fulfill({ json: data }),
  );

  await page.goto("admin/developer/?mode=developer");
  await expect(
    page.locator("[data-scheduled-jobs] .monitoring-card"),
  ).toHaveCount(4);
  await expect(
    page.locator("[data-scheduled-queues] .monitoring-card"),
  ).toHaveCount(2);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  for (const card of await page.locator(".monitoring-card").all()) {
    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
});

test("主管理者でない場合は試作ページへのリンクを表示しない", async ({
  page,
}) => {
  await page.route("**/api/admin/auth-status", (route) =>
    route.fulfill({ json: { email: "manager@example.com", isManager: true } }),
  );
  await page.route("**/api/admin/notifications", (route) =>
    route.fulfill({ json: { notifications: [] } }),
  );
  await page.route("**/api/admin/developer/diagnostics", (route) =>
    route.fulfill({
      json: {
        prototypeAccess: false,
        generatedAt: "2026-09-10T00:00:00.000Z",
        checks: [],
      },
    }),
  );

  await page.goto("admin/developer/?mode=developer");
  await expect(page.getByText(/最終確認：/)).toBeVisible();
  const prototypeLinks = page.locator("[data-prototype-link]");
  await expect(prototypeLinks).toHaveCount(4);
  await expect(
    prototypeLinks.filter({ hasText: "XAI UIプロトタイプ" }),
  ).toBeHidden();
  await expect(
    prototypeLinks.filter({ hasText: "ポータル UIプロトタイプ" }),
  ).toBeHidden();
  await expect(
    prototypeLinks.filter({ hasText: "ログイン・エラー画面案" }),
  ).toBeHidden();
  await expect(
    prototypeLinks.filter({ hasText: "運営UIレビュー" }),
  ).toBeHidden();
});
