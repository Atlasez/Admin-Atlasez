import { test, expect, type Page } from "@playwright/test";

const editorDocumentListRoute = /\/api\/admin\/editor\/documents(?:\?.*)?$/;

type ArchiveTestRequest = {
  id: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  requested_by: string;
  requested_at: string;
  request_note: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
};

async function mockArchiveWorkflowApi(
  page: Page,
  options: {
    documents: Record<string, unknown>[];
    actor: () => string;
    requests: Map<string, ArchiveTestRequest>;
    archivedIds: Set<string>;
  },
) {
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const documentList = options.documents.map((document) => {
      const id = String(document.id);
      const archived = options.archivedIds.has(id);
      return {
        ...document,
        archived_at: archived ? "2026-08-28T01:00:00.000Z" : null,
        archive_expires_at: archived ? "2026-09-27T01:00:00.000Z" : null,
      };
    });
    let status = 200;
    let payload: unknown = {};
    const archiveMatch = pathname.match(
      /^\/api\/admin\/editor\/documents\/([^/]+)\/archive-request$/,
    );
    const unarchiveMatch = pathname.match(
      /^\/api\/admin\/editor\/documents\/([^/]+)\/unarchive$/,
    );
    const revisionsMatch = pathname.match(
      /^\/api\/admin\/editor\/documents\/([^/]+)\/revisions$/,
    );
    const publicationReviewMatch = pathname.match(
      /^\/api\/admin\/editor\/documents\/([^/]+)\/publication-review$/,
    );
    const documentMatch = pathname.match(
      /^\/api\/admin\/editor\/documents\/([^/]+)$/,
    );

    if (pathname === "/api/admin/auth-status") {
      payload = {
        email: options.actor(),
        isManager: false,
        canAccessAdmin: true,
        canAccessScopedAdminPages: true,
      };
    } else if (pathname === "/api/admin/notifications") {
      const pending = [...options.requests.values()].find(
        (item) => item.status === "pending",
      );
      payload = {
        notifications:
          pending && options.actor() !== pending.requested_by
            ? [
                {
                  id: `article-archive-request-${pending.id}-pending-${pending.requested_at}`,
                  kind: "article-archive-request",
                  title: "記事アーカイブ申請：整理前の下書き",
                  detail: "承認待ち",
                  href: `/admin/editor/?document=${options.documents[0]?.id}`,
                  updatedAt: pending.requested_at,
                },
              ]
            : [],
        unreadNotificationsCount:
          pending && options.actor() !== pending.requested_by ? 1 : 0,
      };
    } else if (pathname === "/api/admin/editor/documents") {
      payload = {
        scope: {
          email: options.actor(),
          subjects:
            options.actor() === "alice@example.com" ? ["mathematics"] : [],
          isManager: false,
        },
        documents: documentList,
        pagination: { hasMore: false, nextCursor: null },
      };
    } else if (archiveMatch) {
      const documentId = archiveMatch[1];
      const document = options.documents.find((item) => item.id === documentId);
      const archiveRequest = options.requests.get(documentId) ?? null;
      const archived = options.archivedIds.has(documentId);
      if (method === "GET") {
        const eligible = Boolean(
          document &&
          (document.status === "draft" || document.status === "in-review") &&
          !document.publication_review_stage &&
          !document.published_at &&
          !archived,
        );
        const pending = archiveRequest?.status === "pending";
        payload = {
          request: archiveRequest,
          canRequest:
            eligible && !pending && document?.created_by === options.actor(),
          canDecide:
            pending &&
            options.actor() === "operator@example.com" &&
            archiveRequest?.requested_by !== options.actor(),
          canWithdraw:
            pending &&
            (archiveRequest?.requested_by === options.actor() ||
              options.actor() === "operator@example.com"),
          eligible,
          archived,
        };
      } else if (method === "POST") {
        const body = request.postDataJSON() as { note?: string };
        const now = new Date().toISOString();
        options.requests.set(documentId, {
          id: `archive-request-${documentId}`,
          status: "pending",
          requested_by: options.actor(),
          requested_at: now,
          request_note: body.note ?? "",
          decided_by: null,
          decided_at: null,
          decision_note: "",
        });
        status = 201;
        payload = { ok: true, status: "pending" };
      } else if (method === "PATCH") {
        const body = request.postDataJSON() as {
          decision?: "approved" | "rejected";
          note?: string;
        };
        const current = options.requests.get(documentId);
        if (current) {
          current.status = body.decision ?? "rejected";
          current.decided_by = options.actor();
          current.decided_at = new Date().toISOString();
          current.decision_note = body.note ?? "";
        }
        if (body.decision === "approved") options.archivedIds.add(documentId);
        payload = { ok: true, status: body.decision };
      } else if (method === "DELETE") {
        const current = options.requests.get(documentId);
        if (current) current.status = "withdrawn";
        payload = { ok: true, status: "withdrawn" };
      }
    } else if (unarchiveMatch && method === "POST") {
      options.archivedIds.delete(unarchiveMatch[1]);
      payload = { ok: true, archived: false };
    } else if (revisionsMatch) {
      payload = { revisions: [], feedbackRequests: [] };
    } else if (publicationReviewMatch) {
      const document = options.documents.find(
        (item) => item.id === publicationReviewMatch[1],
      );
      payload = {
        stage: document?.publication_review_stage ?? null,
        canCompleteWriting: false,
        canDecide: false,
        archived: options.archivedIds.has(publicationReviewMatch[1]),
        feedbackTaskTotal: 0,
        feedbackTaskDone: 0,
      };
    } else if (documentMatch && method === "GET") {
      const document = options.documents.find(
        (item) => item.id === documentMatch[1],
      );
      payload = document ? { document, comments: [] } : { error: "not found" };
      if (!document) status = 404;
    } else if (pathname.endsWith("/assets")) {
      payload = { assets: [] };
    } else if (pathname === "/api/admin/editor/taxonomy") {
      payload = { catalog: [] };
    } else if (pathname === "/api/admin/editor/catalog") {
      payload = { articles: [] };
    } else if (pathname === "/api/admin/editor/publication-integration") {
      payload = { configured: false, ready: false };
    }

    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
}

