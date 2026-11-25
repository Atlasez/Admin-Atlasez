import type { D1Database } from "./admin-database";
import { ACTIVE_REMINDER_RECIPIENT_SQL } from "./task-reminder-delivery";

export type ScheduledQueueHealth = {
  id: string;
  label: string;
  ownerRole: string;
  status: "ok" | "warning" | "error" | "unknown";
  detail: string;
  pendingCount: number | null;
  retryCount: number | null;
  failedCount: number | null;
  oldestPendingAt: string | null;
  oldestPendingAgeMs: number | null;
};

type QueueDefinition = {
  id: string;
  label: string;
  ownerRole: string;
  source: string;
  pending: string;
  retry: string;
  failed: string;
  createdAt: string;
  updatedAt: string;
  dueAt: string;
  blocked?: string;
  maxDelayMs?: number;
  detail: string;
};

// SQL fragments and identifiers are fixed source definitions, never request input.
const deliveryQueue = (
  id: string,
  label: string,
  ownerRole: string,
  table: string,
): QueueDefinition => ({
  id,
  label,
  ownerRole,
  source: `${table} q`,
  pending: "q.status IN ('pending','retry','sending')",
  retry: "q.status='retry'",
  failed: "q.status='failed'",
  createdAt: "q.created_at",
  updatedAt: "q.updated_at",
  dueAt:
    "CASE WHEN q.status='sending' THEN COALESCE(q.claimed_at,q.updated_at) ELSE q.next_attempt_at END",
  detail:
    "未完了は再試行待ち・送信処理中を含みます。最古時刻はキュー登録時刻です。外部サービスでの到達は別途確認してください。",
});

