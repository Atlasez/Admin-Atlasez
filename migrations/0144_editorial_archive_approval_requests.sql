CREATE TABLE IF NOT EXISTS editorial_document_archive_requests (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  requested_updated_at TEXT NOT NULL,
  request_note TEXT NOT NULL DEFAULT '',
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_editorial_archive_requests_one_pending
  ON editorial_document_archive_requests(document_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_editorial_archive_requests_inbox
  ON editorial_document_archive_requests(status, requested_at DESC, document_id);

CREATE INDEX IF NOT EXISTS idx_editorial_archive_requests_requester
  ON editorial_document_archive_requests(requested_by, decided_at DESC);
