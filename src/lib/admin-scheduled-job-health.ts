import type { D1Database } from "./admin-database";

export const scheduledJobDefinitions = [
  {
    id: "editorial-publication-progress",
    label: "公開処理の進行",
    ownerRole: "公開担当",
    scheduleLabel: "1分ごと",
    intervalMs: 60_000,
  },
  {
    id: "editorial-release-reconcile",
    label: "公開状態の照合",
    ownerRole: "公開担当",
    scheduleLabel: "1分ごと",
    intervalMs: 60_000,
  },
  {
    id: "editorial-publication-sync",
    label: "公開記事情報の同期",
    ownerRole: "公開担当",
    scheduleLabel: "2分ごと",
    intervalMs: 120_000,
  },
  {
    id: "published-article-backup",
    label: "公開記事のバックアップ",
    ownerRole: "公開担当",
    scheduleLabel: "2分ごと",
    intervalMs: 120_000,
  },
  {
    id: "task-reminders",
    label: "タスクの期限通知",
    ownerRole: "運営管理者",
    scheduleLabel: "5分ごと",
    intervalMs: 300_000,
  },
  {
    id: "task-templates",
    label: "定期タスクの作成",
    ownerRole: "運営管理者",
    scheduleLabel: "5分ごと",
    intervalMs: 300_000,
  },
  {
    id: "member-procedures",
    label: "メンバー手続き",
    ownerRole: "運営管理者",
    scheduleLabel: "5分ごと",
    intervalMs: 300_000,
  },
  {
    id: "task-archive",
    label: "タスクのアーカイブ",
    ownerRole: "運営管理者",
    scheduleLabel: "5分ごと",
    intervalMs: 300_000,
  },
  {
    id: "application-email",
    label: "応募メールの配信",
    ownerRole: "メール担当",
    scheduleLabel: "5分ごと",
    intervalMs: 300_000,
  },
  {
    id: "seminar-application-email",
    label: "ゼミ応募メールの配信",
    ownerRole: "メール担当",
    scheduleLabel: "5分ごと",
    intervalMs: 300_000,
  },
  {
    id: "discord-provisioning",
    label: "Discord連携の設定",
    ownerRole: "Discord担当",
    scheduleLabel: "5分ごと",
    intervalMs: 300_000,
  },
  {
    id: "discord-role-sync",
    label: "Discordの権限同期",
    ownerRole: "Discord担当",
    scheduleLabel: "5分ごと",
    intervalMs: 300_000,
  },
  {
    id: "scheduled-editorial-publications",
    label: "予約記事の公開",
    ownerRole: "公開担当",
    scheduleLabel: "5分ごと",
    intervalMs: 300_000,
  },
  {
    id: "audit-archive",
    label: "操作履歴のアーカイブ",
    ownerRole: "データ管理担当",
    scheduleLabel: "5分ごと",
    intervalMs: 300_000,
  },
  {
    id: "discord-notifications",
    label: "Discord通知の配信",
    ownerRole: "Discord担当",
    scheduleLabel: "5分ごと",
    intervalMs: 300_000,
  },
  {
    id: "personal-data-retention",
    label: "個人情報の保持期限処理",
    ownerRole: "データ管理担当",
    scheduleLabel: "1時間ごと",
    intervalMs: 3_600_000,
  },
] as const;

export type ScheduledJobId = (typeof scheduledJobDefinitions)[number]["id"];

const errorCodes = [
  "not_configured",
  "invalid_configuration",
  "partial_failure",
  "execution_failed",
  "dependency_failed",
  "state_unconfirmed",
  "queue_unavailable",
] as const;

type ScheduledJobErrorCode = (typeof errorCodes)[number];

export type ScheduledJobOutcome = {
  status: "success" | "warning" | "skipped";
  code?: ScheduledJobErrorCode;
};

export type ScheduledJobReporter = (outcome: ScheduledJobOutcome) => void;

export type ScheduledJobHealthItem = {
  id: ScheduledJobId;
  label: string;
  ownerRole: string;
  scheduleLabel: string;
  status: "ok" | "warning" | "error" | "unknown" | "running";
  detail: string;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  consecutiveFailures: number;
  lastDurationMs: number | null;
  lastErrorCode: ScheduledJobErrorCode | null;
};

export type ScheduledJobHealthSnapshot = {
  available: boolean;
  generatedAt: string;
  jobs: ScheduledJobHealthItem[];
};

type JobRow = {
  job_id: string;
  last_status: string;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_succeeded_at: string | null;
  last_failed_at: string | null;
  consecutive_failures: number;
  last_duration_ms: number | null;
  last_error_code: string | null;
};

type TerminalOutcome = {
  status: ScheduledJobOutcome["status"] | "error";
  code?: ScheduledJobErrorCode;
};

type ObservationState = "recorded" | "not_recorded" | "unavailable";
type Logger = Pick<Console, "info" | "error">;

