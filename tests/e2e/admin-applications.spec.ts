import { expect, test } from "@playwright/test";

for (const width of [1440, 800, 390]) {
  test(`応募管理は最新の応募者から開き、前へ・次へを隣接表示する（${width}px）`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    let newestId = "latest";
    await page.route("**/api/admin/**", async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        json:
          url.pathname === "/api/admin/applications"
            ? {
                applications: [
                  {
                    id: "old",
                    family_name: "山田",
                    given_name: "太郎",
                    status: "new",
                    created_at: "2026-09-01T09:00:00Z",
                  },
                  {
                    id: newestId,
                    family_name: "佐藤",
                    given_name: "花子",
                    status: "accepted",
                    created_at: "2026-09-04T09:00:00Z",
                  },
                  {
                    id: "middle",
                    family_name: "鈴木",
                    given_name: "次郎",
                    status: "reviewing",
                    created_at: "2026-09-03T09:00:00Z",
                  },
                  {
                    id: "undated",
                    family_name: "日時",
                    given_name: "未登録",
                    status: "new",
                  },
                ],
              }
            : {},
      });
    });
    await page.goto("./admin/applications/?project=atlas");
    const select = page.locator("[data-application-select]");
    const previous = page.getByRole("button", { name: "前の応募者" });
    const next = page.getByRole("button", { name: "次の応募者" });
    await expect(select).toHaveValue("latest");
    await expect(page.locator(".application-list h2")).toHaveText("佐藤 花子");
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();
    await page.locator("[data-application-navigator]").scrollIntoViewIfNeeded();
    const left = (await previous.boundingBox())!;
    const right = (await next.boundingBox())!;
    expect(Math.abs(left.y - right.y)).toBeLessThan(2);
    expect(right.x - (left.x + left.width)).toBeGreaterThanOrEqual(0);
    expect(right.x - (left.x + left.width)).toBeLessThanOrEqual(12);
    const picker = (await page.locator(".application-picker").boundingBox())!;
    const position = (await page
      .locator("[data-application-position]")
      .boundingBox())!;
    expect(
      position.x >= picker.x + picker.width ||
        position.y >= picker.y + picker.height,
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("applications-latest.png"),
    });
    await next.click();
    await expect(select).toHaveValue("middle");
    await previous.click();
    await expect(select).toHaveValue("latest");
    await select.selectOption("old");
    newestId = "new-arrival";
    await page.goto("./admin/applications/?project=atlas");
    await expect(select).toHaveValue("new-arrival");
    await page.locator("[data-filter-status]").selectOption("new");
    await expect(select).toHaveValue("old");
    await page.locator("[data-clear-filter]").click();
    await expect(select).toHaveValue("new-arrival");
  });
}

test("最初の50件にない応募者もURLから復元する", async ({ page }) => {
  const requestedId = "older-applicant";
  let requestedApplicant = false;
  const firstPage = Array.from({ length: 50 }, (_, index) => ({
    id: `recent-${index}`,
    family_name: "新しい",
    given_name: `応募者${index}`,
    email: `recent-${index}@example.test`,
    status: "new",
    created_at: "2026-09-05T09:00:00Z",
  }));
  const olderApplicant = {
    id: requestedId,
    family_name: "過去",
    given_name: "応募者",
    email: "older@example.test",
    status: "accepted",
    created_at: "2025-09-05T09:00:00Z",
  };
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/admin/applications") {
      await route.fulfill({ json: {} });
      return;
    }
    if (url.searchParams.get("applicationId") === requestedId) {
      requestedApplicant = true;
      await route.fulfill({ json: { applications: [olderApplicant] } });
      return;
    }
    if (url.searchParams.has("cursor")) {
      await route.fulfill({
        json: {
          applications: [],
          pagination: { hasMore: false, nextCursor: null },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        applications: firstPage,
        summary: { total: 51, new: 50, reviewing: 0, accepted: 1, rejected: 0 },
        pagination: { hasMore: true, nextCursor: "next-page" },
      },
    });
  });

  await page.goto(
    `./admin/applications/?project=atlas&application=${requestedId}`,
  );

  await expect(page.locator("[data-application-select]")).toHaveValue(
    requestedId,
  );
  await expect(page.locator(".application-list h2")).toHaveText("過去 応募者");
  expect(requestedApplicant).toBe(true);
  await expect(page).toHaveURL(new RegExp(`application=${requestedId}`));
});

