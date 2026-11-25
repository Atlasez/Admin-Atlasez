-- 記事を1つの編集対象に統合し、保存された各版と公開版を版IDで追跡する。
ALTER TABLE editorial_documents ADD COLUMN current_version_id TEXT;
ALTER TABLE editorial_documents ADD COLUMN published_version_id TEXT;
ALTER TABLE editorial_document_revisions ADD COLUMN document_updated_at TEXT;
ALTER TABLE editorial_document_revisions ADD COLUMN snapshot_json TEXT;
ALTER TABLE editorial_publication_runs ADD COLUMN snapshot_version_id TEXT;

CREATE TABLE editorial_version_baseline_ids (
  document_id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL
);

INSERT INTO editorial_version_baseline_ids (document_id, version_id)
SELECT id,
       lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
       substr(lower(hex(randomblob(2))), 2) || '-' ||
       substr('89ab', abs(random()) % 4 + 1, 1) ||
       substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
  FROM editorial_documents
 WHERE COALESCE(document_kind, 'canonical') = 'canonical'
    OR base_document_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM editorial_documents base WHERE base.id = editorial_documents.base_document_id);

INSERT INTO editorial_document_revisions
  (id, document_id, title, summary, body, status, saved_by, saved_at, document_updated_at, snapshot_json)
SELECT baseline.version_id, document.id, document.title, document.summary, document.body,
       CASE WHEN document.published_at IS NOT NULL THEN 'published' ELSE document.status END,
       document.updated_by, document.updated_at, document.updated_at,
       json_object(
         'source_article_id', document.source_article_id,
         'subject', document.subject,
         'category', document.category,
         'locale', document.locale,
         'slug', document.slug,
         'title', document.title,
         'summary', document.summary,
         'concept_id', document.concept_id,
         'concept_name', document.concept_name,
         'concept_name_en', document.concept_name_en,
         'concept_is_new', document.concept_is_new,
         'body', document.body,
         'writing_memo', document.writing_memo,
         'latex_engine', document.latex_engine,
         'status', document.status,
         'locked_ranges', document.locked_ranges,
         'article_references', document.article_references,
         'updated_at', document.updated_at
       )
  FROM editorial_documents document
  JOIN editorial_version_baseline_ids baseline ON baseline.document_id = document.id;

UPDATE editorial_documents
   SET current_version_id = (SELECT version_id FROM editorial_version_baseline_ids baseline WHERE baseline.document_id = editorial_documents.id),
       published_version_id = CASE WHEN published_at IS NOT NULL
         THEN (SELECT version_id FROM editorial_version_baseline_ids baseline WHERE baseline.document_id = editorial_documents.id)
         ELSE NULL END
 WHERE id IN (SELECT document_id FROM editorial_version_baseline_ids);

UPDATE editorial_publication_runs
   SET snapshot_version_id = CASE
         WHEN action = 'unpublish' OR state = 'published'
           THEN COALESCE((SELECT published_version_id FROM editorial_documents WHERE id = editorial_publication_runs.document_id),
                         (SELECT current_version_id FROM editorial_documents WHERE id = editorial_publication_runs.document_id))
         ELSE (SELECT current_version_id FROM editorial_documents WHERE id = editorial_publication_runs.document_id)
       END
 WHERE snapshot_version_id IS NULL
   AND document_id IN (SELECT document_id FROM editorial_version_baseline_ids);

CREATE TABLE editorial_version_proposal_map AS
SELECT proposal.id AS proposal_id, proposal.base_document_id AS document_id
  FROM editorial_documents proposal
  JOIN editorial_documents base ON base.id = proposal.base_document_id
 WHERE proposal.document_kind = 'update-proposal';

CREATE TABLE editorial_version_proposal_ids (
  proposal_id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL
);

INSERT INTO editorial_version_proposal_ids (proposal_id, version_id)
SELECT proposal.proposal_id,
       lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
       substr(lower(hex(randomblob(2))), 2) || '-' ||
       substr('89ab', abs(random()) % 4 + 1, 1) ||
       substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
  FROM editorial_version_proposal_map proposal;

-- 更新案の保存履歴と現在の編集内容を、記事IDに紐づく版履歴へ移す。
INSERT INTO editorial_document_revisions
  (id, document_id, title, summary, body, status, saved_by, saved_at, document_updated_at, snapshot_json)