// Allow three missed intervals before warning. A stale success is not healthy,
// and a stale "running" record is not evidence that the task is still alive.
const staleIntervalMultiplier = 3;

const safeCode = (value: unknown): ScheduledJobErrorCode | null =>
  typeof value === "string" && (errorCodes as readonly string[]).includes(value)
    ? (value as ScheduledJobErrorCode)
    : null;

const safeLog = (
  logger: Logger,
  level: "info" | "error",
  event: Record<string, string | number | null>,
) => {
  try {
    logger[level](JSON.stringify(event));
  } catch {
    // Monitoring, including a broken log sink, must not change the task result.
  }
};

const recordObservation = async (
  write: () => Promise<{ meta?: { changes?: number } }>,
): Promise<ObservationState> => {
  try {
    const result = await write();
    if (result.meta?.changes === 1) return "recorded";
    if (result.meta?.changes === 0) return "not_recorded";
    return "unavailable";
  } catch {
    // Never inspect or serialize a database error; it can contain bound data.
    return "unavailable";
  }
};

export async function runObservedScheduledJob(
  db: D1Database,
  jobId: ScheduledJobId,
  task: (report: ScheduledJobReporter) => Promise<unknown>,
  options: { now?: () => Date; logger?: Logger } = {},
): Promise<unknown> {
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;
  const startedAt = now();
  const startedAtIso = startedAt.toISOString();
  const runId = crypto.randomUUID();
  let outcome: TerminalOutcome = { status: "success" };

  const report: ScheduledJobReporter = (reported) => {
    const ranks = { success: 0, skipped: 1, warning: 2 } as const;
    const status =
      reported?.status === "success" ||
      reported?.status === "skipped" ||
      reported?.status === "warning"
        ? reported.status
        : "warning";
    const normalized: ScheduledJobOutcome = {
      status,
      ...(status === "success"
        ? {}
        : {
            code:
              safeCode(reported?.code) ??
              (status === "warning" ? "partial_failure" : "state_unconfirmed"),
          }),
    };
    // A later successful substep cannot erase an earlier partial failure/skip.
    if (outcome.status !== "error" && ranks[status] >= ranks[outcome.status])
      outcome = normalized;
  };

  const startObservation = await recordObservation(() =>
    db
      .prepare(
        `INSERT INTO admin_scheduled_job_health
          (job_id,current_run_id,last_status,last_started_at,updated_at)
         VALUES (?,?,'running',?,?)
         ON CONFLICT(job_id) DO UPDATE SET
           current_run_id=excluded.current_run_id,
           last_status='running',
           last_started_at=excluded.last_started_at,
           updated_at=excluded.updated_at
         WHERE admin_scheduled_job_health.last_started_at IS NULL
            OR excluded.last_started_at >= admin_scheduled_job_health.last_started_at`,
      )
      .bind(jobId, runId, startedAtIso, startedAtIso)
      .run(),
  );
  safeLog(logger, startObservation === "unavailable" ? "error" : "info", {
    event: "admin_scheduled_job_started",
    jobId,
    runId,
    startedAt: startedAtIso,
    observation: startObservation,
  });

  try {
    return await task(report);
  } catch (error) {
    outcome = { status: "error", code: outcome.code ?? "execution_failed" };
    throw error;
  } finally {
    const finishedAt = now();
    const finishedAtIso = finishedAt.toISOString();
    const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
    const failed = outcome.status === "error" || outcome.status === "warning";
    const succeeded = outcome.status === "success";
    const code = outcome.code ?? null;
    // Keep the latest-started run's state, but retain success/failure times from
    // every completion. A concurrent empty run must not hide a later failure.
    const completionObservation = await recordObservation(() =>
      db
        .prepare(
          `UPDATE admin_scheduled_job_health SET
             last_status=CASE WHEN current_run_id=? THEN ? ELSE last_status END,
             last_finished_at=CASE WHEN current_run_id=? THEN ? ELSE last_finished_at END,
             last_succeeded_at=CASE
               WHEN ?=1 AND (last_succeeded_at IS NULL OR last_succeeded_at<?) THEN ?
               ELSE last_succeeded_at END,
             last_failed_at=CASE
               WHEN ?=1 AND (last_failed_at IS NULL OR last_failed_at<?) THEN ?
               ELSE last_failed_at END,
             consecutive_failures=CASE
               WHEN current_run_id<>? THEN consecutive_failures
               WHEN ?=1 THEN consecutive_failures+1
               WHEN ?=1 THEN 0
               ELSE consecutive_failures END,
             last_duration_ms=CASE WHEN current_run_id=? THEN ? ELSE last_duration_ms END,
             last_error_code=CASE WHEN current_run_id=? THEN ? ELSE last_error_code END,
             updated_at=CASE WHEN current_run_id=? THEN ? ELSE updated_at END
           WHERE job_id=?`,
        )
        .bind(
          runId,
          outcome.status,
          runId,
          finishedAtIso,
          Number(succeeded),
          finishedAtIso,
          finishedAtIso,
          Number(failed),
          finishedAtIso,
          finishedAtIso,
          runId,
          Number(failed),
          Number(succeeded),
          runId,
          durationMs,
          runId,
          code,
          runId,
          finishedAtIso,
          jobId,
        )
        .run(),
    );
    safeLog(
      logger,
      failed || completionObservation === "unavailable" ? "error" : "info",
      {
        event: "admin_scheduled_job_finished",
        jobId,
        runId,
        status: outcome.status,
        errorCode: code,
        finishedAt: finishedAtIso,
        durationMs,
        observation: completionObservation,
      },
    );
  }
}

