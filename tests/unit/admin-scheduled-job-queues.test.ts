import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createAdminTestEnvironment } from "../helpers/admin-test-environment";
import { readScheduledJobQueues } from "../../src/lib/admin-scheduled-job-queues";

const now = new Date("2026-11-25T12:00:00.000Z");
const at = (minutes: number) =>
  new Date(now.getTime() + minutes * 60_000).toISOString();
const privateEmail = "private-recipient@example.invalid";
const privateBody = "PRIVATE_APPLICATION_OR_NOTIFICATION_BODY";
const privateError = "PRIVATE_PROVIDER_RESPONSE_TOKEN";

const insert = (
  db: DatabaseSync,
  table: string,
  values: Record<string, SQLInputValue>,
) => {
  const columns = Object.keys(values);
  db.prepare(
    `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
  ).run(...Object.values(values));
};

type DeliveryId =
  "application-email" | "seminar-application-email" | "discord-notifications";

const deliveryIds: DeliveryId[] = [
  "application-email",
  "seminar-application-email",
  "discord-notifications",
];

const application = (
  db: DatabaseSync,
  id: string,
  values: Record<string, SQLInputValue> = {},
) =>
  insert(db, "atlasez_member_applications", {
    id,
    name: "合成応募者",
    email: privateEmail,
    interests: "",
    message: privateBody,
    created_at: at(-60),
    updated_at: at(0),
    ...values,
  });

const delivery = (
  db: DatabaseSync,
  queue: DeliveryId,
  id: string,
  values: Record<string, SQLInputValue> = {},
) => {
  const common = {
    id,
    status: "pending",
    next_attempt_at: at(-1),
    created_at: at(-10),
    updated_at: at(0),
    ...values,
  };
  if (queue === "application-email") {
    application(db, `application-${id}`);
    insert(db, "atlasez_application_email_deliveries", {
      ...common,
      application_id: `application-${id}`,
      recipient_email: privateEmail,
      kind: "operator_notification",
      subject: privateBody,
      text_body: privateBody,
      html_body: privateBody,
    });
  } else if (queue === "seminar-application-email") {
    const seminar = db
      .prepare(
        "INSERT INTO seminars(title,details,proposal_status,recruitment,phase,created_at) VALUES (?,'{}','approved','open','active',?)",
      )
      .run("合成ゼミ", at(-60));
    insert(db, "seminar_email_deliveries", {
      ...common,
      seminar_number: Number(seminar.lastInsertRowid),
      recipient_email: privateEmail,
      subject: privateBody,
      text_body: privateBody,
      html_body: privateBody,
    });
  } else {
    insert(db, "discord_notifications", {
      ...common,
      dedupe_key: id,
      kind: "synthetic-test",
      destination_kind: "channel",
      destination_ref: "PRIVATE_DISCORD_CHANNEL",
      content: privateBody,
    });
  }
};

const document = (
  db: DatabaseSync,
  id: string,
  values: Record<string, SQLInputValue> = {},
) =>
  insert(db, "editorial_documents", {
    id,
    subject: "mathematics",
    category: "overview",
    slug: id,
    title: "合成記事",
    concept_id: `mathematics.overview.${id}`,
    body: privateBody,
    status: "draft",
    created_by: privateEmail,
    updated_by: privateEmail,
    created_at: at(-120),
    updated_at: at(0),
    ...values,
  });

const publication = (
  db: DatabaseSync,
  id: string,
  values: Record<string, SQLInputValue> = {},
) => {
  document(db, `document-${id}`, { status: "approved" });
  insert(db, "editorial_publication_runs", {
    id,
    document_id: `document-${id}`,
    action: "publish",
    state: "queued",
    created_by: privateEmail,
    created_at: at(-120),
    updated_at: at(0),
    ...values,
  });
};

const reminder = (db: DatabaseSync, id: string) => {
  const email = `${id}@example.invalid`;
  insert(db, "editorial_tasks", {
    id: `task-${id}`,
    title: "合成タスク",
    reminder_email: email,
    created_by: privateEmail,
    created_at: at(-60),
    updated_at: at(0),
  });
  insert(db, "editorial_task_reminders", {
    id: `reminder-${id}`,
    task_id: `task-${id}`,
    remind_at: at(-5),
    remind_at_utc: at(-5),
    timezone: "UTC",
    created_at: at(-60),
  });
  insert(db, "editorial_task_reminder_delivery_attempts", {
    delivery_key: id,
    reminder_id: `reminder-${id}`,
    recipient_email: email,
    occurrence_at: at(-5),
    occurrence_timezone: "UTC",
    payload_json: JSON.stringify({ text: privateBody }),
    provider_idempotency_key: `provider-${id}`,
    status: "retry",
    next_attempt_at: at(-1),
    retry_deadline_at: at(60),
    created_at: at(-5),
    updated_at: at(0),
  });
  return email;
};

describe("scheduled job queue health", () => {
  it("reads all nine empty queues as verified zero counts", async () => {
    const { env } = createAdminTestEnvironment();
    const queues = await readScheduledJobQueues(env.REPORTS, now);
    expect(queues.map((queue) => queue.id)).toEqual([
      "editorial-publication",
      "application-email",
      "seminar-application-email",
      "discord-notifications",
      "task-reminders",
      "discord-provisioning",
      "member-procedures",
      "task-templates",
      "scheduled-editorial-publications",
    ]);
    for (const queue of queues)
      expect(queue).toMatchObject({
        status: "ok",
        pendingCount: 0,
        retryCount: 0,
        failedCount: 0,
        oldestPendingAt: null,
        oldestPendingAgeMs: null,
      });
  });

  it("reports a missing table as unknown without inventing zero counts or hiding other queues", async () => {
    const { db, env } = createAdminTestEnvironment();
    db.exec("DROP TABLE seminar_email_deliveries");
    const queues = await readScheduledJobQueues(env.REPORTS, now);
    expect(
      queues.find((queue) => queue.id === "seminar-application-email"),
    ).toMatchObject({
      status: "unknown",
      pendingCount: null,
      retryCount: null,
      failedCount: null,
      oldestPendingAt: null,
      oldestPendingAgeMs: null,
    });
    expect(
      queues
        .filter((queue) => queue.id !== "seminar-application-email")
        .every((queue) => queue.status === "ok"),
    ).toBe(true);
  });

  it.each(deliveryIds)(
    "counts current %s states and failures in the last 24 hours",
    async (queueId) => {
      const { db, env } = createAdminTestEnvironment();
      delivery(db, queueId, "pending");
      delivery(db, queueId, "retry", {
        status: "retry",
        created_at: at(-120),
        next_attempt_at: at(30),
      });
      delivery(db, queueId, "sending", {
        status: "sending",
        created_at: at(-20),
        next_attempt_at: at(-90),
        claimed_at: at(-2),
      });
      delivery(db, queueId, "recent-failure", {
        status: "failed",
        updated_at: at(-1440),
        last_error: privateError,
      });
      delivery(db, queueId, "old-failure", {
        status: "failed",
        updated_at: at(-1441),
        last_error: privateError,
      });
      delivery(db, queueId, "sent", { status: "sent", created_at: at(-180) });

      const queue = (await readScheduledJobQueues(env.REPORTS, now)).find(
        (item) => item.id === queueId,
      )!;
      expect(queue).toMatchObject({
        status: "warning",
        pendingCount: 3,
        retryCount: 1,
        failedCount: 1,
        oldestPendingAt: at(-120),
        oldestPendingAgeMs: 120 * 60_000,
      });
      expect(queue.detail).toContain("直近24時間");
      expect(queue.detail).not.toContain("滞留しています");
    },
  );

  it.each(deliveryIds)(
    "does not classify a future %s retry as overdue because it was enqueued long ago",
    async (queueId) => {
      const { db, env } = createAdminTestEnvironment();
      delivery(db, queueId, "future-retry", {
        status: "retry",
        created_at: at(-2880),
        next_attempt_at: at(30),
      });
      const first = (await readScheduledJobQueues(env.REPORTS, now)).find(
        (item) => item.id === queueId,
      )!;
      expect(first).toMatchObject({
        status: "ok",
        pendingCount: 1,
        retryCount: 1,
        failedCount: 0,
        oldestPendingAt: at(-2880),
        oldestPendingAgeMs: 2880 * 60_000,
      });

      const delayed = (
        await readScheduledJobQueues(env.REPORTS, new Date(at(46)))
      ).find((item) => item.id === queueId)!;
      expect(delayed.status).toBe("warning");
      expect(delayed.detail).toContain("予定時刻を過ぎた処理が滞留");
    },
  );

  it("uses publication run creation time for a stuck release and excludes unsubmitted drafts", async () => {
    const { db, env } = createAdminTestEnvironment();
    document(db, "unsubmitted-draft", {
      scheduled_publish_at: at(-240),
      created_at: at(-1440),
    });
    publication(db, "stuck", { created_at: at(-120), updated_at: at(0) });
    publication(db, "completed", {
      state: "published",
      created_at: at(-480),
      updated_at: at(-120),
    });

    const queues = await readScheduledJobQueues(env.REPORTS, now);
    const queue = queues.find((item) => item.id === "editorial-publication")!;
    expect(queue).toMatchObject({
      status: "warning",
      pendingCount: 1,
      retryCount: 0,
      failedCount: 0,
      oldestPendingAt: at(-120),
      oldestPendingAgeMs: 120 * 60_000,
    });
    expect(queue.detail).toContain("滞留しています");
    expect(
      queues.find((item) => item.id === "scheduled-editorial-publications")
        ?.pendingCount,
    ).toBe(0);
  });

  it("flags publication operator intervention even before the one-hour delay threshold", async () => {
    const { db, env } = createAdminTestEnvironment();
    publication(db, "operator-needed", {
      state: "needs_operator",
      created_at: at(-1),
      updated_at: at(-1),
      error_message: privateError,
    });
    const queue = (await readScheduledJobQueues(env.REPORTS, now)).find(
      (item) => item.id === "editorial-publication",
    )!;
    expect(queue).toMatchObject({
      status: "warning",
      pendingCount: 1,
      failedCount: 1,
    });
    expect(queue.detail).toContain("自動処理だけでは完了できない");
    expect(queue.detail).not.toContain("滞留しています");
  });

  it.each(["published", "unpublished"] as const)(
    "clears an old publication warning after a newer %s run for the same document",
    async (recoveredState) => {
      const { db, env } = createAdminTestEnvironment();
      publication(db, "old-failure", {
        state: "needs_operator",
        created_at: at(-120),
        // Updating an old run must not make it newer than the recovery run.
        updated_at: at(0),
        error_message: privateError,
      });
      insert(db, "editorial_publication_runs", {
        id: "recovered",
        document_id: "document-old-failure",
        action: recoveredState === "published" ? "publish" : "unpublish",
        state: recoveredState,
        created_by: privateEmail,
        created_at: at(-1),
        updated_at: at(-1),
      });

      const queue = (await readScheduledJobQueues(env.REPORTS, now)).find(
        (item) => item.id === "editorial-publication",
      )!;
      expect(queue).toMatchObject({
        status: "ok",
        pendingCount: 0,
        retryCount: 0,
        failedCount: 0,
        oldestPendingAt: null,
        oldestPendingAgeMs: null,
      });
    },
  );

  it("keeps an unresolved latest publication failure visible beyond the 24-hour counter window", async () => {
    const { db, env } = createAdminTestEnvironment();
    publication(db, "unresolved", {
      state: "failed",
      created_at: at(-2880),
      updated_at: at(-1500),
      error_message: privateError,
    });
    const queue = (await readScheduledJobQueues(env.REPORTS, now)).find(
      (item) => item.id === "editorial-publication",
    )!;
    expect(queue).toMatchObject({ status: "warning", failedCount: 0 });
    expect(queue.detail).toContain("自動処理だけでは完了できない");
  });

  it("flags a disabled task template with an unresolved error even when its update time is old", async () => {
    const { db, env } = createAdminTestEnvironment();
    insert(db, "editorial_task_templates", {
      id: "disabled-after-failure",
      owner_email: privateEmail,
      project_id: "atlas",
      name: "合成定期タスク",
      title: "合成タスク",
      enabled: 0,
      schedule: "daily",
      next_run_at: at(-2880),
      last_error: privateError,
      created_at: at(-4320),
      updated_at: at(-2880),
    });
    const failed = (await readScheduledJobQueues(env.REPORTS, now)).find(
      (item) => item.id === "task-templates",
    )!;
    expect(failed).toMatchObject({
      status: "warning",
      pendingCount: 0,
      failedCount: 0,
    });
    expect(failed.detail).toContain("自動処理だけでは完了できない");

    db.prepare(
      "UPDATE editorial_task_templates SET last_error=NULL WHERE id=?",
    ).run("disabled-after-failure");
    const resolved = (await readScheduledJobQueues(env.REPORTS, now)).find(
      (item) => item.id === "task-templates",
    )!;
    expect(resolved).toMatchObject({ status: "ok", pendingCount: 0 });
  });

  it("counts claimed Discord provisioning as pending and warns only after its update is over 15 minutes old", async () => {
    const { db, env } = createAdminTestEnvironment();
    application(db, "claimed-provisioning", {
      status: "accepted",
      provisioning_status: "pending",
      provisioning_next_attempt_at: null,
      provisioning_last_attempt_at: at(-2880),
      created_at: at(-4320),
      updated_at: at(-15),
    });
    application(db, "not-accepted", {
      status: "new",
      provisioning_status: "pending",
      updated_at: at(-2880),
    });
    const running = (await readScheduledJobQueues(env.REPORTS, now)).find(
      (item) => item.id === "discord-provisioning",
    )!;
    expect(running).toMatchObject({
      status: "ok",
      pendingCount: 1,
      retryCount: 0,
      failedCount: 0,
      oldestPendingAt: at(-15),
      oldestPendingAgeMs: 15 * 60_000,
    });

    const overdue = (
      await readScheduledJobQueues(env.REPORTS, new Date(now.getTime() + 1))
    ).find((item) => item.id === "discord-provisioning")!;
    expect(overdue).toMatchObject({
      status: "warning",
      pendingCount: 1,
      retryCount: 0,
      failedCount: 0,
    });
    expect(overdue.detail).toContain("予定時刻を過ぎた処理が滞留");
  });

  it("excludes inactive or obsolete reminder recipients and flags an active retry whose deadline expired", async () => {
    const { db, env } = createAdminTestEnvironment();
    for (const id of [
      "active",
      "done",
      "archived-task",
      "test-task",
      "changed-email",
      "changed-occurrence",
      "paused",
      "withdrawn",
      "archived-member",
    ])
      reminder(db, id);
    db.prepare("UPDATE editorial_tasks SET status='done' WHERE id=?").run(
      "task-done",
    );
    db.prepare("UPDATE editorial_tasks SET archived_at=? WHERE id=?").run(
      at(-1),
      "task-archived-task",
    );
    db.prepare("UPDATE editorial_tasks SET is_test_data=1 WHERE id=?").run(
      "task-test-task",
    );
    db.prepare("UPDATE editorial_tasks SET reminder_email=? WHERE id=?").run(
      "changed-to@example.invalid",
      "task-changed-email",
    );
    db.prepare(
      "UPDATE editorial_task_reminders SET remind_at_utc=? WHERE id=?",
    ).run(at(60), "reminder-changed-occurrence");
    for (const state of ["paused", "withdrawn"])
      insert(db, "atlasez_project_member_lifecycle", {
        project_id: "atlas",
        email: `${state}@example.invalid`,
        state,
        role_snapshot: "{}",
        last_request_id: `request-${state}`,
        updated_at: at(-1),
      });
    insert(db, "admin_member_lifecycle", {
      email: "archived-member@example.invalid",
      status: "archived",
      created_at: at(-60),
      updated_at: at(-1),
    });
    const first = (await readScheduledJobQueues(env.REPORTS, now)).find(
      (item) => item.id === "task-reminders",
    )!;
    expect(first).toMatchObject({
      status: "ok",
      pendingCount: 1,
      retryCount: 1,
      failedCount: 0,
      oldestPendingAt: at(-5),
      oldestPendingAgeMs: 5 * 60_000,
    });

    db.prepare(
      "UPDATE editorial_task_reminder_delivery_attempts SET retry_deadline_at=?,next_attempt_at=? WHERE delivery_key=?",
    ).run(at(-1), at(30), "active");
    const expired = (await readScheduledJobQueues(env.REPORTS, now)).find(
      (item) => item.id === "task-reminders",
    )!;
    expect(expired).toMatchObject({
      status: "warning",
      pendingCount: 1,
      retryCount: 1,
      failedCount: 0,
    });
    expect(expired.detail).toContain("自動処理だけでは完了できない");
    expect(expired.detail).not.toContain("滞留しています");
  });

  it("counts only due eligible scheduled publications", async () => {
    const { db, env } = createAdminTestEnvironment();
    document(db, "due", { status: "approved", scheduled_publish_at: at(-30) });
    document(db, "future", {
      status: "approved",
      scheduled_publish_at: at(30),
    });
    document(db, "draft", { status: "draft", scheduled_publish_at: at(-60) });
    document(db, "has-pr", {
      status: "approved",
      scheduled_publish_at: at(-60),
      publication_pr_number: 123,
    });
    document(db, "already-published", {
      status: "approved",
      scheduled_publish_at: at(-60),
      published_at: at(-50),
    });
    const queue = (await readScheduledJobQueues(env.REPORTS, now)).find(
      (item) => item.id === "scheduled-editorial-publications",
    )!;
    expect(queue).toMatchObject({
      status: "warning",
      pendingCount: 1,
      retryCount: 0,
      failedCount: 0,
      oldestPendingAt: at(-30),
      oldestPendingAgeMs: 30 * 60_000,
    });
  });

  it("returns aggregate metadata only and works with SQLite writes disabled", async () => {
    const { db, env } = createAdminTestEnvironment();
    delivery(db, "application-email", "private-app");
    delivery(db, "seminar-application-email", "private-seminar");
    delivery(db, "discord-notifications", "private-discord", {
      status: "failed",
      last_error: privateError,
    });
    publication(db, "private-publication", {
      state: "needs_operator",
      error_message: privateError,
    });
    reminder(db, "private-reminder");
    const changesBefore = db.prepare("SELECT total_changes() AS changes").get();
    db.exec("PRAGMA query_only=ON");
    const queues = await readScheduledJobQueues(env.REPORTS, now);
    expect(queues.every((queue) => queue.status !== "unknown")).toBe(true);
    expect(db.prepare("SELECT total_changes() AS changes").get()).toEqual(
      changesBefore,
    );
    expect(fetch).not.toHaveBeenCalled();
    const output = JSON.stringify(queues);
    for (const secret of [
      privateEmail,
      privateBody,
      privateError,
      "PRIVATE_DISCORD_CHANNEL",
      "private-reminder@example.invalid",
    ])
      expect(output).not.toContain(secret);
    for (const queue of queues)
      expect(Object.keys(queue).sort()).toEqual(
        [
          "detail",
          "failedCount",
          "id",
          "label",
          "oldestPendingAgeMs",
          "oldestPendingAt",
          "ownerRole",
          "pendingCount",
          "retryCount",
          "status",
        ].sort(),
      );
  });
});