test.describe("A/D 原稿一覧の作業導線", () => {
  test("運営トップを指定どおり4グループに分け、プロジェクト側マイページを表示しない", async ({
    page,
  }) => {
    await page.goto("admin/atlas/");

    const groups = page.locator("[data-menu-group]");
    await expect(groups).toHaveCount(4);
    await expect(groups.nth(0).locator(".project-links > a")).toHaveCount(3);
    await expect(
      groups.nth(0).getByRole("link", { name: /学習サイトの目次/ }),
    ).toHaveCount(0);
    await expect(
      groups.nth(0).getByRole("link", { name: "編集・フィードバックを開く" }),
    ).toHaveAttribute("href", "/admin/articles/");
    await expect(groups.nth(0).locator(".project-links small")).toHaveCount(0);
    await expect(groups.nth(1).locator(".project-links > a")).toHaveCount(3);
    await expect(
      groups
        .nth(1)
        .locator('.project-links a[href="/admin/calendar/?project=atlas"]'),
    ).toHaveCount(1);
    await expect(groups.nth(2).locator(".project-links > a")).toHaveCount(4);
    await expect(
      groups.nth(2).getByRole("link", { name: /諸手続きを開く/ }),
    ).toHaveAttribute("href", "/admin/procedures/?project=atlas");
    await expect(groups.nth(3).locator(".project-links > a")).toHaveCount(1);
    await expect(
      groups.nth(3).getByRole("link", { name: /操作履歴を開く/ }),
    ).toHaveCount(0);
    await expect(
      groups.nth(2).getByRole("link", { name: /規則を開く/ }),
    ).toHaveAttribute("href", "/admin/rules/");
    await expect(
      page.locator("[data-admin-atlas-menu] .menu-groups"),
    ).not.toContainText("マイページ");
    await expect(page.locator(".menu-group-heading > span")).toHaveText([
      "・",
      "・",
      "・",
      "・",
    ]);
    await expect(page.locator(".menu-group-heading p")).toHaveCount(0);
    await expect(page.locator(".project-utility")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /閲覧統計を開く/ }),
    ).toHaveCount(0);
    await expect(
      groups.nth(2).getByRole("link", { name: /操作履歴を開く/ }),
    ).toHaveCount(0);
  });

  test("低頻度の監査機能は管理トップから隠し、開発者モードへまとめる", async ({
    page,
  }) => {
    await page.route("**/api/admin/auth-status", (route) =>
      route.fulfill({
        json: { email: "manager@example.com", isManager: true },
      }),
    );
    await page.goto("admin/manage/?project=atlas");
    await expect(
      page.locator('main.management-home a[href="/admin/audit-log/"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('main.management-home a[href="/admin/update-history/"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('main.management-home a[href="/admin/workflow/"]'),
    ).toHaveCount(0);
    await expect(page.locator("details.developer-entry")).toBeVisible();
    await expect(
      page.locator(
        'details.developer-entry a[href="/admin/developer/?mode=developer"]',
      ),
    ).toHaveAttribute("href", "/admin/developer/?mode=developer");
  });

  test("管理トップは実際の権限範囲を表示し、権限がない入口を隠す", async ({
    page,
  }) => {
    await page.route("**/api/admin/auth-status", (route) =>
      route.fulfill({
        json: {
          email: "subject-editor@example.com",
          isManager: false,
          canAccessAdmin: true,
          canAccessScopedAdminPages: true,
          managerProjects: [],
        },
      }),
    );
    await page.goto("admin/manage/?project=atlas");

    const reports = page.locator('a[data-admin-scope][href*="reports"]');
    const analytics = page.locator('a[data-admin-scope][href*="analytics"]');
    const publicationRuns = page.locator(
      'a[data-admin-scope][href="/admin/publication-runs/"]',
    );
    await expect(reports).toBeVisible();
    await expect(reports.locator(".role-tags")).toContainText(
      "分野担当者（担当分野のみ）",
    );
    await expect(analytics).toBeVisible();
    await expect(analytics.locator(".role-tags")).toContainText(
      "分野担当者（担当記事のみ）",
    );
    await expect(publicationRuns).toBeVisible();
    await expect(publicationRuns.locator(".role-tags")).toContainText(
      "分野担当者（担当記事のみ）",
    );
    await expect(page.locator("a[data-manager-only]:visible")).toHaveCount(0);
    await expect(
      page.locator("a[data-project-manager-only]:visible"),
    ).toHaveCount(0);
    for (const decorativeLabel of ["名簿", "担当確認", "失敗確認"]) {
      await expect(
        page.getByText(decorativeLabel, { exact: true }),
      ).toHaveCount(0);
    }
  });

  test("管理権限の取得に失敗した利用者には管理APIの入口を表示しない", async ({
    page,
  }) => {
    await page.route("**/api/admin/auth-status", (route) =>
      route.fulfill({
        json: {
          email: "member@example.com",
          isManager: false,
          canAccessAdmin: false,
          canAccessScopedAdminPages: false,
          managerProjects: [],
        },
      }),
    );
    await page.goto("admin/manage/?project=atlas");

    await expect(page.locator("a[data-admin-scope]:visible")).toHaveCount(0);
    await expect(page.locator("a[data-manager-only]:visible")).toHaveCount(0);
    await expect(
      page.locator("a[data-project-manager-only]:visible"),
    ).toHaveCount(0);
  });

  test("管理権限の確認に失敗したら再試行から復旧できる", async ({ page }) => {
    let attempts = 0;
    await page.route("**/api/admin/auth-status", (route) => {
      attempts += 1;
      return route.fulfill(
        attempts === 2
          ? { status: 503, json: { error: "一時的な障害" } }
          : {
              json: {
                email: "subject-editor@example.com",
                isManager: false,
                canAccessAdmin: true,
                canAccessScopedAdminPages: true,
                managerProjects: [],
              },
            },
      );
    });
    await page.goto("admin/manage/?project=atlas");

    const notice = page.locator(
      '[data-admin-load-error-scope="management-access"]',
    );
    await expect(notice).toBeVisible();
    await expect(page.locator("a[data-admin-scope]:visible")).toHaveCount(0);
    await notice.getByRole("button", { name: "再試行" }).click();
    await expect(notice).toBeHidden();
    await expect(page.locator("a[data-admin-scope]:visible")).toHaveCount(3);
    expect(attempts).toBe(3);
  });

  test("公開処理の状況は失敗を優先表示し、CIログと再試行を提供する", async ({
    page,
  }) => {
    await page.route("**/api/admin/editor/publication-runs**", (route) =>
      route.fulfill({
        json: {
          generatedAt: "2026-09-12T00:00:00.000Z",
          counts: { failed: 1, retry_wait: 1, published: 3 },
          runs: [
            {
              id: "run-1",
              document_id: "document-1",
              action: "publish",
              state: "failed",
              attempt: 2,
              title: "テスト記事",
              subject: "mathematics",
              category: "group-theory",
              slug: "cyclic-groups",
              updated_at: "2026-09-12T00:00:00.000Z",
              failure_kind: "github_api",
              failure_suggestion: "CIログを確認してください。",
              check_url: "https://github.com/example/checks/1",
              diagnostic_url: "https://admin.example.test/diagnostics/1",
              pull_request_url: "https://github.com/example/pull/1",
            },
          ],
        },
      }),
    );
    await page.goto("admin/publication-runs/");

    await expect(
      page.getByRole("heading", { name: "公開処理の状況", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "テスト記事" })).toBeVisible();
    await expect(
      page.locator("[data-list]").getByText("自動公開失敗"),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "CIログ" })).toHaveAttribute(
      "href",
      "https://github.com/example/checks/1",
    );
    await expect(page.getByRole("link", { name: "診断" })).toHaveAttribute(
      "href",
      "https://admin.example.test/diagnostics/1",
    );
    await expect(page.getByRole("button", { name: "再試行" })).toBeVisible();
  });

  test("規則ページの主要セクションと作業の進め方への導線を表示する", async ({
    page,
  }) => {
    await page.goto("admin/rules/");

    await expect(
      page.getByRole("heading", { name: "規則", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".rule-section")).toHaveCount(6);
    await expect(
      page.getByRole("link", { name: /作業の進め方を確認する/ }),
    ).toHaveAttribute("href", "/admin/guide/");
  });

  test("プロジェクトHomeでは原稿一覧だけを入口にする", async ({ page }) => {
    await page.goto("admin/atlas/");

    await expect(
      page.getByRole("link", { name: /編集・フィードバックを開く/ }),
    ).toHaveAttribute("href", "/admin/articles/");
    await expect(page.getByRole("link", { name: /新規記事作成/ })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: /加筆・修正/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^査読/ })).toHaveCount(0);
  });

  test("D-1: 原稿一覧に作業内容ごとの入口を表示し、カード内の旧ボタンは表示しない", async ({
    page,
  }) => {
    await page.goto("admin/articles/");

    await expect(page.locator(".workflow-card")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /新規記事作成/ }),
    ).toHaveAttribute("href", "/admin/editor/?new=1&from=articles");
    await expect(
      page.getByRole("button", { name: /加筆・修正/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /フィードバック/ }),
    ).toBeVisible();
    await expect(
      page.locator(".workflow-actions > a, .workflow-actions > button"),
    ).toHaveCount(3);
    await expect(page.locator("[data-workflow-action]")).toHaveCount(2);
    await expect(page.locator(".workflow-actions")).toContainText(
      "新規記事作成",
    );
    await expect(page.locator(".workflow-actions")).toContainText("加筆・修正");
    await expect(page.locator(".workflow-actions")).toContainText(
      "フィードバック",
    );
    await expect(page.locator("[data-workflow-filter]")).toHaveValue("all");
    await expect(page.locator("[data-workflow-filter]")).toBeHidden();
    await page.locator(".advanced-filters > summary").click();
    await expect(page.locator("[data-workflow-filter]")).toBeVisible();
    await expect(
      page.locator("[data-workflow-filter] option[value=request]"),
    ).toHaveText("依頼できる記事");
    await page.getByRole("button", { name: /フィードバック/ }).click();
    await expect(page).toHaveURL(/mode=review/);
    await page.locator("[data-workflow-filter]").selectOption("request");
    await expect(page).toHaveURL(/mode=request/);
    await page.reload();
    await expect(page.locator("[data-workflow-filter]")).toHaveValue("request");
    await page.locator(".advanced-filters > summary").click();
    await page.locator("[data-workflow-filter]").selectOption("all");
    expect(new URL(page.url()).searchParams.has("mode")).toBe(false);
    await page.reload();
    await expect(page.locator("[data-workflow-filter]")).toHaveValue("all");
    await expect(page.locator(".article-view-tabs")).toHaveCount(0);
    await expect(page.locator(".header-actions")).toHaveCount(0);
    const workflowCardStyle = await page
      .locator(".workflow-actions > :first-child")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          textAlign: style.textAlign,
          borderTopWidth: style.borderTopWidth,
          borderTopColor: style.borderTopColor,
          borderColor: style.borderColor,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          outlineColor: style.outlineColor,
          outlineOffset: style.outlineOffset,
        };
      });
    expect(workflowCardStyle.textAlign).toBe("center");
    expect(workflowCardStyle.borderTopWidth).toBe("1px");
    expect(workflowCardStyle.borderTopColor).toBe(
      workflowCardStyle.borderColor,
    );
    expect(workflowCardStyle.borderColor).not.toBe("rgb(255, 255, 255)");
    expect(workflowCardStyle.outlineStyle).toBe("none");
    expect(workflowCardStyle.outlineWidth).toBe("0px");
    await expect(
      page.getByRole("link", { name: /編集・フィードバックを開く/ }),
    ).toHaveCount(0);
  });

  test("D-2: 原稿一覧で現在編集中のメンバーと項目を確認できる", async ({
    page,
  }) => {
    await page.route(editorDocumentListRoute, async (route) => {
      await route.fulfill({
        json: {
          scope: { email: "alice@example.com" },
          documents: [
            {
              id: "presence-doc",
              subject: "mathematics",
              category: "algebra",
              title: "編集中の記事",
              status: "draft",
              updated_at: "2026-08-28T00:00:00.000Z",
              published_at: null,
              active_editors: [
                {
                  sessionId: "session-1",
                  email: "bob@example.com",
                  displayName: "山田花子",
                  field: "body",
                },
              ],
            },
          ],
        },
      });
    });

    await page.goto("admin/articles/?verify=presence");

    const card = page.locator('[data-document-id="presence-doc"]');
    await expect(card).toContainText("編集中：山田花子（本文）");
    await expect(card.locator(".badge.editing")).toHaveText(/1人が編集中/);
    await expect(card).toHaveAttribute("aria-label", /編集中/);
    const listLayout = await page.locator("[data-list]").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        display: style.display,
        gridAutoFlow: style.gridAutoFlow,
        gridTemplateColumns: style.gridTemplateColumns,
      };
    });
    expect(listLayout.display).toBe("grid");
    expect(listLayout.gridAutoFlow).toBe("row");
    expect(listLayout.gridTemplateColumns.split(" ")).toHaveLength(1);
  });

  test("D-3c: 公開中の未公開版を版IDで一覧に表示する", async ({ page }) => {
    await page.route("**/api/admin/editor/documents**", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.pathname !== "/api/admin/editor/documents")
        return route.fallback();
      await route.fulfill({
        json: {
          scope: { email: "alice@example.com", allSubjects: true },
          documents: [
            {
              id: "update-progress-doc",
              subject: "mathematics",
              category: "group-theory",
              slug: "group-definition",
              title: "未公開版がある記事",
              status: "draft",
              published_at: "2026-08-30T01:34:00.000Z",
              updated_at: "2026-09-01T01:34:00.000Z",
              current_version_id: "version-current",
              published_version_id: "version-public",
            },
          ],
        },
      });
    });

    await page.goto("admin/articles/?verify=update-progress");
    await expect(page.locator("[data-subject]")).toHaveValue("all");
    await expect(page.locator('[data-subject] option[value="all"]')).toHaveText(
      "すべての分野（全権限）",
    );
    const card = page.locator('[data-document-id="update-progress-doc"]');
    await expect(card.locator("[data-update-proposal-state]")).toHaveCount(0);
    await expect(card.locator(".article-status-group")).toContainText([
      "編集",
      "学習サイト",
    ]);
    await expect(card).not.toContainText("運営連携");
    await expect(card).toContainText("公開中");
    await expect(card).toContainText("公開中・未公開の版あり");
    await expect(card).not.toContainText("更新案を作成");
    await page.screenshot({
      path: "test-results/admin-articles-unpublished-version.png",
      fullPage: true,
    });
  });

  test("D-3: 原稿一覧を分野とカテゴリで絞り込める", async ({ page }) => {
    await page.route(editorDocumentListRoute, async (route) => {
      await route.fulfill({
        json: {
          scope: { email: "alice@example.com" },
          documents: [
            {
              id: "ring-doc",
              subject: "mathematics",
              category: "ring-theory",
              title: "環論の記事",
              status: "draft",
              updated_at: "2026-08-28T00:00:00.000Z",
              published_at: null,
            },
            {
              id: "group-doc",
              subject: "mathematics",
              category: "group-theory",
              title: "群論の記事",
              status: "draft",
              updated_at: "2026-08-27T00:00:00.000Z",
              published_at: null,
            },
            {
              id: "physics-doc",
              subject: "physics",
              category: "newtonian-mechanics",
              title: "力学の記事",
              status: "draft",
              updated_at: "2026-08-26T00:00:00.000Z",
              published_at: null,
            },
          ],
        },
      });
    });

    await page.goto("admin/articles/?verify=taxonomy-filter");

    await expect(page.locator("[data-subject] option")).toHaveCount(24);
    await expect(page.locator("[data-category] option")).toContainText([
      "すべてのカテゴリ",
      "環論",
    ]);
    await expect(
      page.locator("[data-subject-browser] [data-subject-quick]"),
    ).toHaveCount(23);
    await expect(page.locator("[data-subject-browser]")).toContainText("数学");
    await expect(page.locator("[data-subject-browser]")).toContainText("物理");
    await expect(
      page.locator('[data-subject-quick="mathematics"]'),
    ).toContainText("2件");
    await expect(page.locator('[data-subject-quick="physics"]')).toContainText(
      "1件",
    );
    await expect(page.locator('[data-subject-quick="kanbun"]')).toContainText(
      "0件",
    );
    await expect(page.locator(".subject-browser__item em")).toHaveCount(0);
    await expect(page.locator(".subject-browser__empty")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/admin-articles-horizontal-subjects.png",
      fullPage: true,
    });
    await page.locator('[data-subject-quick="kanbun"]').click();
    await expect(page.locator("[data-subject]")).toHaveValue("kanbun");
    await expect(page.locator("[data-list]")).toContainText(
      "条件に一致する原稿はありません。",
    );
    await expect(page.locator('[data-subject-quick="physics"]')).toContainText(
      "1件",
    );
    await page.locator('[data-subject-quick="mathematics"]').click();
    await expect(page.locator("[data-subject]")).toHaveValue("mathematics");
    await expect(page.locator("[data-list] .article")).toHaveCount(2);
    await page.locator('[data-subject-quick="mathematics"]').click();
    await expect(page.locator("[data-list] .article")).toHaveCount(2);
    await expect(page.locator("[data-list]")).toContainText("環論の記事");
    await expect(page.locator("[data-list]")).toContainText("群論の記事");
    await expect(page.locator("[data-list]")).not.toContainText("力学の記事");
    await expect(page.locator("[data-list]")).toContainText("数学");
    await expect(page.locator("[data-list]")).toContainText("環論");
    await expect(page.locator("[data-list]")).toContainText("群論");
    await expect(page.locator("[data-list]")).not.toContainText(
      "mathematics / ring-theory",
    );
    await page.locator("[data-category]").selectOption("ring-theory");
    await expect(page.locator("[data-list] .article")).toHaveCount(1);
    await expect(page.locator("[data-list]")).toContainText("環論の記事");
    await expect(page.locator("[data-list]")).not.toContainText("群論の記事");
    await expect(page.locator("[data-count]")).toHaveText("1件");

    await page.getByRole("button", { name: "全分野に戻る" }).click();
    await expect(page.locator("[data-category]")).toHaveValue("ring-theory");
    await expect(page.locator("[data-list] .article")).toHaveCount(1);
  });

  test("最初に全件を自動で読み込み分野を選んでも全件を表示する", async ({
    page,
  }) => {
    const requestedUrls: string[] = [];
    const makeMathArticle = (index: number) => ({
      id: `math-doc-${index}`,
      subject: "mathematics",
      category: "group-theory",
      title: `数学の記事 ${index}`,
      status: "draft" as const,
      updated_at: new Date(Date.UTC(2026, 8, 30 - index)).toISOString(),
      published_at: null,
    });

    await page.route(editorDocumentListRoute, async (route) => {
      const url = new URL(route.request().url());
      requestedUrls.push(url.href);
      if (url.searchParams.get("subject") === "mathematics") {
        if (url.searchParams.get("cursor") === "math-page-2") {
          await route.fulfill({
            json: {
              scope: { email: "alice@example.com", allSubjects: true },
              documents: [makeMathArticle(101)],
              pagination: { limit: 100, hasMore: false, nextCursor: null },
            },
          });
          return;
        }
        await route.fulfill({
          json: {
            scope: { email: "alice@example.com", allSubjects: true },
            documents: Array.from({ length: 100 }, (_, index) =>
              makeMathArticle(index + 1),
            ),
            pagination: {
              limit: 100,
              hasMore: true,
              nextCursor: "math-page-2",
            },
          },
        });
        return;
      }
      if (url.searchParams.get("cursor") === "global-page-2") {
        await route.fulfill({
          json: {
            scope: { email: "alice@example.com", allSubjects: true },
            documents: [
              {
                id: "global-doc-101",
                subject: "history",
                category: "japan-history",
                title: "全件読み込み確認用の記事",
                status: "draft",
                updated_at: "2026-08-02T00:00:00.000Z",
                published_at: null,
              },
            ],
            pagination: { limit: 100, hasMore: false, nextCursor: null },
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          scope: { email: "alice@example.com", allSubjects: true },
          documents: [
            makeMathArticle(1),
            {
              id: "physics-doc-1",
              subject: "physics",
              category: "mechanics",
              title: "物理の記事",
              status: "draft",
              updated_at: "2026-08-01T00:00:00.000Z",
              published_at: null,
            },
          ],
          pagination: {
            limit: 100,
            hasMore: true,
            nextCursor: "global-page-2",
          },
        },
      });
    });

    await page.goto("admin/articles/?verify=subject-load-all");
    await expect(
      page.locator('[data-document-id="global-doc-101"]'),
    ).toContainText("全件読み込み確認用の記事");
    await expect(page.locator("[data-list] .article")).toHaveCount(3);
    await expect(page.locator("[data-article-load-more]")).toHaveCount(0);
    await page.locator("[data-query]").fill("全件読み込み確認用");
    await expect(page.locator("[data-list] .article")).toHaveCount(1);
    await expect(page.locator("[data-list]")).toContainText(
      "全件読み込み確認用の記事",
    );
    await page.locator("[data-query]").fill("");
    expect(
      requestedUrls.some(
        (url) =>
          new URL(url).searchParams.get("cursor") === "global-page-2" &&
          new URL(url).searchParams.get("limit") === "100",
      ),
    ).toBe(true);
    await page.locator('[data-subject-quick="mathematics"]').click();

    await expect(page.locator("[data-list] .article")).toHaveCount(101);
    await expect(
      page.locator('[data-document-id="math-doc-101"]'),
    ).toContainText("数学の記事 101");
    await expect(
      page.locator("[data-list] [data-expand-category]"),
    ).toHaveCount(0);
    await expect(page.locator("[data-article-pagination]")).toBeHidden();
    await expect(page.locator("[data-article-load-more]")).toHaveCount(0);
    expect(
      requestedUrls.some(
        (url) => new URL(url).searchParams.get("subject") === "mathematics",
      ),
    ).toBe(true);
    expect(
      requestedUrls.some(
        (url) => new URL(url).searchParams.get("cursor") === "math-page-2",
      ),
    ).toBe(true);
  });

  test("D-3a: 公開予約済みの記事を日時付きで表示し、絞り込める", async ({
    page,
  }) => {
    await page.route(editorDocumentListRoute, async (route) => {
      await route.fulfill({
        json: {
          scope: { email: "alice@example.com" },
          documents: [
            {
              id: "scheduled-doc",
              subject: "mathematics",
              category: "algebra",
              title: "予約公開の記事",
              status: "approved",
              updated_at: "2026-09-01T00:00:00.000Z",
              published_at: null,
              scheduled_publish_at: "2026-09-10T03:00:00.000Z",
            },
            {
              id: "draft-doc",
              subject: "mathematics",
              category: "algebra",
              title: "未予約の下書き",
              status: "draft",
              updated_at: "2026-08-31T00:00:00.000Z",
              published_at: null,
              scheduled_publish_at: null,
            },
          ],
        },
      });
    });

    await page.goto("admin/articles/?verify=scheduled");
    const scheduledCard = page.locator('[data-document-id="scheduled-doc"]');
    await expect(scheduledCard).toContainText("公開予約・2026/09/10 12:00");
    await expect(scheduledCard).toContainText("学習サイト");

    await page.locator(".advanced-filters > summary").click();
    await page.locator("[data-public]").selectOption("scheduled");
    await expect(page.locator("[data-list] .article")).toHaveCount(1);
    await expect(page.locator("[data-list]")).toContainText("予約公開の記事");
    await expect(page.locator("[data-list]")).not.toContainText(
      "未予約の下書き",
    );
  });

  test("D-3b: 絞り込み条件を記憶し、担当分野だけを選択できる", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("atlasez-admin-article-filters")) {
        localStorage.setItem(
          "atlasez-admin-article-filters",
          JSON.stringify({ management: "unregistered", workflow: "all" }),
        );
      }
    });
    await page.route(editorDocumentListRoute, async (route) => {
      await route.fulfill({
        json: {
          scope: {
            email: "alice@example.com",
            subjects: ["mathematics"],
            coordinatorSubjects: [],
            allSubjects: false,
          },
          documents: [
            {
              id: "math-doc",
              subject: "mathematics",
              category: "algebra",
              title: "数学の記事",
              status: "approved",
              updated_at: "2026-09-01T00:00:00.000Z",
              published_at: null,
            },
            {
              id: "physics-doc",
              subject: "physics",
              category: "mechanics",
              title: "担当外の記事",
              status: "draft",
              updated_at: "2026-08-31T00:00:00.000Z",
              published_at: null,
            },
          ],
        },
      });
    });

    await page.goto("admin/articles/?verify=filter-memory");
    await expect(page.locator("[data-management]")).toHaveCount(0);
    await expect(page.locator("[data-list]")).toContainText("数学の記事");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem("atlasez-admin-article-filters") ?? "{}",
            ).management,
        ),
      )
      .toBeUndefined();
    await expect(
      page.locator("[data-subject] option:not([hidden])"),
    ).toHaveText(["すべての分野", "数学"]);
    await expect(
      page.locator('[data-subject] option[value="physics"]'),
    ).toBeHidden();

    await page.locator("[data-query]").fill("数学");
    await page.locator('[data-subject-quick="mathematics"]').click();
    await page.locator("[data-status]").selectOption("approved");
    await page.reload();

    await expect(page.locator("[data-query]")).toHaveValue("数学");
    await expect(page.locator("[data-subject]")).toHaveValue("mathematics");
    await expect(page.locator("[data-status]")).toHaveValue("approved");

    await page.locator("[data-reset-filters]").click();
    await expect(page.locator("[data-query]")).toHaveValue("");
    await expect(page.locator("[data-subject]")).toHaveValue("all");
    await expect(page.locator("[data-status]")).toHaveValue("all");
    await expect(page.locator("[data-test]")).toHaveValue("exclude");
    await expect(page.locator("[data-archive]")).toHaveValue("active");
    await expect(page.locator("[data-scope-note]")).toHaveText(
      "担当範囲：数学（1分野）",
    );
  });

  test("記事一覧のバックグラウンド更新中も表示を消さず、完了後に差し替える", async ({
    page,
  }) => {
    let requestCount = 0;
    let releaseRefresh: (() => void) | null = null;
    await page.route("**/api/admin/editor/documents**", async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        await route.fulfill({
          json: {
            scope: { email: "alice@example.com", allSubjects: true },
            documents: [
              {
                id: "stable-doc",
                subject: "mathematics",
                category: "algebra",
                title: "更新前も表示される記事",
                status: "draft",
                updated_at: "2026-09-01T00:00:00.000Z",
                published_at: null,
              },
            ],
            pagination: { hasMore: false, nextCursor: null },
          },
        });
        return;
      }
      await new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      await route.fulfill({
        json: {
          scope: { email: "alice@example.com", allSubjects: true },
          documents: [
            {
              id: "stable-doc",
              subject: "mathematics",
              category: "algebra",
              title: "更新後に差し替わる記事",
              status: "draft",
              updated_at: "2026-09-02T00:00:00.000Z",
              published_at: null,
            },
          ],
          pagination: { hasMore: false, nextCursor: null },
        },
      });
    });

    await page.goto("admin/articles/?verify=background-refresh");
    await expect(page.locator("[data-list]")).toContainText(
      "更新前も表示される記事",
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => requestCount).toBe(2);
    await expect(page.locator("[data-list]")).toContainText(
      "更新前も表示される記事",
    );
    await expect(page.locator("[data-list]")).not.toHaveClass(/loading-state/);
    expect(releaseRefresh).not.toBeNull();
    const release = releaseRefresh as unknown as () => void;
    release();
    await expect(page.locator("[data-list]")).toContainText(
      "更新後に差し替わる記事",
    );
  });

  test("D-3d: 原稿一覧の取得失敗を共通の再試行導線で復旧できる", async ({
    page,
  }) => {
    let attempts = 0;
    await page.route("**/api/admin/editor/documents**", async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "一時的な障害" }),
        });
        return;
      }
      await route.fulfill({
        json: {
          scope: {
            email: "alice@example.com",
            subjects: ["mathematics"],
            coordinatorSubjects: [],
            allSubjects: false,
          },
          documents: [
            {
              id: "retry-doc",
              subject: "mathematics",
              category: "algebra",
              title: "再試行で表示される記事",
              status: "draft",
              updated_at: "2026-09-01T00:00:00.000Z",
              published_at: null,
            },
          ],
          pagination: { hasMore: false, nextCursor: null },
        },
      });
    });

    await page.goto("admin/articles/?verify=retry");
    await expect(page.locator("[data-admin-load-error]")).toBeVisible();
    await expect(page.locator("[data-list]")).not.toContainText(
      "確認しています",
    );
    await expect(page.locator("[data-catalog-overview]")).toHaveCount(0);
    await expect(page.locator("[data-scope-note]")).toHaveAttribute(
      "data-state",
      "error",
    );
    await expect(page.locator("[data-scope-note]")).not.toContainText(
      "確認しています",
    );
    await expect(page.locator("[data-subject]")).not.toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator("[data-subject]")).toBeDisabled();
    await expect(page.locator("[data-admin-load-surface]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator("[data-list]")).toHaveCSS("text-align", "center");
    await expect(page.locator("[data-admin-load-error]")).toHaveCSS(
      "text-align",
      "center",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileError = await page.locator("[data-list]").boundingBox();
    const mobileRetry = await page
      .locator("[data-admin-load-error]")
      .boundingBox();
    expect(mobileError).not.toBeNull();
    expect(mobileRetry).not.toBeNull();
    expect(mobileError!.x + mobileError!.width / 2).toBeCloseTo(195, 0);
    expect(mobileRetry!.x + mobileRetry!.width / 2).toBeCloseTo(195, 0);
    await page.getByRole("button", { name: "再試行" }).click();
    await expect(page.locator('[data-document-id="retry-doc"]')).toContainText(
      "再試行で表示される記事",
    );
    await expect(page.locator("[data-admin-load-error]")).toBeHidden();
    await expect(page.locator("[data-scope-note]")).toHaveAttribute(
      "data-state",
      "ready",
    );
    await expect(page.locator("[data-subject]")).toBeEnabled();
    await expect(page.locator("[data-admin-load-surface]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  test("記事一覧のHTMLエラーを認証情報エラーと誤認せず、HTTP状態を示して再試行できる", async ({
    page,
  }) => {
    let attempts = 0;
    await page.route("**/api/admin/editor/documents**", async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({
          status: 502,
          contentType: "text/html",
          body: "<!doctype html><title>temporary upstream error</title>",
        });
        return;
      }
      await route.fulfill({
        json: {
          scope: { email: "alice@example.com", subjects: ["mathematics"] },
          documents: [],
          pagination: { hasMore: false, nextCursor: null },
        },
      });
    });

    await page.goto("admin/articles/?verify=html-error");
    await expect(page.locator("[data-admin-load-error]")).toContainText(
      "原稿一覧を読み込めませんでした。（HTTP 502）",
    );
    await expect(page.locator("body")).not.toContainText("Unexpected token");
    await page.getByRole("button", { name: "再試行" }).click();
    await expect(page.locator("[data-admin-load-error]")).toBeHidden();
    await expect(page.locator("[data-list]")).toContainText(
      "条件に一致する原稿はありません",
    );
  });

  test("D-4: 編集画面で申請し、運営内運営の承認後に一覧から復元できる", async ({
    page,
  }) => {
    const activeId = "11111111-1111-4111-8111-111111111111";
    const archivedId = "22222222-2222-4222-8222-222222222222";
    let actor = "alice@example.com";
    const archivedIds = new Set([archivedId]);
    const requests = new Map<string, ArchiveTestRequest>();
    const documents = [
      {
        id: activeId,
        source_article_id: null,
        subject: "mathematics",
        category: "algebra",
        locale: "ja",
        slug: "整理前の下書き",
        title: "整理前の下書き",
        summary: "",
        concept_id: "math.algebra.archive-draft",
        body: "## 整理前の下書き\n\n記事本文です。",
        latex_engine: "katex",
        status: "draft",
        publication_review_stage: null,
        created_by: "alice@example.com",
        updated_by: "alice@example.com",
        created_at: "2026-08-28T00:00:00.000Z",
        updated_at: "2026-08-28T00:00:00.000Z",
        published_at: null,
      },
      {
        id: archivedId,
        subject: "mathematics",
        category: "algebra",
        locale: "ja",
        slug: "保管中の下書き",
        title: "保管中の下書き",
        status: "draft",
        created_by: "alice@example.com",
        updated_at: "2026-08-27T00:00:00.000Z",
        published_at: null,
      },
    ];
    await mockArchiveWorkflowApi(page, {
      documents,
      actor: () => actor,
      requests,
      archivedIds,
    });
    page.on("dialog", (dialog) => dialog.accept());

    await page.goto("admin/articles/?verify=archive");
    await expect(page.locator("[data-archive]")).toHaveValue("active");
    await expect(page.locator("[data-list] .article")).toHaveCount(1);
    await expect(page.locator("[data-list]")).toContainText("整理前の下書き");
    await expect(page.locator("[data-list]")).not.toContainText(
      "保管中の下書き",
    );
    const activeRow = page.locator(`[data-document-id="${activeId}"]`);
    await expect(activeRow.locator("[data-archive-action]")).toHaveCount(0);

    await page.goto(`admin/editor/?document=${activeId}`);
    await expect(page.locator("[data-document-form]")).toBeVisible();
    await expect(page.locator("[data-request-archive]")).toBeVisible();
    await page
      .locator("[data-archive-request-note]")
      .fill("内容を整理します。");
    await page.locator("[data-request-archive]").click();
    await expect(page.locator("[data-archive-request-status]")).toContainText(
      "承認待ち",
    );
    expect(requests.get(activeId)?.requested_by).toBe("alice@example.com");
    await expect(page.locator("[data-archive-request-approve]")).toBeHidden();

    actor = "operator@example.com";
    await page.goto(`admin/editor/?document=${activeId}`);
    await page.locator("[data-admin-notifications]").click();
    await expect(page.locator("[data-admin-notification-list]")).toContainText(
      "記事アーカイブ申請",
    );
    await page.locator("[data-close-notifications]").click();
    await expect(page.locator("[data-archive-request-approve]")).toBeVisible();
    await expect(page.locator("[data-request-archive]")).toBeHidden();
    await page.locator("[data-archive-request-approve]").click();
    await expect(page.locator("[data-archive-request-status]")).toContainText(
      "承認されました",
    );
    expect(archivedIds.has(activeId)).toBe(true);

    actor = "alice@example.com";
    await page.goto("admin/articles/?verify=archive");
    await expect(page.locator("[data-list]")).not.toContainText(
      "整理前の下書き",
    );
    await page.locator(".advanced-filters > summary").click();
    await page.locator("[data-archive]").selectOption("archived");
    await expect(page.locator("[data-list] .article")).toHaveCount(2);
    await expect(page.locator("[data-list]")).toContainText("整理前の下書き");
    await expect(page.locator("[data-list]")).toContainText("保管中の下書き");
    await page
      .locator(
        `[data-document-id="${activeId}"] [data-archive-action="unarchive"]`,
      )
      .click();
    await expect(page.locator("[data-list] .article")).toHaveCount(1);
    await expect(page.locator("[data-list]")).toContainText("保管中の下書き");
    await expect(page.locator("[data-list]")).not.toContainText(
      "整理前の下書き",
    );
  });

  test("D-5: フィードバック中は申請でき、公開審査中は申請できない", async ({
    page,
  }) => {
    const feedbackId = "33333333-3333-4333-8333-333333333333";
    const reviewId = "44444444-4444-4444-8444-444444444444";
    const actor = () => "alice@example.com";
    const requests = new Map<string, ArchiveTestRequest>();
    const archivedIds = new Set<string>();
    const feedbackDocument = {
      id: feedbackId,
      source_article_id: null,
      subject: "mathematics",
      category: "algebra",
      locale: "ja",
      slug: "feedback-article",
      title: "フィードバック中の記事",
      summary: "",
      concept_id: "math.algebra.feedback-article",
      body: "## フィードバック中の記事\n\n記事本文です。",
      latex_engine: "katex",
      status: "in-review",
      publication_review_stage: null,
      created_by: "alice@example.com",
      updated_by: "alice@example.com",
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
      published_at: null,
    };
    const reviewDocument = {
      ...feedbackDocument,
      id: reviewId,
      slug: "publication-review-article",
      title: "公開審査中の記事",
      concept_id: "math.algebra.publication-review-article",
      body: "## 公開審査中の記事\n\n記事本文です。",
      publication_review_stage: "subject-coordinator",
      updated_at: "2026-08-27T00:00:00.000Z",
    };
    await mockArchiveWorkflowApi(page, {
      documents: [feedbackDocument, reviewDocument],
      actor,
      requests,
      archivedIds,
    });

    await page.goto("admin/articles/?verify=feedback-archive");
    const feedbackRow = page.locator(`[data-document-id="${feedbackId}"]`);
    const reviewRow = page.locator(`[data-document-id="${reviewId}"]`);
    await expect(reviewRow.locator("[data-archive-action]")).toHaveCount(0);
    await expect(feedbackRow.locator("[data-archive-action]")).toHaveCount(0);

    await page.goto(`admin/editor/?document=${feedbackId}`);
    await expect(page.locator("[data-request-archive]")).toBeVisible();
    await expect(page.locator("[data-archive-request-status]")).toContainText(
      "申請すると",
    );

    await page.goto(`admin/editor/?document=${reviewId}`);
    await expect(page.locator("[data-request-archive]")).toBeHidden();
    await expect(page.locator("[data-archive-request-status]")).toContainText(
      "公開審査中",
    );
  });

  test("V-1 フィードバックは原稿一覧で未確認に絞り、自分への依頼を優先する", async ({
    page,
  }) => {
    await page.route(editorDocumentListRoute, async (route) => {
      await route.fulfill({
        json: {
          scope: { email: "alice@example.com" },
          documents: [
            {
              id: "other-review",
              subject: "physics",
              category: "mechanics",
              slug: "other-review",
              title: "別の担当者への査読",
              status: "in-review",
              updated_at: "2026-08-20T02:00:00.000Z",
              published_at: null,
              reviewer_email: "bob@example.com",
            },
            {
              id: "my-review",
              subject: "mathematics",
              category: "algebra",
              slug: "my-review",
              title: "自分への査読依頼",
              status: "in-review",
              updated_at: "2026-08-20T01:00:00.000Z",
              published_at: null,
              reviewer_email: "alice@example.com",
            },
            {
              id: "approved",
              subject: "mathematics",
              category: "algebra",
              slug: "approved",
              title: "査読済み原稿",
              status: "approved",
              updated_at: "2026-08-20T03:00:00.000Z",
              published_at: null,
            },
            {
              id: "draft",
              subject: "mathematics",
              category: "algebra",
              slug: "draft",
              title: "まだ下書きの原稿",
              status: "draft",
              updated_at: "2026-08-20T04:00:00.000Z",
              published_at: null,
            },
          ],
        },
      });
    });

    await page.goto("admin/articles/?mode=review#article-list");

    await expect(page).toHaveURL(
      /\/admin\/articles\/\?mode=review#article-list$/,
    );
    await expect(page.locator("[data-status]")).toHaveValue("all");
    await expect(page.locator("[data-workflow-filter]")).toHaveValue("review");
    await expect(page.locator("[data-list] .article")).toHaveCount(3);
    await expect(page.locator("[data-list] .article").first()).toContainText(
      "自分への査読依頼",
    );
    await expect(page.locator("[data-list]")).not.toContainText("査読済み原稿");
    await expect(page.locator("[data-list]")).toContainText("まだ下書きの原稿");

    await page.goto("admin/review/");
    await expect(page).toHaveURL(
      /\/admin\/articles\/\?mode=review#article-list$/,
    );
  });
});

test.describe("A-2 管理導線", () => {
  test("管理タブは管理トップへ直接遷移する", async ({ page }) => {
    await page.goto("admin/atlas/");

    await expect(page.locator(".admin-management-menu")).toHaveCount(0);
    const menuToggle = page.locator("[data-admin-menu-toggle]");
    if (await menuToggle.isVisible()) await menuToggle.click();
    await expect(
      page.getByRole("link", { name: "管理", exact: true }),
    ).toHaveAttribute("href", "/admin/manage/?project=atlas");
  });
});