const queueDefinitions: QueueDefinition[] = [
  {
    id: "editorial-publication",
    label: "記事公開",
    ownerRole: "公開担当",
    // Terminal runs remain as history after an explicit retry. Only the latest
    // publish/unpublish attempt for each document describes its current queue.
    source: `(SELECT r.* FROM editorial_publication_runs r
      WHERE NOT EXISTS(SELECT 1 FROM editorial_publication_runs newer
        WHERE newer.document_id=r.document_id
          AND (newer.created_at>r.created_at
            OR (newer.created_at=r.created_at AND newer.id>r.id)))) q`,
    pending:
      "q.state IN ('queued','checks_pending','merge_pending','deploy_pending','retry_wait','needs_operator')",
    retry: "q.state='retry_wait'",
    failed: "q.state IN ('failed','needs_operator')",
    createdAt: "q.created_at",
    updatedAt: "q.updated_at",
    dueAt: "q.created_at",
    blocked: "q.state IN ('failed','needs_operator')",
    maxDelayMs: 60 * 60_000,
    detail:
      "記事ごとの最新の公開・公開取消処理を確認します。最古時刻は処理の開始時刻です。下書きと再試行で置き換わった履歴は含みません。失敗・担当者の確認待ちは経過時間に関係なく表示します。",
  },
  deliveryQueue(
    "application-email",
    "応募メール",
    "メール担当",
    "atlasez_application_email_deliveries",
  ),
  deliveryQueue(
    "seminar-application-email",
    "ゼミ応募メール",
    "メール担当",
    "seminar_email_deliveries",
  ),
  deliveryQueue(
    "discord-notifications",
    "Discord通知",
    "Discord担当",
    "discord_notifications",
  ),
  {
    ...deliveryQueue(
      "task-reminders",
      "タスク通知",
      "運営管理者",
      "editorial_task_reminder_delivery_attempts",
    ),
    source: `(SELECT a.* FROM editorial_task_reminder_delivery_attempts a
      JOIN editorial_task_reminders r ON r.id=a.reminder_id
      JOIN editorial_tasks t ON t.id=r.task_id
      WHERE t.status!='done' AND t.archived_at IS NULL AND t.is_test_data=0
        AND r.remind_at_utc=a.occurrence_at
        AND lower(trim(t.reminder_email))=lower(a.recipient_email)
        ${ACTIVE_REMINDER_RECIPIENT_SQL}) q`,
    blocked:
      "q.status IN ('pending','retry','sending') AND julianday(q.retry_deadline_at)<=clock.now",
    detail:
      "現在のタスク・宛先・所属に対応する送信記録です。完了・アーカイブ・対象外の記録は含みません。再試行期限切れは確認が必要です。",
  },
  {
    id: "discord-provisioning",
    label: "Discord参加設定",
    ownerRole: "Discord担当",
    source: "atlasez_member_applications q",
    pending:
      "q.status='accepted' AND q.provisioning_status IN ('pending','failed')",
    retry:
      "q.status='accepted' AND q.provisioning_status='failed' AND q.provisioning_next_attempt_at IS NOT NULL",
    failed: "q.status='accepted' AND q.provisioning_status='failed'",
    createdAt:
      "CASE WHEN q.provisioning_status='pending' THEN q.updated_at ELSE COALESCE(q.provisioning_next_attempt_at,q.updated_at) END",
    updatedAt: "COALESCE(q.provisioning_last_attempt_at,q.updated_at)",
    dueAt:
      "CASE WHEN q.provisioning_status='pending' THEN q.updated_at ELSE q.provisioning_next_attempt_at END",
    blocked:
      "q.status='accepted' AND q.provisioning_status='failed' AND q.provisioning_next_attempt_at IS NULL",
    detail:
      "参加設定の処理中・再試行待ちです。最古時刻は再試行予定時刻（処理中・予定なしは最終更新時刻）。次回予定がない失敗は担当者の確認が必要です。",
  },
  {
    id: "member-procedures",
    label: "会員手続き",
    ownerRole: "運営管理者",
    source: "atlasez_member_procedure_requests q",
    pending: "q.status='scheduled' AND julianday(q.effective_at)<=clock.now",
    retry: "0",
    failed: "q.status='scheduled' AND COALESCE(q.execution_error,'')<>''",
    createdAt: "q.effective_at",
    updatedAt: "q.updated_at",
    dueAt: "q.effective_at",
    blocked: "q.status='scheduled' AND COALESCE(q.execution_error,'')<>''",
    detail:
      "適用日を迎えた手続きです。最古時刻は適用予定時刻。後任・引き継ぎ待ちは担当者が確認してください。",
  },
  {
    id: "task-templates",
    label: "定期タスク作成",
    ownerRole: "運営管理者",
    source: "editorial_task_templates q",
    pending:
      "q.enabled=1 AND q.schedule<>'none' AND julianday(q.next_run_at)<=clock.now",
    retry: "0",
    failed: "COALESCE(q.last_error,'')<>''",
    blocked: "q.enabled=0 AND COALESCE(q.last_error,'')<>''",
    createdAt: "q.next_run_at",
    updatedAt: "q.updated_at",
    dueAt: "q.next_run_at",
    detail:
      "作成予定時刻を過ぎたテンプレートです。最古時刻は次回作成予定時刻。エラーで作成停止になったテンプレートは経過時間に関係なく確認が必要です。",
  },
  {
    id: "scheduled-editorial-publications",
    label: "予約公開",
    ownerRole: "公開担当",
    source: "editorial_documents q",
    pending:
      "q.status='approved' AND q.published_at IS NULL AND q.publication_pr_number IS NULL AND q.scheduled_publish_at IS NOT NULL AND julianday(q.scheduled_publish_at)<=clock.now",
    retry: "0",
    failed: "0",
    createdAt: "q.scheduled_publish_at",
    updatedAt: "q.updated_at",
    dueAt: "q.scheduled_publish_at",
    detail:
      "公開予定時刻を迎え、公開PRがまだ紐付いていない記事です。処理の取得中も含みます。最古時刻は公開予定時刻です。",
  },
];

type QueueCounts = {
  pending_count: number;
  retry_count: number;
  failed_count: number;
  blocked_count: number;
  invalid_time_count: number;
  oldest_pending_day: number | null;
  oldest_due_day: number | null;
};

