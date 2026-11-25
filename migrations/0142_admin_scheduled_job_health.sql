-- Keep at most one observation per scheduled job. No payloads, recipients,
-- credentials, raw exceptions, or unbounded execution history are stored.
-- Additive only: existing Workers and business tables do not depend on this table.
-- 0140 and 0141 belong to the separate editorial deletion / intake changes.
CREATE TABLE IF NOT EXISTS admin_scheduled_job_health (
  job_id TEXT PRIMARY KEY NOT NULL CHECK (job_id IN (
    'editorial-publication-progress',
    'editorial-release-reconcile',
    'editorial-publication-sync',
    'published-article-backup',
    'task-reminders',
    'task-templates',
    'member-procedures',
    'task-archive',
    'application-email',
    'seminar-application-email',
    'discord-provisioning',
    'discord-role-sync',
    'scheduled-editorial-publications',
    'audit-archive',
    'discord-notifications',
    'personal-data-retention'
  )),
  current_run_id TEXT NOT NULL,
  last_status TEXT NOT NULL CHECK (last_status IN (
    'running', 'success', 'warning', 'error', 'skipped'
  )),
  last_started_at TEXT NOT NULL,
  last_finished_at TEXT,
  last_succeeded_at TEXT,
  last_failed_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_duration_ms INTEGER CHECK (last_duration_ms IS NULL OR last_duration_ms >= 0),
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code IN (
    'not_configured',
    'invalid_configuration',
    'partial_failure',
    'execution_failed',
    'dependency_failed',
    'state_unconfirmed',
    'queue_unavailable'
  )),
  updated_at TEXT NOT NULL
);
