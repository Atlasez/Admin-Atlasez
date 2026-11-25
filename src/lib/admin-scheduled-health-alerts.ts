import type { D1Database } from "./admin-database";
import {
  readScheduledJobHealth,
  type ScheduledJobHealthSnapshot,
} from "./admin-scheduled-job-health";
import {
  readScheduledJobQueues,
  type ScheduledQueueHealth,
} from "./admin-scheduled-job-queues";
import {
  hasScheduledHealthWebhook,
  type DiscordNotificationEnv,
} from "./discord-notifications";

export type HealthAlertSignal = {
  id: string;
  label: string;
  ownerRole: string;
  status: "ok" | "bad";
};

export function collectHealthAlertSignals(
  jobs: ScheduledJobHealthSnapshot,
  queues: ScheduledQueueHealth[],
): HealthAlertSignal[] {
  const signals: HealthAlertSignal[] = [];
  const append = (
    prefix: string,
    item: {
      id: string;
      label: string;
      ownerRole: string;
      status: string;
    },
  ) => {
    // Never create an alert about the transport that delivers these alerts.
    // Unknown and running are neither confirmed failures nor recoveries.
    if (item.id === "discord-notifications") return;
    if (
      item.status !== "ok" &&
      item.status !== "warning" &&
      item.status !== "error"
    )
      return;
    signals.push({
      id: prefix + item.id,
      label: item.label,
      ownerRole: item.ownerRole,
      status: item.status === "ok" ? "ok" : "bad",
    });
  };
  if (jobs.available) for (const job of jobs.jobs) append("job:", job);
  for (const queue of queues) append("queue:", queue);
  return signals;
}

// A single atomic D1 batch claims the snapshot, opens incidents, enqueues
// transitions and closes confirmed recoveries. Older overlapping sweeps are
// ignored even if they finish later. Queue delivery remains the existing job.
export async function reconcileScheduledHealthAlerts(
  db: D1Database,
  signals: HealthAlertSignal[],
  observedAt: Date,
) {
  const now = observedAt.toISOString();
  const sweep = crypto.randomUUID();
  const rows = JSON.stringify(
    signals.map((signal) => ({
      id: signal.id,
      status: signal.status,
      alert: [
        `【運営監視・異常検知】${signal.label}`,
        `確認先: ${signal.ownerRole}`,
        `観測時刻: ${now}`,
        "開発者画面: https://admin.atlasez.org/admin/developer/",
      ].join("\n"),
      recovery: [
        `【運営監視・復旧確認】${signal.label}`,
        `確認先: ${signal.ownerRole}`,
        `観測時刻: ${now}`,
        "開発者画面: https://admin.atlasez.org/admin/developer/",
      ].join("\n"),
    })),
  );
  await db.batch([
    db
      .prepare(
        `INSERT INTO admin_scheduled_alert_sweep(singleton,observed_at,sweep_id)
         VALUES(1,?,?)
         ON CONFLICT(singleton) DO UPDATE SET
           observed_at=excluded.observed_at,sweep_id=excluded.sweep_id
         WHERE excluded.observed_at>admin_scheduled_alert_sweep.observed_at`,
      )
      .bind(now, sweep),
    db
      .prepare(
        `INSERT INTO admin_scheduled_alert_incidents(signal_id,incident_id,opened_at)
         SELECT json_extract(j.value,'$.id'),?,? FROM json_each(?) j
         WHERE json_extract(j.value,'$.status')='bad'
           AND EXISTS(SELECT 1 FROM admin_scheduled_alert_sweep WHERE sweep_id=?)
         ON CONFLICT(signal_id) DO NOTHING`,
      )
      .bind(sweep, now, rows, sweep),
    db
      .prepare(
        `INSERT INTO discord_notifications
           (id,dedupe_key,kind,destination_kind,destination_ref,content,
            next_attempt_at,created_at,updated_at)
         SELECT 'admin-health:alert:'||i.incident_id||':'||i.signal_id,
                'admin-health:alert:'||i.incident_id||':'||i.signal_id,
                'admin-health-alert','webhook','DISCORD_ADMIN_HEALTH_WEBHOOK_URL',
                json_extract(j.value,'$.alert'),?,?,?
           FROM json_each(?) j JOIN admin_scheduled_alert_incidents i
             ON i.signal_id=json_extract(j.value,'$.id')
          WHERE i.incident_id=? AND json_extract(j.value,'$.status')='bad'
            AND EXISTS(SELECT 1 FROM admin_scheduled_alert_sweep WHERE sweep_id=?)
         ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .bind(now, now, now, rows, sweep, sweep),
    db
      .prepare(
        `INSERT INTO discord_notifications
           (id,dedupe_key,kind,destination_kind,destination_ref,content,
            next_attempt_at,created_at,updated_at)
         SELECT 'admin-health:recovery:'||i.incident_id||':'||i.signal_id,
                'admin-health:recovery:'||i.incident_id||':'||i.signal_id,
                'admin-health-recovery','webhook','DISCORD_ADMIN_HEALTH_WEBHOOK_URL',
                json_extract(j.value,'$.recovery'),?,?,?
           FROM json_each(?) j JOIN admin_scheduled_alert_incidents i
             ON i.signal_id=json_extract(j.value,'$.id')
           JOIN discord_notifications a
             ON a.dedupe_key='admin-health:alert:'||i.incident_id||':'||i.signal_id
            AND a.status='sent'
          WHERE json_extract(j.value,'$.status')='ok'
            AND EXISTS(SELECT 1 FROM admin_scheduled_alert_sweep WHERE sweep_id=?)
         ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .bind(now, now, now, rows, sweep),
    db
      .prepare(
        `DELETE FROM admin_scheduled_alert_incidents
          WHERE signal_id IN (
            SELECT json_extract(value,'$.id') FROM json_each(?)
             WHERE json_extract(value,'$.status')='ok'
          )
          AND NOT EXISTS(
            SELECT 1 FROM discord_notifications a
             WHERE a.dedupe_key='admin-health:alert:'||
               admin_scheduled_alert_incidents.incident_id||':'||
               admin_scheduled_alert_incidents.signal_id
               AND a.status IN ('pending','retry','sending')
          )
          AND EXISTS(SELECT 1 FROM admin_scheduled_alert_sweep WHERE sweep_id=?)`,
      )
      .bind(rows, sweep),
  ]);
}

type HealthAlertEnv = DiscordNotificationEnv & { REPORTS: D1Database };

/** Opt-in, five-minute sweep; never sends inline or changes business results. */
export async function dispatchScheduledHealthAlerts(
  env: HealthAlertEnv,
  now = new Date(),
) {
  if (!hasScheduledHealthWebhook(env)) return;
  try {
    const [jobs, queues] = await Promise.all([
      readScheduledJobHealth(env.REPORTS, now),
      readScheduledJobQueues(env.REPORTS, now),
    ]);
    await reconcileScheduledHealthAlerts(
      env.REPORTS,
      collectHealthAlertSignals(jobs, queues),
      now,
    );
  } catch {
    // No raw exception, SQL values or destination secret in logs.
    try {
      console.error(
        JSON.stringify({ event: "admin_scheduled_health_alert_sweep_failed" }),
      );
    } catch {
      // Logging is best effort too.
    }
  }
}
