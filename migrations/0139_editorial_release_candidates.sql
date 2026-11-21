-- 公開候補の内容とCloudflareへの切替履歴を分けて保存する。
ALTER TABLE editorial_publication_runs ADD COLUMN candidate_version_id TEXT;

CREATE TABLE editorial_release_candidates (
  version_id TEXT PRIMARY KEY,
  repository TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('registered', 'activated')),
  deployment_id TEXT,
  created_at TEXT NOT NULL,
  activated_at TEXT
);

CREATE INDEX idx_editorial_release_candidates_state
  ON editorial_release_candidates(state, created_at DESC);

CREATE TABLE editorial_release_candidate_articles (
  candidate_version_id TEXT NOT NULL REFERENCES editorial_release_candidates(version_id) ON DELETE CASCADE,
  article_id TEXT NOT NULL,
  article_path TEXT NOT NULL,
  document_id TEXT REFERENCES editorial_documents(id) ON DELETE SET NULL,
  article_version_id TEXT,
  article_status TEXT NOT NULL CHECK (article_status IN ('draft', 'in-review', 'published')),
  PRIMARY KEY (candidate_version_id, article_id),
  UNIQUE (candidate_version_id, article_path)
);

CREATE INDEX idx_editorial_release_candidate_articles_document
  ON editorial_release_candidate_articles(candidate_version_id, document_id);

CREATE TABLE editorial_publication_history (
  id TEXT PRIMARY KEY,
  candidate_version_id TEXT NOT NULL UNIQUE REFERENCES editorial_release_candidates(version_id),
  deployment_id TEXT NOT NULL UNIQUE,
  repository TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX idx_editorial_publication_history_time
  ON editorial_publication_history(activated_at DESC);