test("B-1: 応募フロー・状況集計・検索と状態フィルターを表示する", async ({
  page,
}) => {
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/admin/applications")
      expect(url.searchParams.get("project")).toBe("atlas");
    const payload =
      url.pathname === "/api/admin/applications"
        ? {
            project: { slug: "atlas", name: "学習サイト「アトラス」" },
            subjectLabels: { mathematics: "数学", physics: "物理" },
            applications: [
              {
                id: "application-1",
                form_language: "ja",
                family_name: "山田",
                given_name: "太郎",
                email: "taro@example.com",
                affiliation_type: "大学",
                institution: "東京大学",
                grade: "学部1年",
                country: "JP",
                timezone: "Asia/Tokyo",
                desired_subjects: "mathematics",
                article_ideas: "群論",
                interests: "数学",
                message: "参加希望",
                project_slug: "atlas",
                status: "new",
                provisioning_status: "not_started",
              },
              {
                id: "application-2",
                form_language: "ja",
                family_name: "佐藤",
                given_name: "花子",
                email: "hanako@example.com",
                affiliation_type: "高校",
                institution: "Atlasez高校",
                grade: "高校2年",
                country: "JP",
                timezone: "Asia/Tokyo",
                desired_subjects: "physics",
                article_ideas: "力学",
                interests: "物理",
                message: "参加希望",
                project_slug: "atlas",
                status: "reviewing",
                provisioning_status: "pending",
              },
            ],
          }
        : {};
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  await page.goto("./admin/applications/?project=atlas");
  await expect(page.locator(".applications header p")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "学習サイト「アトラス」：応募管理" }),
  ).toBeVisible();
  await expect(page.locator(".project-switcher")).toHaveCount(0);
  await expect(page.locator(".flow-steps > li")).toHaveCount(4);
  await expect(page.locator(".flow-steps")).toContainText("受け入れを確定");
  await expect(page.locator(".summary-card--accepted")).toContainText(
    "受け入れ済み",
  );
  await expect(page.locator(".intake-link a")).toHaveText(
    "応募者・メンバーの連絡・準備記録を管理 →",
  );
  await expect(page.locator("[data-total-count]")).toHaveText("2件");
  await expect(page.locator("[data-summary-new]")).toHaveText("1");
  await expect(page.locator("[data-summary-reviewing]")).toHaveText("1");

  await page.locator("[data-search]").fill("東京大学");
  await expect(page.locator(".application-list .app")).toHaveCount(1);
  await expect(page.locator(".application-list")).toContainText("山田 太郎");

  await page.locator("[data-clear-filter]").click();
  await page.locator("[data-filter-status]").selectOption("reviewing");
  await expect(page.locator(".application-list .app")).toHaveCount(1);
  await expect(page.locator(".application-list")).toContainText("佐藤 花子");
});