SELECT version.version_id, proposal.document_id, source.title, source.summary, source.body,
       source.status, source.updated_by, source.updated_at, source.updated_at,
       json_object(
         'source_article_id', source.source_article_id,
         'subject', source.subject,
         'category', source.category,
         'locale', source.locale,
         'slug', source.slug,
         'title', source.title,
         'summary', source.summary,
         'concept_id', source.concept_id,
         'concept_name', source.concept_name,
         'concept_name_en', source.concept_name_en,
         'concept_is_new', source.concept_is_new,
         'body', source.body,
         'writing_memo', source.writing_memo,
         'latex_engine', source.latex_engine,
         'status', source.status,
         'locked_ranges', source.locked_ranges,
         'article_references', source.article_references,
         'updated_at', source.updated_at
       )
  FROM editorial_version_proposal_map proposal
  JOIN editorial_version_proposal_ids version ON version.proposal_id = proposal.proposal_id
  JOIN editorial_documents source ON source.id = proposal.proposal_id;

-- 公開runが保持している更新日時を、移動前の版履歴へ照合する。
UPDATE editorial_publication_runs
   SET snapshot_version_id = COALESCE(
         (SELECT revision.id
            FROM editorial_document_revisions revision
           WHERE revision.document_id = editorial_publication_runs.document_id
             AND COALESCE(revision.document_updated_at, revision.saved_at) = editorial_publication_runs.snapshot_updated_at
           ORDER BY revision.saved_at DESC, revision.id DESC LIMIT 1),
         (SELECT version.version_id
            FROM editorial_version_proposal_ids version
           WHERE version.proposal_id = editorial_publication_runs.document_id)
       )
 WHERE snapshot_version_id IS NULL
   AND document_id IN (SELECT proposal_id FROM editorial_version_proposal_map);

UPDATE editorial_document_revisions
   SET document_id = (SELECT proposal.document_id FROM editorial_version_proposal_map proposal WHERE proposal.proposal_id = editorial_document_revisions.document_id),
       document_updated_at = COALESCE(document_updated_at, saved_at)
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map);

CREATE TABLE editorial_version_current_proposals AS
SELECT document_id, proposal_id
  FROM (
    SELECT proposal.document_id, proposal.proposal_id,
           ROW_NUMBER() OVER (PARTITION BY proposal.document_id ORDER BY source.updated_at DESC, source.id DESC) AS position
      FROM editorial_version_proposal_map proposal
      JOIN editorial_documents source ON source.id = proposal.proposal_id
     WHERE source.archived_at IS NULL
  )
 WHERE position = 1;

-- 公開審査中の旧runは、版統合により対象IDが変わるため自動継続させない。
-- 履歴を保持し、運営者が新しい記事版から再開できる状態にする。
UPDATE editorial_publication_runs
   SET state = 'needs_operator',
       error_code = 'editorial_versions_consolidated',
       error_message = '記事の版管理方式が変更されました。現在の版を確認してから公開処理を再開してください。',
       next_attempt_at = NULL,
       lease_until = NULL,
       updated_at = CURRENT_TIMESTAMP
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map)
   AND state IN ('queued', 'checks_pending', 'merge_pending', 'deploy_pending', 'retry_wait');

-- コメントや作業履歴は記事単位に引き継ぐ。
UPDATE editorial_comments
   SET document_id = (SELECT proposal.document_id FROM editorial_version_proposal_map proposal WHERE proposal.proposal_id = editorial_comments.document_id)
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map);

INSERT OR IGNORE INTO editorial_review_assignment_recipients
  (document_id, reviewer_email, requested_at, updated_at)
SELECT proposal.document_id, recipient.reviewer_email, recipient.requested_at, recipient.updated_at
  FROM editorial_review_assignment_recipients recipient
  JOIN editorial_version_proposal_map proposal ON proposal.proposal_id = recipient.document_id;
DELETE FROM editorial_review_assignment_recipients
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map);

INSERT INTO editorial_review_assignments
  (document_id, reviewer_email, requested_by, requested_at, updated_at, request_note, task_id)
SELECT proposal.document_id, assignment.reviewer_email, assignment.requested_by,
       assignment.requested_at, assignment.updated_at, assignment.request_note, assignment.task_id
  FROM editorial_review_assignments assignment
  JOIN editorial_version_proposal_map proposal ON proposal.proposal_id = assignment.document_id
 WHERE assignment.requested_at = (
   SELECT MAX(candidate.requested_at)
     FROM editorial_review_assignments candidate
     JOIN editorial_version_proposal_map candidate_map ON candidate_map.proposal_id = candidate.document_id
    WHERE candidate_map.document_id = proposal.document_id
 )
