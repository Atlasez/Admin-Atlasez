import type { D1Database } from "./admin-database";
import {
  runObservedScheduledJob,
  type ScheduledJobId,
  type ScheduledJobReporter,
} from "./admin-scheduled-job-health";

export type ScheduledJobTasks = Record<
  ScheduledJobId,
  (report: ScheduledJobReporter) => Promise<unknown>
>;

const maintenanceJobs: ScheduledJobId[] = [
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

const hourlyJobs: ScheduledJobId[] = [
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

/** Keep the existing cron membership, fallback, and rejection semantics. */
export async function executeAdminScheduledJobs(
  db: D1Database,
  cron: string,
  tasks: ScheduledJobTasks,
  reconcileApplicationIntakes?: () => Promise<unknown>,
) {
  const ids: ScheduledJobId[] =
    cron === "*/1 * * * *"
      ? ["editorial-publication-progress", "editorial-release-reconcile"]
      : cron === "*/2 * * * *"
        ? ["editorial-publication-sync"]
        : cron === "1-59/2 * * * *"
          ? ["published-article-backup"]
          : cron === "*/5 * * * *"
            ? maintenanceJobs
            : hourlyJobs;
  const pending = ids.map((id) => runObservedScheduledJob(db, id, tasks[id]));
  if (
    reconcileApplicationIntakes &&
    (ids === maintenanceJobs || ids === hourlyJobs)
  ) {
    pending.push(Promise.resolve().then(reconcileApplicationIntakes));
  }
  if (cron === "*/5 * * * *") {
    const results = await Promise.allSettled(pending);
    const rejected = results.filter(
      (result) => result.status === "rejected",
    ).length;
    if (rejected)
      console.error(
        JSON.stringify({ event: "admin_cron_job_failed", cron, rejected }),
      );
    return;
  }
  await Promise.all(pending);
}

/** Delivery counts describe this execution, independently of queue backlog. */
export function reportScheduledDeliveryResult(
  report: ScheduledJobReporter,
  result: { failed?: number; skipped?: boolean },
) {
  if (result.skipped === true)
    report({ status: "skipped", code: "not_configured" });
  else if (Number(result.failed ?? 0) > 0)
    report({ status: "warning", code: "partial_failure" });
}
