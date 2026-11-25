import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/admin-worker";
import {
  readScheduledJobHealth,
  scheduledJobDefinitions,
  type ScheduledJobId,
} from "../../src/lib/admin-scheduled-job-health";
import {
  executeAdminScheduledJobs,
  reportScheduledDeliveryResult,
  type ScheduledJobTasks,
} from "../../src/lib/admin-scheduled-jobs";
import { createAdminTestEnvironment } from "../helpers/admin-test-environment";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const createTasks = () => {
  const called: ScheduledJobId[] = [];
  const tasks = {} as ScheduledJobTasks;
  for (const { id } of scheduledJobDefinitions)
    tasks[id] = vi.fn(async () => {
      called.push(id);
    });
  return { called, tasks };
};

const maintenance = [
  "editorial-publication-progress",
  "editorial-release-reconcile",
  "task-reminders",
  "task-templates",
  "member-procedures",
  "task-archive",
  "application-email",
  "seminar-application-email",
  "discord-provisioning",
  "discord-role-sync",
  "scheduled-editorial-publications",
  "audit-archive",
  "discord-notifications",
];
const hourly = [
  "editorial-publication-progress",
  "editorial-release-reconcile",
  "personal-data-retention",
  "member-procedures",
  "task-reminders",
  "task-templates",
  "task-archive",
  "application-email",
  "discord-provisioning",
  "scheduled-editorial-publications",
  "audit-archive",
];

describe("observed admin scheduler", () => {
  it.each([
    [
      "*/1 * * * *",
      ["editorial-publication-progress", "editorial-release-reconcile"],
    ],
    ["*/2 * * * *", ["editorial-publication-sync"]],
    ["1-59/2 * * * *", ["published-article-backup"]],
    ["*/5 * * * *", maintenance],
    ["0 * * * *", hourly],
    ["", hourly],
  ])("preserves existing cron membership for %s", async (cron, expected) => {
    const { env, db } = createAdminTestEnvironment();
    const { tasks, called } = createTasks();
    await executeAdminScheduledJobs(env.REPORTS, cron as string, tasks);

    expect(called.sort()).toEqual([...(expected as string[])].sort());
    expect(
      db
        .prepare(
          "SELECT job_id,last_status FROM admin_scheduled_job_health ORDER BY job_id",
        )
        .all(),
    ).toEqual(
      [...(expected as string[])]
        .sort()
        .map((id) => ({ job_id: id, last_status: "success" })),
    );
  });

  it("finishes the remaining maintenance jobs and records both thrown and reported failures", async () => {
    const { env } = createAdminTestEnvironment();
    const { tasks } = createTasks();
    tasks["task-archive"] = async () => {
      throw new Error("private failure");
    };
    tasks["application-email"] = async (report) => {
      reportScheduledDeliveryResult(report, { failed: 2 });
    };
    tasks["seminar-application-email"] = async (report) => {
      reportScheduledDeliveryResult(report, { skipped: true });
    };
    await expect(
      executeAdminScheduledJobs(env.REPORTS, "*/5 * * * *", tasks),
    ).resolves.toBeUndefined();

    const { jobs } = await readScheduledJobHealth(env.REPORTS);
    expect(jobs.find(({ id }) => id === "task-archive")).toMatchObject({
      status: "error",
      consecutiveFailures: 1,
    });
    expect(jobs.find(({ id }) => id === "application-email")).toMatchObject({
      status: "warning",
      consecutiveFailures: 1,
      lastErrorCode: "partial_failure",
    });
    expect(
      jobs.find(({ id }) => id === "seminar-application-email"),
    ).toMatchObject({
      status: "warning",
      consecutiveFailures: 0,
      lastSucceededAt: null,
      lastErrorCode: "not_configured",
    });
    expect(jobs.find(({ id }) => id === "discord-notifications")).toMatchObject(
      { status: "ok" },
    );
    expect(console.error).toHaveBeenCalledWith(
      JSON.stringify({
        event: "admin_cron_job_failed",
        cron: "*/5 * * * *",
        rejected: 1,
      }),
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "private failure",
    );
  });

  it("keeps rejection visible outside maintenance while starting all jobs in the batch", async () => {
    const { env } = createAdminTestEnvironment();
    const { tasks } = createTasks();
    const failure = new Error("original failure");
    tasks["editorial-publication-progress"] = async () => {
      throw failure;
    };
    await expect(
      executeAdminScheduledJobs(env.REPORTS, "*/1 * * * *", tasks),
    ).rejects.toBe(failure);
    expect(tasks["editorial-release-reconcile"]).toHaveBeenCalledOnce();
  });

  it("continues business jobs when the monitoring migration is absent", async () => {
    const { env, db } = createAdminTestEnvironment();
    db.exec("DROP TABLE admin_scheduled_job_health");
    const { tasks, called } = createTasks();
    await executeAdminScheduledJobs(env.REPORTS, "*/5 * * * *", tasks);
    expect(called.sort()).toEqual([...maintenance].sort());
    expect((await readScheduledJobHealth(env.REPORTS)).available).toBe(false);
  });

  it("captures caught archive failures and missing settings through the real Worker entry point", async () => {
    const { env, db } = createAdminTestEnvironment();
    db.exec("DROP TABLE admin_audit_log");
    const pending: Promise<unknown>[] = [];
    await worker.scheduled({ cron: "*/5 * * * *" }, env as never, {
      waitUntil: (promise) => {
        pending.push(promise);
      },
    });
    await Promise.all(pending);

    const { jobs } = await readScheduledJobHealth(env.REPORTS);
    expect(jobs.find(({ id }) => id === "audit-archive")).toMatchObject({
      status: "warning",
      lastErrorCode: "execution_failed",
      consecutiveFailures: 1,
    });
    expect(
      jobs.find(({ id }) => id === "editorial-release-reconcile"),
    ).toMatchObject({
      status: "warning",
      lastErrorCode: "not_configured",
      lastSucceededAt: null,
    });
    expect(jobs.find(({ id }) => id === "task-archive")).toMatchObject({
      status: "ok",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