test("面談画面の応募結果は受け入れ・見送りと表示する", async ({ page }) => {
  await page.route("**/api/admin/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path.endsWith("/interview")
        ? {
            application: {
              id: "application-1",
              name: "応募者",
              email: "applicant@example.test",
              status: "reviewing",
            },
            interview: {},
            review: { decision: "pending" },
            subjectLabels: { mathematics: "数学" },
          }
        : {},
    });
  });

  await page.goto(
    "admin/application-interview/?application=application-1&project=atlas",
  );

  await expect(
    page.getByRole("heading", { name: "担当分野と応募結果" }),
  ).toBeVisible();
  const result = page.locator("[data-decision]");
  await expect(result.locator('option[value="accepted"]')).toHaveText(
    "受け入れ",
  );
  await expect(result.locator('option[value="rejected"]')).toHaveText("見送り");
  await result.selectOption("accepted");
  await expect(page.locator("[data-confirm-wrap]")).toContainText(
    "受け入れを確定し",
  );
  await expect(page.locator(".review-form")).not.toContainText("採用");
});

test("応募メールの失敗理由を担当応募にだけ表示しメール内容は表示しない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    const application = {
      id: "application-with-failed-email",
      form_language: "ja",
      family_name: "検証",
      given_name: "応募者",
      email: "applicant@example.invalid",
      project_slug: "atlas",
      status: "new",
      email_deliveries: [
        {
          kind: "applicant_confirmation",
          total: 1,
          sent: 0,
          pending: 0,
          sending: 0,
          retry: 0,
          failed: 1,
          attemptCount: 5,
          nextAttemptAt: null,
          updatedAt: "2026-10-12T10:00:00.000Z",
          lastError: "provider_idempotency_window_expired",
          body: "PRIVATE_BODY",
          htmlBody: "PRIVATE_HTML",
        },
      ],
    };
    if (url.pathname.endsWith("/interview")) {
      await route.fulfill({
        json: {
          application: {
            id: application.id,
            name: "検証 応募者",
            email: application.email,
            status: application.status,
          },
          interview: null,
          review: null,
          subjectLabels: { mathematics: "数学" },
        },
      });
      return;
    }
    if (url.pathname === "/api/admin/member-intake") {
      await route.fulfill({ json: { entries: [], responsibleCandidates: [] } });
      return;
    }
    await route.fulfill({
      json:
        url.pathname === "/api/admin/applications"
          ? {
              applications: [application],
              subjectLabels: { mathematics: "数学" },
            }
          : {},
    });
  });
  await page.goto("./admin/applications/?project=atlas");
  await page.getByRole("link", { name: "応募者対応を開く →" }).click();
  const panel = page.locator('[aria-label="応募関連メールの状態"]');
  await panel.locator("summary").click();
  await expect(panel).toContainText("応募受付確認");
  await expect(panel).toContainText("要確認");
  await expect(panel).toContainText("自動再送を停止しました");
  await expect(panel).toContainText("Resend受付 0 / 1 件");
  await expect(panel).not.toContainText("PRIVATE_BODY");
  await expect(panel).not.toContainText("PRIVATE_HTML");
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(391);
});

test("応募管理の導線は現在のプロジェクトに引き継がれる", async ({ page }) => {
  await page.route("**/api/admin/auth-status", (route) =>
    route.fulfill({
      json: { email: "manager@example.com", isManager: true },
    }),
  );
  await page.goto("./admin/manage/?project=seminar-platform");
  await expect(page.locator("main header p")).toHaveText(
    "ゼミプラットフォーム",
  );
  await expect(
    page.locator('a[data-manager-only][href*="permissions"]'),
  ).toBeVisible();
  await expect(
    page.locator('a[data-manager-only][href*="permissions"] strong'),
  ).toHaveText("権限管理");
  await expect(
    page.locator('a[data-manager-only][href*="permissions"]'),
  ).toHaveAttribute("href", "/admin/permissions/?project=seminar-platform");
  await expect(
    page.locator('a[data-project-manager-only][href*="applications"]'),
  ).toHaveAttribute("href", "/admin/applications/?project=seminar-platform");
});

