-- Article removal is an audited, terminal logical-delete flow. Keep the
-- document, revisions, comments, feedback, assets, and publication history.
ALTER TABLE editorial_documents ADD COLUMN deleted_at TEXT;
ALTER TABLE editorial_documents ADD COLUMN deleted_by TEXT;
ALTER TABLE editorial_tasks ADD COLUMN cancelled_at TEXT;
ALTER TABLE editorial_tasks ADD COLUMN cancelled_by TEXT;
ALTER TABLE editorial_tasks ADD COLUMN cancellation_reason TEXT NOT NULL DEFAULT '';

CREATE TABLE editorial_document_deletion_requests (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES editorial_documents(id),
  requested_version_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  request_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'stale', 'approved', 'rejected')),
  decided_by TEXT,
  decision_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE UNIQUE INDEX idx_editorial_deletion_request_pending_document
  ON editorial_document_deletion_requests(document_id)
  WHERE status = 'pending';
CREATE INDEX idx_editorial_deletion_requests_status_created
  ON editorial_document_deletion_requests(status, created_at DESC);
CREATE INDEX idx_editorial_deletion_requests_document_created
  ON editorial_document_deletion_requests(document_id, created_at DESC);
CREATE INDEX idx_editorial_tasks_cancelled
  ON editorial_tasks(cancelled_at, updated_at DESC);

-- Existing archive fields and values remain the source of truth for the trash.
