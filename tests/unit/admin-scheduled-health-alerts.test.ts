import { describe, expect, it, vi } from "vitest";
import {
  collectHealthAlertSignals,
  dispatchScheduledHealthAlerts,
  reconcileScheduledHealthAlerts,
  type HealthAlertSignal,
} from "../../src/lib/admin-scheduled-health-alerts";
import { readScheduledJobHealth } from "../../src/lib/admin-scheduled-job-health";
import {
  dispatchDueDiscordNotifications,
  hasScheduledHealthWebhook,
} from "../../src/lib/discord-notifications";
import { createAdminTestEnvironment } from "../helpers/admin-test-environment";

const start = Date.parse("2026-11-25T00:00:00.000Z");
const at = (minute: number) => new Date(start + minute * 60_000);
const signal = (status: HealthAlertSignal["status"]): HealthAlertSignal => ({
  id: "job:editorial-release-reconcile",
  label: "公開状態の照合",
  ownerRole: "公開担当",
  status,
});
const webhook = "https://discord.com/api/webhooks/123456789012345678/test-token";

describe("scheduled health alerts", () => {
  it("opens once, defers recovery until delivery, ignores stale sweeps and reopens", async () => {
    const { env, db } = createAdminTestEnvironment();
    const sweep = (status: HealthAlertSignal["status"], minute: number) =>
      reconcileScheduledHealthAlerts(env.REPORTS, [signal(status)], at(minute));
    const messages = () =>
      db
        .prepare(
          "SELECT kind,status,dedupe_key FROM discord_notifications ORDER BY created_at",
        )
        .all();
    await sweep("ok", 0);
    expect(messages()).toEqual([]);
    await sweep("bad", 1);
    await sweep("bad", 2);
    expect(messages()).toHaveLength(1);
    await sweep("ok", 3);
    expect(messages()).toHaveLength(1);
    db.exec("UPDATE discord_notifications SET status='sent'");
    await sweep("ok", 4);
    await sweep("ok", 5);
    await sweep("bad", 2);
    expect(messages()).toMatchObject([
      { kind: "admin-health-alert", status: "sent" },
      { kind: "admin-health-recovery", status: "pending" },
    ]);
    await sweep("bad", 6);
    expect(messages()).toHaveLength(3);
    expect(new Set(messages().map((row) => row.dedupe_key)).size).toBe(3);
  });

  it("does not claim recovery for an alert that was never delivered", async () => {
    const { env, db } = createAdminTestEnvironment();
    await reconcileScheduledHealthAlerts(env.REPORTS, [signal("bad")], at(1));
    db.exec("UPDATE discord_notifications SET status='failed'");
    await reconcileScheduledHealthAlerts(env.REPORTS, [signal("ok")], at(2));
    const messages = db.prepare("SELECT kind FROM discord_notifications").all();
    expect(messages).toEqual([{ kind: "admin-health-alert" }]);
    expect(
      db.prepare("SELECT * FROM admin_scheduled_alert_incidents").all(),
    ).toEqual([]);
  });

  it("keeps open incidents during unknown observations and ignores the alert transport", async () => {
    const { env, db } = createAdminTestEnvironment();
    const jobs = await readScheduledJobHealth(env.REPORTS, at(1));
    const target = jobs.jobs.find(
      (job) => job.id === "editorial-release-reconcile",
    )!;
    target.status = "warning";
    jobs.jobs.find((job) => job.id === "discord-notifications")!.status =
      "error";
    const signals = collectHealthAlertSignals(jobs, []);
    expect(signals).toEqual([signal("bad")]);
    await reconcileScheduledHealthAlerts(env.REPORTS, signals, at(1));
    db.exec("UPDATE discord_notifications SET status='sent'");
    target.status = "running";
    await reconcileScheduledHealthAlerts(
      env.REPORTS,
      collectHealthAlertSignals(jobs, []),
      at(2),
    );
    const messages = db.prepare("SELECT kind FROM discord_notifications").all();
    expect(messages).toEqual([{ kind: "admin-health-alert" }]);
    target.status = "ok";
    const unavailable = { ...jobs, available: false };
    expect(collectHealthAlertSignals(unavailable, [])).toEqual([]);
  });

  it("rolls back incident and watermark when the outbox is unavailable", async () => {
    const { env, db } = createAdminTestEnvironment();
    db.exec("DROP TABLE discord_notifications");
    await expect(
      reconcileScheduledHealthAlerts(env.REPORTS, [signal("bad")], at(1)),
    ).rejects.toThrow();
    expect(
      db.prepare("SELECT * FROM admin_scheduled_alert_incidents").all(),
    ).toEqual([]);
    expect(
      db.prepare("SELECT * FROM admin_scheduled_alert_sweep").all(),
    ).toEqual([]);
  });

  it("is opt-in and rejects a non-webhook Discord URL without reading D1", async () => {
    const { env } = createAdminTestEnvironment();
    const prepare = vi.spyOn(env.REPORTS, "prepare");
    await dispatchScheduledHealthAlerts(env, at(0));
    await dispatchScheduledHealthAlerts(
      {
        ...env,
        DISCORD_ADMIN_HEALTH_WEBHOOK_URL: "https://discord.com/channels/1/2",
      },
      at(0),
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(
      hasScheduledHealthWebhook({
        ...env,
        DISCORD_ADMIN_HEALTH_WEBHOOK_URL: webhook,
      }),
    ).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pauses only health notifications without consuming retries", async () => {
    const { env, db } = createAdminTestEnvironment();
    await reconcileScheduledHealthAlerts(env.REPORTS, [signal("bad")], at(1));
    db.prepare(
      `INSERT INTO discord_notifications
         (id,dedupe_key,kind,destination_kind,destination_ref,content,
          next_attempt_at,created_at,updated_at)
       VALUES ('ordinary','ordinary','progress','webhook',
         'DISCORD_PROGRESS_WEBHOOK_URL','ordinary progress',?,?,?)`,
    ).run(at(1).toISOString(), at(1).toISOString(), at(1).toISOString());
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const ordinary = "https://discord.com/api/webhooks/1234567890/ordinary";
    const disabled = { ...env, DISCORD_PROGRESS_WEBHOOK_URL: ordinary };
    const first = await dispatchDueDiscordNotifications(disabled, {
      now: at(2),
      fetcher,
      limit: 1,
    });
    expect(first.sent).toBe(1);
    const health = () =>
      db
        .prepare(
          "SELECT status,attempt_count FROM discord_notifications WHERE kind='admin-health-alert'",
        )
        .get();
    expect(health()).toEqual({ status: "pending", attempt_count: 0 });
    expect(fetcher.mock.calls).toHaveLength(1);
    const enabled = {
      ...disabled,
      DISCORD_ADMIN_HEALTH_WEBHOOK_URL: webhook,
    };
    const resumed = await dispatchDueDiscordNotifications(enabled, {
      now: at(3),
      fetcher,
    });
    expect(resumed.sent).toBe(1);
    expect(health()).toEqual({ status: "sent", attempt_count: 1 });
    expect(fetcher.mock.calls).toHaveLength(2);
  });

  it("uses only the dedicated destination and the existing queued sender", async () => {
    const { env, db } = createAdminTestEnvironment();
    await reconcileScheduledHealthAlerts(env.REPORTS, [signal("bad")], at(1));
    const rows = db
      .prepare("SELECT destination_ref,content FROM discord_notifications")
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].destination_ref).toBe("DISCORD_ADMIN_HEALTH_WEBHOOK_URL");
    expect(JSON.stringify(rows)).not.toContain("test-token");
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const result = await dispatchDueDiscordNotifications(
      { ...env, DISCORD_ADMIN_HEALTH_WEBHOOK_URL: webhook },
      { now: at(2), fetcher },
    );
    expect(result.sent).toBe(1);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      webhook,
      expect.objectContaining({
        redirect: "error",
        body: expect.stringContaining('"allowed_mentions":{"parse":[]}'),
      }),
    );
  });
});