ON CONFLICT(document_id) DO UPDATE SET
  reviewer_email = excluded.reviewer_email,
  requested_by = excluded.requested_by,
  requested_at = excluded.requested_at,
  updated_at = excluded.updated_at,
  request_note = excluded.request_note,
  task_id = excluded.task_id
WHERE excluded.requested_at >= editorial_review_assignments.requested_at;

DELETE FROM editorial_review_assignments
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map);

UPDATE editorial_feedback_task_links
   SET document_id = (SELECT proposal.document_id FROM editorial_version_proposal_map proposal WHERE proposal.proposal_id = editorial_feedback_task_links.document_id)
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map);
UPDATE editorial_publication_reviews
   SET document_id = (SELECT proposal.document_id FROM editorial_version_proposal_map proposal WHERE proposal.proposal_id = editorial_publication_reviews.document_id)
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map);
UPDATE editorial_publication_runs
   SET document_id = (SELECT proposal.document_id FROM editorial_version_proposal_map proposal WHERE proposal.proposal_id = editorial_publication_runs.document_id)
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map);
UPDATE editorial_progress_reports
   SET document_id = (SELECT proposal.document_id FROM editorial_version_proposal_map proposal WHERE proposal.proposal_id = editorial_progress_reports.document_id)
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map);
UPDATE editorial_task_workspaces
   SET document_id = (SELECT proposal.document_id FROM editorial_version_proposal_map proposal WHERE proposal.proposal_id = editorial_task_workspaces.document_id)
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map);
UPDATE editorial_article_catalog
   SET document_id = (SELECT proposal.document_id FROM editorial_version_proposal_map proposal WHERE proposal.proposal_id = editorial_article_catalog.document_id)
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map);
UPDATE editorial_outline_entries
   SET document_id = (SELECT proposal.document_id FROM editorial_version_proposal_map proposal WHERE proposal.proposal_id = editorial_outline_entries.document_id)
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map);

-- 同じLaTeX名が複数の保存版で使われていても、記事への移動で一意制約に
-- 違反しないよう、更新案由来の衝突名に素材IDを付けて保持する。
UPDATE editorial_assets
   SET latex_name = 'version-' || substr(id, 1, 8) || '-' || latex_name
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map)
   AND latex_name <> ''
   AND EXISTS (
     SELECT 1
       FROM editorial_assets other
       JOIN editorial_version_proposal_map current_proposal ON current_proposal.proposal_id = editorial_assets.document_id
       LEFT JOIN editorial_version_proposal_map other_proposal ON other_proposal.proposal_id = other.document_id
      WHERE other.id <> editorial_assets.id
        AND lower(other.latex_name) = lower(editorial_assets.latex_name)
        AND COALESCE(other_proposal.document_id, other.document_id) = current_proposal.document_id
   );
UPDATE editorial_assets
   SET document_id = (SELECT proposal.document_id FROM editorial_version_proposal_map proposal WHERE proposal.proposal_id = editorial_assets.document_id)
 WHERE document_id IN (SELECT proposal_id FROM editorial_version_proposal_map);

UPDATE editorial_tasks
   SET details = (
     SELECT REPLACE(editorial_tasks.details,
                    '/admin/editor/?document=' || proposal.proposal_id,
                    '/admin/editor/?document=' || proposal.document_id)
       FROM editorial_version_proposal_map proposal
      WHERE INSTR(editorial_tasks.details, '/admin/editor/?document=' || proposal.proposal_id) > 0
      LIMIT 1
   )
 WHERE EXISTS (
   SELECT 1 FROM editorial_version_proposal_map proposal
    WHERE INSTR(editorial_tasks.details, '/admin/editor/?document=' || proposal.proposal_id) > 0
 );