const fromJulianDay = (value: number | null) =>
  value === null || !Number.isFinite(Number(value))
    ? null
    : Math.round((Number(value) - 2440587.5) * 86_400_000);

/** Reads aggregate counts only; never loads message bodies or recipient IDs. */
export async function readScheduledJobQueues(
  db: D1Database,
  now = new Date(),
): Promise<ScheduledQueueHealth[]> {
  const recent = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  return Promise.all(
    queueDefinitions.map(async (definition): Promise<ScheduledQueueHealth> => {
      const { id, label, ownerRole, pending, retry, failed } = definition;
      try {
        const counts = await db
          .prepare(
            `WITH clock AS (SELECT julianday(?) AS now,julianday(?) AS recent)
             SELECT
               COALESCE(SUM(CASE WHEN ${pending} THEN 1 ELSE 0 END),0) AS pending_count,
               COALESCE(SUM(CASE WHEN (${pending}) AND (${retry}) THEN 1 ELSE 0 END),0) AS retry_count,
               COALESCE(SUM(CASE WHEN (${failed}) AND julianday(${definition.updatedAt})>=clock.recent THEN 1 ELSE 0 END),0) AS failed_count,
               COALESCE(SUM(CASE WHEN ${definition.blocked ?? "0"} THEN 1 ELSE 0 END),0) AS blocked_count,
               COALESCE(SUM(CASE WHEN (${pending}) AND julianday(${definition.createdAt}) IS NULL THEN 1 ELSE 0 END),0) AS invalid_time_count,
               MIN(CASE WHEN ${pending} THEN julianday(${definition.createdAt}) END) AS oldest_pending_day,
               MIN(CASE WHEN (${pending}) AND julianday(${definition.dueAt})<=clock.now THEN julianday(${definition.dueAt}) END) AS oldest_due_day
             FROM ${definition.source} CROSS JOIN clock
             WHERE (${pending})
                OR ((${failed}) AND julianday(${definition.updatedAt})>=clock.recent)
                OR (${definition.blocked ?? "0"})`,
          )
          .bind(now.toISOString(), recent)
          .first<QueueCounts>();
        if (!counts) throw new Error("queue_counts_unavailable");
        const oldest = fromJulianDay(counts.oldest_pending_day);
        const due = fromJulianDay(counts.oldest_due_day);
        const pendingCount = Number(counts.pending_count);
        const retryCount = Number(counts.retry_count);
        const failedCount = Number(counts.failed_count);
        const late =
          due !== null &&
          now.getTime() - due > (definition.maxDelayMs ?? 15 * 60_000);
        const blocked = Number(counts.blocked_count) > 0;
        const invalidTime = Number(counts.invalid_time_count) > 0;
        const issues = [
          ...(late ? ["予定時刻を過ぎた処理が滞留しています。"] : []),
          ...(blocked ? ["自動処理だけでは完了できない記録があります。"] : []),
          ...(failedCount
            ? ["直近24時間に失敗・要対応の記録があります。"]
            : []),
          ...(invalidTime ? ["未完了記録の時刻を確認できません。"] : []),
        ];
        return {
          id,
          label,
          ownerRole,
          status: issues.length ? "warning" : "ok",
          detail: `${issues.join("")}${definition.detail}`,
          pendingCount,
          retryCount,
          failedCount,
          oldestPendingAt:
            oldest === null ? null : new Date(oldest).toISOString(),
          oldestPendingAgeMs:
            oldest === null ? null : Math.max(0, now.getTime() - oldest),
        };
      } catch {
        return {
          id,
          label,
          ownerRole,
          status: "unknown",
          detail:
            "キューの状態を取得できません。接続とスキーマを確認してください。件数は未確認です。",
          pendingCount: null,
          retryCount: null,
          failedCount: null,
          oldestPendingAt: null,
          oldestPendingAgeMs: null,
        };
      }
    }),
  );
}
