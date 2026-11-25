import { expect, it, vi } from "vitest";
import {
  runObservedScheduledJob,
  scheduledJobDefinitions,
  type ScheduledJobHealthSnapshot,
} from "../../src/lib/admin-scheduled-job-health";
import type { ScheduledQueueHealth } from "../../src/lib/admin-scheduled-job-queues";
import { createAdminTestEnvironment } from "../helpers/admin-test-environment";

it("定期処理の実行履歴がない場合に稼働中と表示しない", async () => {
  const { request } = createAdminTestEnvironment();
  const response = await request(
    "/api/admin/developer/diagnostics",
    "global@atlasez.test",
  );

  expect(response.status).toBe(200);
  const data = (await response.json()) as {
    prototypeAccess: boolean;
    scheduledJobs: ScheduledJobHealthSnapshot;
    queues: ScheduledQueueHealth[];
    checks: Array<{
      id: string;
      status: string;
      detail: string;
    }>;
  };
  const cron = data.checks.find((check) => check.id === "cron");

  expect(data.prototypeAccess).toBe(true);
  expect(cron).toMatchObject({ status: "warning" });
  expect(data.scheduledJobs.available).toBe(true);
  expect(data.scheduledJobs.jobs).toHaveLength(16);
  expect(
    data.scheduledJobs.jobs.every(
      (job) => job.status === "unknown" && job.lastSucceededAt === null,
    ),
  ).toBe(true);
  expect(data.queues).toHaveLength(9);
  expect(
    data.queues.every(
      (queue) => queue.pendingCount === 0 && queue.status === "ok",
    ),
  ).toBe(true);
});

it("各定期処理の成功を確認でき、滞留がなければ正常と表示する", async () => {
  const { request, env } = createAdminTestEnvironment();
  for (const { id } of scheduledJobDefinitions)
    await runObservedScheduledJob(env.REPORTS, id, async () => undefined, {
      logger: { info: vi.fn(), error: vi.fn() },
    });
  const response = await request(
    "/api/admin/developer/diagnostics",
    "global@atlasez.test",
  );
  const data = (await response.json()) as {
    checks: Array<{ id: string; status: string }>;
    scheduledJobs: ScheduledJobHealthSnapshot;
  };
  expect(response.status).toBe(200);
  expect(data.checks.find(({ id }) => id === "cron")?.status).toBe("ok");
  expect(
    data.scheduledJobs.jobs.every(
      (job) => job.status === "ok" && job.lastSucceededAt,
    ),
  ).toBe(true);
});

it("監視テーブルがない場合も他の診断を返し、実行結果を未確認にする", async () => {
  const { request, db } = createAdminTestEnvironment();
  db.exec("DROP TABLE admin_scheduled_job_health");
  const response = await request(
    "/api/admin/developer/diagnostics",
    "global@atlasez.test",
  );
  const data = (await response.json()) as {
    checks: Array<{ id: string; status: string }>;
    scheduledJobs: ScheduledJobHealthSnapshot;
  };
  expect(response.status).toBe(200);
  expect(data.checks.find(({ id }) => id === "database")?.status).toBe("ok");
  expect(data.checks.find(({ id }) => id === "cron")?.status).toBe("warning");
  expect(data.scheduledJobs.available).toBe(false);
  expect(data.scheduledJobs.jobs.every((job) => job.status === "unknown")).toBe(
    true,
  );
});

it("閲覧権限がない利用者には監視記録・集計を読み出さない", async () => {
  const { request, env } = createAdminTestEnvironment();
  const prepare = vi.spyOn(env.REPORTS, "prepare");
  const response = await request(
    "/api/admin/developer/diagnostics",
    "unprivileged@atlasez.test",
  );
  expect(response.status).toBe(403);
  expect(await response.json()).not.toHaveProperty("scheduledJobs");
  expect(
    prepare.mock.calls.some(
      ([sql]) =>
        sql.includes("admin_scheduled_job_health") ||
        sql.includes("WITH clock AS"),
    ),
  ).toBe(false);
});

it("GitHub Appの必須設定が一部だけの場合は連携済みと表示しない", async () => {
  const { request, env } = createAdminTestEnvironment();
  Object.assign(env, {
    GITHUB_REPOSITORY: "Atlasez/Atlasez01",
    GITHUB_APP_ID: "isolated-app-id",
  });

  const response = await request(
    "/api/admin/developer/diagnostics",
    "global@atlasez.test",
  );
  expect(response.status).toBe(200);
  const data = (await response.json()) as {
    prototypeAccess: boolean;
    checks: Array<{ id: string; detail: string }>;
  };

  expect(data.prototypeAccess).toBe(true);
  expect(
    data.checks.find((check) => check.id === "bindings")?.detail,
  ).toContain("github:未設定");
});

it("GitHub Appの必須設定が揃えば既定repository使用時も認証設定済みと表示する", async () => {
  const { request, env } = createAdminTestEnvironment();
  Object.assign(env, {
    GITHUB_APP_ID: "isolated-app-id",
    GITHUB_APP_INSTALLATION_ID: "isolated-installation-id",
    GITHUB_APP_PRIVATE_KEY: "isolated-private-key",
  });

  const response = await request(
    "/api/admin/developer/diagnostics",
    "global@atlasez.test",
  );
  expect(response.status).toBe(200);
  const data = (await response.json()) as {
    prototypeAccess: boolean;
    checks: Array<{ id: string; detail: string }>;
  };

  expect(
    data.checks.find((check) => check.id === "bindings")?.detail,
  ).toContain("github:設定済み");
  expect(data.prototypeAccess).toBe(true);
});
