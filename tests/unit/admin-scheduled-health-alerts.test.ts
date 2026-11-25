import { describe, expect, it, vi } from "vitest";
import {
  collectHealthAlertSignals,
  dispatchScheduledHealthAlerts,
  reconcileScheduledHealthAlerts,
  type HealthAlertSignal,
} from "../../src/lib/admin-scheduled-health-alerts";
import {
  readScheduledJobHealth,
  runObservedScheduledJob,
} from "../../src/lib/admin-scheduled-job-health";
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
const webhook = "https://discord.com/api/webhooks/123456789012345678/token";

describe("scheduled health alerts", () => {
  it("sends one alert after retry and one recovery for an observed job", async () => {
    const { env, db } = createAdminTestEnvironment();
    const configured = { ...env, DISCORD_ADMIN_HEALTH_WEBHOOK_URL: webhook };
    const logger = { info: vi.fn(), error: vi.fn() };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockImplementation(async () => new Response(null, { status: 204 }));
    const job = "editorial-release-reconcile";
    const deliver = (minute: number) =>
      dispatchDueDiscordNotifications(configured, {
        now: at(minute),
        fetcher,
        logger,
      });
    const observe = (minute: number, healthy: boolean) =>
      runObservedScheduledJob(
        env.REPORTS,
        job,
        async (report) => {
          if (!healthy)
            report({ status: "warning", code: "dependency_failed" });
        },
        { now: () => at(minute), logger },
      );

    await observe(1, false);
    await dispatchScheduledHealthAlerts(configured, at(1));
    await dispatchScheduledHealthAlerts(configured, at(2));
    expect((await deliver(2)).failed).toBe(1);
    expect(
      db
        .prepare("SELECT status,attempt_count FROM discord_notifications")
        .all(),
    ).toEqual([{ status: "retry", attempt_count: 1 }]);

    await observe(3, true);
    await dispatchScheduledHealthAlerts(configured, at(3));
    expect((await deliver(6)).sent).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await deliver(7)).sent).toBe(1);
    await observe(8, true);
    await dispatchScheduledHealthAlerts(configured, at(8));
    await dispatchScheduledHealthAlerts(configured, at(9));
    expect((await deliver(9)).sent).toBe(1);
    expect((await deliver(10)).sent).toBe(0);

    const delivered = fetcher.mock.calls.map(([url, options]) => {
      expect(url).toBe(webhook);
      const payload = JSON.parse(String(options?.body));
      expect(payload.allowed_mentions).toEqual({ parse: [] });
      return payload.content;
    });
    expect(delivered).toEqual([
      expect.stringContaining("【運営監視・異常検知】公開状態の照合"),
      expect.stringContaining("【運営監視・異常検知】公開状態の照合"),
      expect.stringContaining("【運営監視・復旧確認】公開状態の照合"),
    ]);
    expect(
      db
        .prepare("SELECT status FROM discord_notifications ORDER BY created_at")
        .all(),
    ).toEqual([{ status: "sent" }, { status: "sent" }]);
  });

  it("deduplicates, defers recovery, ignores stale sweeps and reopens", async () => {
    const { env, db } = createAdminTestEnvironment();
    const sweep = (status: HealthAlertSignal["status"], minute: number) => {
      const signals = [signal(status)];
      return reconcileScheduledHealthAlerts(env.REPORTS, signals, at(minute));
    };
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
    const keys = messages().map((row) => row.dedupe_key);
    expect(new Set(keys).size).toBe(3);
  });

  it("does not claim recovery for an alert that was never delivered", async () => {
    const { env, db } = createAdminTestEnvironment();
    await reconcileScheduledHealthAlerts(env.REPORTS, [signal("bad")], at(1));
    db.exec("UPDATE discord_notifications SET status='failed'");
    await reconcileScheduledHealthAlerts(env.REPORTS, [signal("ok")], at(2));
    const query = "SELECT kind FROM discord_notifications";
    const messages = db.prepare(query).all();
    expect(messages).toEqual([{ kind: "admin-health-alert" }]);
    expect(
      db.prepare("SELECT * FROM admin_scheduled_alert_incidents").all(),
    ).toEqual([]);
  });

  it("retains incidents for unknown states and ignores transport failures", async () => {
    const { env, db } = createAdminTestEnvironment();
    const jobs = await readScheduledJobHealth(env.REPORTS, at(1));
    const target = jobs.jobs.find(
      (job) => job.id === "editorial-release-reconcile",
    )!;
    target.status = "warning";
    const transportId = "discord-notifications";
    const transport = jobs.jobs.find((j) => j.id === transportId)!;
    transport.status = "error";
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
    const query = "SELECT kind FROM discord_notifications";
    const messages = db.prepare(query).all();
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
    const insert = db.prepare(
      `INSERT INTO discord_notifications
         (id,dedupe_key,kind,destination_kind,destination_ref,content,
          next_attempt_at,created_at,updated_at)
       VALUES ('ordinary','ordinary','progress','webhook',
         'DISCORD_PROGRESS_WEBHOOK_URL','ordinary progress',?,?,?)`,
    );
    const timestamp = at(1).toISOString();
    insert.run(timestamp, timestamp, timestamp);
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
    const enabled = { ...disabled, DISCORD_ADMIN_HEALTH_WEBHOOK_URL: webhook };
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
    expect(JSON.stringify(rows)).not.toContain(webhook);
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