-- 最新の未アーカイブ更新案を記事の現在版にする。公開版のpointerは既に
-- 作成した公開原稿のbaseline versionを保ち、編集後の差分を正確に判定する。
UPDATE editorial_documents AS base
   SET source_article_id = (SELECT proposal.source_article_id FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       subject = (SELECT proposal.subject FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       category = (SELECT proposal.category FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       locale = (SELECT proposal.locale FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       slug = (SELECT proposal.slug FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       title = (SELECT proposal.title FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       summary = (SELECT proposal.summary FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       concept_id = (SELECT proposal.concept_id FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       concept_name = (SELECT proposal.concept_name FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       concept_name_en = (SELECT proposal.concept_name_en FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       concept_is_new = (SELECT proposal.concept_is_new FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       body = (SELECT proposal.body FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       writing_memo = (SELECT proposal.writing_memo FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       latex_engine = (SELECT proposal.latex_engine FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       status = (SELECT proposal.status FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       updated_by = (SELECT proposal.updated_by FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       updated_at = (SELECT proposal.updated_at FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       reviewed_at = (SELECT proposal.reviewed_at FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       scheduled_publish_at = (SELECT proposal.scheduled_publish_at FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       scheduled_publish_claimed_at = (SELECT proposal.scheduled_publish_claimed_at FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       publication_review_stage = (SELECT proposal.publication_review_stage FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       publication_review_round = (SELECT proposal.publication_review_round FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       publication_review_started_at = (SELECT proposal.publication_review_started_at FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       publication_pr_number = (SELECT proposal.publication_pr_number FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       publication_pr_url = (SELECT proposal.publication_pr_url FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       publication_branch = (SELECT proposal.publication_branch FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       publication_action = (SELECT proposal.publication_action FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       publication_requested_at = (SELECT proposal.publication_requested_at FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       locked_ranges = (SELECT proposal.locked_ranges FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       article_references = (SELECT proposal.article_references FROM editorial_version_current_proposals current JOIN editorial_documents proposal ON proposal.id = current.proposal_id WHERE current.document_id = base.id),
       current_version_id = (SELECT version.version_id FROM editorial_version_current_proposals current JOIN editorial_version_proposal_ids version ON version.proposal_id = current.proposal_id WHERE current.document_id = base.id)
 WHERE base.id IN (SELECT document_id FROM editorial_version_current_proposals);

DROP TRIGGER IF EXISTS editorial_documents_identity_insert;
DROP TRIGGER IF EXISTS editorial_documents_identity_update;
DROP TRIGGER IF EXISTS editorial_documents_source_article_insert;
DROP TRIGGER IF EXISTS editorial_documents_source_article_update;
DROP INDEX IF EXISTS idx_editorial_documents_base_proposal;

DELETE FROM editorial_documents
 WHERE id IN (SELECT proposal_id FROM editorial_version_proposal_map);

ALTER TABLE editorial_documents DROP COLUMN base_document_updated_at;
ALTER TABLE editorial_documents DROP COLUMN base_document_id;
ALTER TABLE editorial_documents DROP COLUMN document_kind;

CREATE TRIGGER editorial_documents_identity_insert
BEFORE INSERT ON editorial_documents
WHEN EXISTS (
  SELECT 1 FROM editorial_documents
  WHERE locale = NEW.locale AND subject = NEW.subject
    AND category = NEW.category AND slug = NEW.slug
)
BEGIN
  SELECT RAISE(ABORT, 'duplicate editorial document identity');
END;

CREATE TRIGGER editorial_documents_identity_update
BEFORE UPDATE OF locale, subject, category, slug ON editorial_documents
WHEN (NEW.locale != OLD.locale OR NEW.subject != OLD.subject
   OR NEW.category != OLD.category OR NEW.slug != OLD.slug)
 AND EXISTS (
  SELECT 1 FROM editorial_documents
  WHERE id != OLD.id AND locale = NEW.locale AND subject = NEW.subject
    AND category = NEW.category AND slug = NEW.slug
 )
BEGIN
  SELECT RAISE(ABORT, 'duplicate editorial document identity');
END;

CREATE TRIGGER editorial_documents_source_article_insert
BEFORE INSERT ON editorial_documents
WHEN NEW.source_article_id IS NOT NULL
 AND EXISTS (SELECT 1 FROM editorial_documents WHERE source_article_id = NEW.source_article_id)
BEGIN
  SELECT RAISE(ABORT, 'duplicate editorial source article');
END;

CREATE TRIGGER editorial_documents_source_article_update
BEFORE UPDATE OF source_article_id ON editorial_documents
WHEN NEW.source_article_id IS NOT NULL
 AND NEW.source_article_id IS NOT OLD.source_article_id
 AND EXISTS (
  SELECT 1 FROM editorial_documents
  WHERE id != OLD.id AND source_article_id = NEW.source_article_id
 )
BEGIN
  SELECT RAISE(ABORT, 'duplicate editorial source article');
END;

DROP TABLE editorial_version_current_proposals;
DROP TABLE editorial_version_proposal_ids;
DROP TABLE editorial_version_proposal_map;
DROP TABLE editorial_version_baseline_ids;