test("OAuth連携済みの受入応募はDiscord同期を再試行できる", async ({ page }) => {
  let provisioningStatus = "failed";
  let retryCalled = false;
  const application = {
    id: "11111111-1111-4111-8111-111111111111",
    form_language: "ja",
    family_name: "山田",
    given_name: "太郎",
    name: "山田 太郎",
    email: "taro@example.com",
    affiliation_type: "大学",
    institution: "東京大学",
    grade: "B1",
    country: "JP",
    timezone: "Asia/Tokyo",
    desired_subjects: "mathematics",
    project_slug: "atlas",
    status: "accepted",
    provisioning_status: provisioningStatus,
    provisioning_attempt_count: 1,
    provisioning_next_attempt_at: "2026-08-29T12:00:00.000Z",
    discord_oauth_connected_at: "2026-08-29T11:00:00.000Z",
    verified_discord_user_id: "123456789012345678",
  };
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/discord-retry")) {
      retryCalled = route.request().method() === "POST";
      provisioningStatus = "synced";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          provisioning: { status: "synced", warnings: [] },
        }),
      });
      return;
    }
    if (url.pathname.endsWith("/interview")) {
      await route.fulfill({
        json: {
          application: {
            id: application.id,
            name: application.name,
            email: application.email,
            status: application.status,
          },
          interview: null,
          review: null,
          subjectLabels: { mathematics: "数学" },
        },
      });
      return;
    }
    if (url.pathname === "/api/admin/member-intake") {
      await route.fulfill({ json: { entries: [], responsibleCandidates: [] } });
      return;
    }
    if (url.pathname === "/api/admin/applications") {
      await route.fulfill({
        json: {
          project: { slug: "atlas", name: "学習サイト「アトラス」" },
          subjectLabels: { mathematics: "数学" },
          formLabels: { atlas: "学習サイト「アトラス」" },
          applications: [
            { ...application, provisioning_status: provisioningStatus },
          ],
        },
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("./admin/applications/?project=atlas");
  await expect(page.locator("[data-retry]")).toHaveCount(0);
  await page.getByRole("link", { name: "応募者対応を開く →" }).click();
  await expect(page.locator(".application-meta-grid")).toContainText(
    "OAuth同意済み・連携済み",
  );
  const retry = page.locator("[data-discord-retry]");
  await expect(retry).toBeVisible();
  await retry.click();
  await expect.poll(() => retryCalled).toBe(true);
  await expect(page.locator("[data-provisioning-status]")).toHaveText(
    "Discord同期済み",
  );
  await expect(page.locator("[data-discord-retry]")).toHaveCount(0);
});

test("応募一覧から応募者対応を開き、一覧へ戻っても選択した応募者を保つ", async ({
  page,
}) => {
  const applicant = {
    id: "newest-draft",
    family_name: "入力中",
    given_name: "応募者",
    email: "applicant@example.test",
    form_language: "ja",
    project_slug: "atlas",
    status: "new",
    created_at: "2026-09-05T09:00:00Z",
    desired_subjects: "mathematics",
    article_ideas: "群論",
    interests: "数学",
    message: "参加希望",
  };
  const interview = {
    status: "scheduled",
    mode: "in_person",
    location: "保存済み会場",
    scheduledAt: "2026-10-06T06:30:00Z",
  };
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/admin/applications") {
      const applications = url.searchParams.has("applicationId")
        ? [applicant]
        : [
            applicant,
            {
              id: "older-draft",
              family_name: "別の",
              given_name: "応募者",
              email: "older@example.test",
              project_slug: "atlas",
              status: "new",
              created_at: "2026-09-01T09:00:00Z",
            },
          ];
      await route.fulfill({
        json: {
          applications,
          subjectLabels: { mathematics: "数学" },
          formLabels: { atlas: "学習サイト「アトラス」" },
          summary: { total: 2, new: 2, reviewing: 0, accepted: 0, rejected: 0 },
          pagination: { hasMore: false, nextCursor: null },
        },
      });
      return;
    }
    if (url.pathname.endsWith("/interview")) {
      await route.fulfill({
        json: {
          application: {
            id: applicant.id,
            name: "入力中 応募者",
            email: applicant.email,
            status: applicant.status,
          },
          interview,
          review: { decision: "pending" },
          subjectLabels: { mathematics: "数学" },
        },
      });
      return;
    }
    if (url.pathname === "/api/admin/member-intake") {
      await route.fulfill({ json: { entries: [], responsibleCandidates: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("admin/applications/?project=atlas");
  await expect(page.locator("[data-application-select]")).toHaveValue(
    "newest-draft",
  );
  await page.getByLabel("対応区分").selectOption("new");
  const detailLink = page.getByRole("link", { name: "応募者対応を開く →" });
  await expect(detailLink).toHaveAttribute("href", /application=newest-draft/);
  await expect(detailLink).toHaveAttribute("href", /attention=new/);
  await detailLink.click();
  await expect(page.getByRole("heading", { name: "応募者対応" })).toBeVisible();
  await expect(page.locator("[data-application-content]")).toContainText(
    "群論",
  );
  await expect(page.locator("[data-interview-location]")).toHaveValue(
    "保存済み会場",
  );
  await page.locator("[data-back-link]").click();
  await expect(page).toHaveURL(/application=newest-draft/);
  await expect(page.getByLabel("対応区分")).toHaveValue("new");
  await expect(page.locator("[data-application-select]")).toHaveValue(
    "newest-draft",
  );
});

test("要対応フィルターは後続ページの送信失敗を拾い、再試行待ちと区別する", async ({
  page,
}) => {
  let finishNextPage: () => void = () => {};
  const nextPageReady = new Promise<void>((resolve) => {
    finishNextPage = resolve;
  });
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/admin/applications") {
      await route.fulfill({ json: {} });
      return;
    }
    const isNext = url.searchParams.has("cursor");
    if (isNext) await nextPageReady;
    await route.fulfill({
      json: isNext
        ? {
            applications: [
              {
                id: "failed",
                name: "送信失敗の応募",
                status: "accepted",
                email_deliveries: [{ failed: 1 }],
              },
              {
                id: "decision",
                name: "結果待ちの応募",
                status: "reviewing",
                interview_completed_at: "2026-11-25T00:00:00Z",
              },
            ],
            pagination: { hasMore: false },
          }
        : {
            applications: [
              {
                id: "retry",
                name: "再試行中の応募",
                status: "accepted",
                email_deliveries: [{ failed: 0, retry: 1 }],
              },
            ],
            pagination: { hasMore: true, nextCursor: "next-page" },
          },
    });
  });
  try {
    await page.goto("admin/applications/?project=atlas&attention=email");
    await expect(page.getByText("残りの応募を確認しています。")).toBeVisible();
  } finally {
    finishNextPage();
  }
  const applicant = page.locator("[data-application-select]");
  await expect(applicant).toHaveValue("failed");
  await expect(applicant.locator("option")).toHaveCount(1);
  await expect(page.locator(".application-list")).toContainText(
    "メール送信失敗",
  );
  await page.getByLabel("対応区分").selectOption("decision");
  await expect(applicant).toHaveValue("decision");
  await page.getByRole("button", { name: "絞り込みを解除" }).click();
  await expect(applicant.locator("option")).toHaveCount(3);
});

test("応募者対応では日程保存の失敗を保ち、保存後の通知失敗を区別する", async ({
  page,
}) => {
  let failSave = true;
  const applicant = {
    id: "save-draft",
    family_name: "面談",
    given_name: "応募者",
    email: "applicant@example.test",
    form_language: "ja",
    project_slug: "atlas",
    status: "new",
    created_at: "2026-09-05T09:00:00Z",
    article_ideas: "記事案",
  };
  let interview: Record<string, unknown> = {
    status: "scheduled",
    mode: "in_person",
    location: "以前の会場",
    scheduledAt: "2026-10-06T06:30:00Z",
  };
  let savedLocation = "";
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/interview/notify")) {
      await route.fulfill({
        status: 503,
        json: { error: "通知を送れませんでした。" },
      });
      return;
    }
    if (
      url.pathname.endsWith("/interview") &&
      route.request().method() === "PUT"
    ) {
      if (failSave) {
        await route.fulfill({
          status: 500,
          json: { error: "保存に失敗しました。" },
        });
        return;
      }
      const values = route.request().postDataJSON();
      interview = { ...values, status: "scheduled" };
      savedLocation = String(values.location);
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (url.pathname.endsWith("/interview")) {
      await route.fulfill({
        json: {
          application: {
            id: applicant.id,
            name: "面談 応募者",
            email: applicant.email,
            status: applicant.status,
          },
          interview,
          review: { decision: "pending" },
        },
      });
      return;
    }
    if (url.pathname === "/api/admin/applications") {
      await route.fulfill({
        json: {
          applications: [applicant],
          subjectLabels: {},
          formLabels: { atlas: "学習サイト「アトラス」" },
        },
      });
      return;
    }
    if (url.pathname === "/api/admin/member-intake") {
      await route.fulfill({ json: { entries: [], responsibleCandidates: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto(
    "admin/application-interview/?application=save-draft&project=atlas",
  );
  const location = page.locator("[data-interview-location]");
  await location.fill("新しい会場");
  await page.locator("[data-interview-save]").click();
  await expect(page.locator("[data-notice]")).toContainText("保存に失敗");
  await expect(location).toHaveValue("新しい会場");
  failSave = false;
  await page.locator("[data-interview-notify]").click();
  await expect(page.locator("[data-notice]")).toContainText(
    "面談日程は保存済みです。通知を送れませんでした。",
  );
  expect(savedLocation).toBe("新しい会場");
  await location.fill("さらに変更した会場");
  await page.locator("[data-interview-save]").click();
  await expect(page.locator("[data-notice]")).toHaveText(
    "面談日程を保存しました。",
  );
  await expect(location).toHaveValue("さらに変更した会場");
});

test("日程や審査を保存しても他の欄の未保存入力を残す", async ({ page }) => {
  const application = {
    id: "preserve-draft",
    name: "確認 応募者",
    family_name: "確認",
    given_name: "応募者",
    email: "applicant@example.test",
    project_slug: "atlas",
    status: "new",
    desired_subjects: "mathematics",
  };
  let interview: Record<string, unknown> = {
    status: "scheduled",
    mode: "in_person",
    location: "保存済み会場",
    scheduledAt: "2026-10-06T06:30:00Z",
  };
  let review = {
    note: "保存済みメモ",
    assignedSubjects: ["mathematics"],
    decision: "pending",
  };
  let interviewGets = 0;
  let reviewPuts = 0;
  const intake = {
    email: application.email,
    application_id: application.id,
    contact_status: "not_contacted",
    revision: 1,
  };

  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.endsWith("/interview") &&
      route.request().method() === "PUT"
    ) {
      interview = { ...route.request().postDataJSON(), status: "scheduled" };
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (
      url.pathname.endsWith("/interview-review") &&
      route.request().method() === "PUT"
    ) {
      reviewPuts += 1;
      review = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (url.pathname.endsWith("/interview")) {
      interviewGets += 1;
      await route.fulfill({
        json: {
          application,
          interview,
          review,
          subjectLabels: { mathematics: "数学", physics: "物理" },
        },
      });
      return;
    }
    if (url.pathname === "/api/admin/applications") {
      await route.fulfill({
        json: {
          applications: [application],
          subjectLabels: { mathematics: "数学", physics: "物理" },
        },
      });
      return;
    }
    if (url.pathname === "/api/admin/member-intake") {
      await route.fulfill({
        json: {
          entries: [intake],
          responsibleCandidates: [
            { email: "operator@example.test", displayName: "運営担当" },
          ],
        },
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto(
    "admin/application-interview/?application=preserve-draft&project=atlas",
  );
  await expect(page.locator("[data-notes]")).toHaveValue("保存済みメモ");
  await page.locator("[data-notes]").fill("日程保存後も残す審査メモ");
  await page.locator("[data-subject-options] input[value=physics]").check();
  await page
    .locator("[data-intake-responsible]")
    .selectOption("operator@example.test");
  await page.locator("[data-intake-contact-status]").selectOption("contacted");
  await page
    .locator("[data-intake-contact-note]")
    .fill("日程保存後も残す連絡メモ");
  await page.locator("[data-interview-location]").fill("日程保存する会場");
  await page.locator("[data-interview-save]").click();
  await expect.poll(() => interviewGets).toBe(2);
  await expect(page.locator("[data-notes]")).toHaveValue(
    "日程保存後も残す審査メモ",
  );
  await expect(
    page.locator("[data-subject-options] input[value=physics]"),
  ).toBeChecked();
  await expect(page.locator("[data-intake-responsible]")).toHaveValue(
    "operator@example.test",
  );
  await expect(page.locator("[data-intake-contact-status]")).toHaveValue(
    "contacted",
  );
  await expect(page.locator("[data-intake-contact-note]")).toHaveValue(
    "日程保存後も残す連絡メモ",
  );

  await page.locator("[data-notes]").fill("審査保存するメモ");
  await page.locator("[data-interview-location]").fill("審査保存後も残す会場");
  await page
    .locator("[data-intake-contact-note]")
    .fill("審査保存後も残す連絡メモ");
  await page.locator("[data-save]").click();
  await expect.poll(() => reviewPuts).toBe(1);
  await expect.poll(() => interviewGets).toBe(3);
  await expect(page.locator("[data-notes]")).toHaveValue("審査保存するメモ");
  await expect(page.locator("[data-interview-location]")).toHaveValue(
    "審査保存後も残す会場",
  );
  await expect(page.locator("[data-intake-contact-note]")).toHaveValue(
    "審査保存後も残す連絡メモ",
  );
});

test("面談日程を保存している間は入力欄をロックする", async ({ page }) => {
  let releaseSave!: () => void;
  const saveReady = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const applicant = {
    id: "pending-draft",
    family_name: "保存中",
    given_name: "応募者",
    email: "applicant@example.test",
    status: "new",
  };
  let interview: Record<string, unknown> = {
    status: "scheduled",
    mode: "in_person",
    location: "元の会場",
    scheduledAt: "2026-10-06T06:30:00Z",
  };
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.endsWith("/interview") &&
      route.request().method() === "PUT"
    ) {
      const values = route.request().postDataJSON();
      await saveReady;
      interview = { ...values, status: "scheduled" };
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (url.pathname.endsWith("/interview")) {
      await route.fulfill({
        json: {
          application: applicant,
          interview,
          review: { decision: "pending" },
        },
      });
      return;
    }
    if (url.pathname === "/api/admin/applications") {
      await route.fulfill({
        json: {
          applications: [{ ...applicant, project_slug: "atlas" }],
          subjectLabels: {},
        },
      });
      return;
    }
    if (url.pathname === "/api/admin/member-intake") {
      await route.fulfill({ json: { entries: [], responsibleCandidates: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto(
    "admin/application-interview/?application=pending-draft&project=atlas",
  );
  const location = page.locator("[data-interview-location]");
  await location.fill("保存する会場");
  const putStarted = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && request.url().includes("/interview?"),
  );
  await page.locator("[data-interview-save]").click();
  await putStarted;
  await expect(location).toBeDisabled();
  await expect(page.locator("[data-interview-date]")).toBeDisabled();
  await expect(page.locator("[data-interview-notify]")).toBeDisabled();
  releaseSave();
  await expect(location).toBeEnabled();
  await expect(location).toHaveValue("保存する会場");
});