const isoTime = (value: unknown): string | null => {
  if (typeof value !== "string" || !value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const failureDetails: Record<ScheduledJobErrorCode, string> = {
  not_configured: "必要な設定がないため、処理を実行できません。",
  invalid_configuration: "処理に必要な設定を確認してください。",
  partial_failure: "一部の処理が完了していません。",
  execution_failed: "処理の実行に失敗しました。",
  dependency_failed: "連携先の処理に失敗しています。",
  state_unconfirmed: "処理後の状態を確認できません。",
  queue_unavailable: "待機中の処理を確認できません。",
};

export async function readScheduledJobHealth(
  db: D1Database,
  now: Date = new Date(),
): Promise<ScheduledJobHealthSnapshot> {
  let available = true;
  let rows: JobRow[] = [];
  try {
    rows = (
      await db
        .prepare(
          `SELECT job_id,last_status,last_started_at,last_finished_at,
             last_succeeded_at,last_failed_at,consecutive_failures,
             last_duration_ms,last_error_code FROM admin_scheduled_job_health`,
        )
        .all<JobRow>()
    ).results;
  } catch {
    available = false;
  }
  const byId = new Map(rows.map((row) => [row.job_id, row]));
  return {
    available,
    generatedAt: now.toISOString(),
    jobs: scheduledJobDefinitions.map((definition): ScheduledJobHealthItem => {
      const row = byId.get(definition.id);
      const item: ScheduledJobHealthItem = {
        id: definition.id,
        label: definition.label,
        ownerRole: definition.ownerRole,
        scheduleLabel: definition.scheduleLabel,
        status: "unknown",
        detail: available
          ? "まだ実行記録がありません。"
          : "実行状況を取得できません。監視用データベースを確認してください。",
        lastStartedAt: isoTime(row?.last_started_at),
        lastFinishedAt: isoTime(row?.last_finished_at),
        lastSucceededAt: isoTime(row?.last_succeeded_at),
        lastFailedAt: isoTime(row?.last_failed_at),
        consecutiveFailures:
          Number.isSafeInteger(row?.consecutive_failures) &&
          Number(row?.consecutive_failures) >= 0
            ? Number(row?.consecutive_failures)
            : 0,
        lastDurationMs:
          Number.isSafeInteger(row?.last_duration_ms) &&
          Number(row?.last_duration_ms) >= 0
            ? Number(row?.last_duration_ms)
            : null,
        lastErrorCode: safeCode(row?.last_error_code),
      };
      if (!available || !row) return item;
      if (!item.lastStartedAt) {
        item.detail = "実行状態を確認できません。";
        return item;
      }
      const staleAfterMs = definition.intervalMs * staleIntervalMultiplier;
      if (row.last_status === "running") {
        const overdue =
          now.getTime() - Date.parse(item.lastStartedAt) > staleAfterMs;
        item.status = overdue ? "warning" : "running";
        item.detail = overdue
          ? "実行開始から予定間隔の3回分を超えても完了を確認できません。"
          : "定期処理を実行しています。";
      } else if (row.last_status === "error" || row.last_status === "warning") {
        item.status = row.last_status === "error" ? "error" : "warning";
        item.detail = failureDetails[item.lastErrorCode ?? "execution_failed"];
      } else if (row.last_status === "skipped") {
        item.status = "warning";
        item.detail = item.lastErrorCode
          ? failureDetails[item.lastErrorCode]
          : "前回の処理は実行されていません。";
      } else if (
        row.last_status === "success" &&
        item.lastFinishedAt &&
        item.lastSucceededAt
      ) {
        const overdue =
          now.getTime() - Date.parse(item.lastFinishedAt) > staleAfterMs;
        const laterFailure =
          item.lastFailedAt !== null &&
          Date.parse(item.lastFailedAt) > Date.parse(item.lastSucceededAt);
        item.status = overdue || laterFailure ? "warning" : "ok";
        item.detail = laterFailure
          ? "並行していた処理が、最後の成功より後に失敗しています。"
          : overdue
            ? "予定間隔の3回分を超えて新しい実行結果が届いていません。"
            : "前回の処理は正常に完了しました。";
      } else {
        item.detail = "実行状態を確認できません。";
      }
      return item;
    }),
  };
}
