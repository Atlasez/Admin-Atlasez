import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

const migrationDirectory = new URL("../../migrations/", import.meta.url);
const migration = (name: string) =>
  readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8");

it("統合migrationは公開版を保持し更新案の履歴と関連データを記事へ移す", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync(migrationDirectory).sort()) {
      if (
        !name.endsWith(".sql") ||
        name === "0138_editorial_article_versions.sql"
      )
        break;
      db.exec(migration(name));
    }
    db.exec("PRAGMA foreign_keys = ON");

    const document = db.prepare(
      `INSERT INTO editorial_documents
        (id,document_kind,base_document_id,base_document_updated_at,source_article_id,
         subject,category,locale,slug,title,summary,concept_id,body,status,created_by,
         updated_by,created_at,updated_at,published_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const publishedId = "11111111-1111-4111-8111-111111111111";
    const proposalId = "22222222-2222-4222-8222-222222222222";
    const publishedAt = "2026-08-30T00:00:00.000Z";
    const proposalUpdatedAt = "2026-08-31T00:00:00.000Z";
    document.run(
      publishedId,
      "canonical",
      null,
      null,
      "article-1",
      "mathematics",
      "group-theory",
      "ja",
      "group-definition",
      "群の定義",
      "公開要約",
      "math.group-theory.group-definition",
      "公開本文",
      "approved",
      "alice@example.com",
      "alice@example.com",
      publishedAt,
      publishedAt,
      publishedAt,
    );
    document.run(
      proposalId,
      "update-proposal",
      publishedId,
      publishedAt,
      "article-1",
      "mathematics",
      "group-theory",
      "ja",
      "group-definition",
      "群の定義 改訂",
      "改訂要約",
      "math.group-theory.group-definition",
      "改訂本文",
      "draft",
      "alice@example.com",
      "alice@example.com",
      publishedAt,
      proposalUpdatedAt,
      null,
    );

    const revision = db.prepare(
      `INSERT INTO editorial_document_revisions
        (id,document_id,title,summary,body,status,saved_by,saved_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    );
    revision.run(
      "published-revision",
      publishedId,
      "群の定義",
      "公開要約",
      "公開本文",
      "approved",
      "alice@example.com",
      publishedAt,
    );
    revision.run(
      "proposal-revision",
      proposalId,
      "群の定義 改訂",
      "改訂要約",
      "改訂本文",
      "draft",
      "alice@example.com",
      proposalUpdatedAt,
    );
    db.prepare(
      `INSERT INTO editorial_comments(id,document_id,body,created_by,created_at)
       VALUES(?,?,?,?,?)`,
    ).run(
      "proposal-comment",
      proposalId,
      "コメントを引き継ぐ",
      "bob@example.com",
      proposalUpdatedAt,
    );
    const asset = db.prepare(
      `INSERT INTO editorial_assets
        (id,document_id,filename,media_type,bytes,data,created_by,created_at,latex_name)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    );
    for (const id of [publishedId, proposalId])
      asset.run(
        `asset-${id}`,
        id,
        "diagram.png",
        "image/png",
        1,
        Buffer.from([1]),
        "alice@example.com",
        proposalUpdatedAt,
        "diagram",
      );
    db.prepare(
      `INSERT INTO editorial_publication_runs
        (id,document_id,action,state,created_by,created_at,updated_at,snapshot_updated_at,snapshot_hash)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run(
      "proposal-run",
      proposalId,
      "publish",
      "checks_pending",
      "alice@example.com",
      proposalUpdatedAt,
      proposalUpdatedAt,
      proposalUpdatedAt,
      "snapshot-hash",
    );

    db.exec(migration("0138_editorial_article_versions.sql"));

    const savedDocument = db
      .prepare(
        `SELECT id,title,body,status,current_version_id,published_version_id
           FROM editorial_documents`,
      )
      .get() as {
      id: string;
      title: string;
      body: string;
      status: string;
      current_version_id: string;
      published_version_id: string;
    };
    expect(savedDocument).toMatchObject({
      id: publishedId,
      title: "群の定義 改訂",
      body: "改訂本文",
      status: "draft",
    });
    expect(savedDocument.current_version_id).not.toBe(
      savedDocument.published_version_id,
    );

    const versions = db
      .prepare(
        `SELECT id,body,snapshot_json FROM editorial_document_revisions
          WHERE document_id = ?`,
      )
      .all(publishedId) as Array<{
      id: string;
      body: string;
      snapshot_json: string | null;
    }>;
    expect(versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: savedDocument.published_version_id,
          body: "公開本文",
          snapshot_json: expect.any(String),
        }),
        expect.objectContaining({
          id: savedDocument.current_version_id,
          body: "改訂本文",
          snapshot_json: expect.any(String),
        }),
        expect.objectContaining({ id: "proposal-revision", body: "改訂本文" }),
      ]),
    );
    expect(
      db
        .prepare("SELECT document_id FROM editorial_comments WHERE id = ?")
        .get("proposal-comment"),
    ).toEqual({ document_id: publishedId });

    const assets = db
      .prepare("SELECT latex_name FROM editorial_assets WHERE document_id = ?")
      .all(publishedId) as Array<{ latex_name: string }>;
    expect(new Set(assets.map((item) => item.latex_name)).size).toBe(2);
    const run = db
      .prepare(
        "SELECT document_id,state,snapshot_version_id FROM editorial_publication_runs WHERE id = ?",
      )
      .get("proposal-run");
    expect(run).toEqual({
      document_id: publishedId,
      state: "needs_operator",
      snapshot_version_id: "proposal-revision",
    });
    const documentColumns = db
      .prepare("PRAGMA table_info(editorial_documents)")
      .all() as Array<{ name: string }>;
    for (const oldColumn of [
      "document_kind",
      "base_document_id",
      "base_document_updated_at",
    ])
      expect(documentColumns.map((column) => column.name)).not.toContain(
        oldColumn,
      );
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    db.exec(migration("0139_editorial_release_candidates.sql"));
    const publicationRunColumns = db
      .prepare("PRAGMA table_info(editorial_publication_runs)")
      .all() as Array<{ name: string }>;
    expect(publicationRunColumns.map((column) => column.name)).toContain(
      "candidate_version_id",
    );
    const releaseTables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'editorial_release_%'",
      )
      .all() as Array<{ name: string }>;
    expect(releaseTables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        "editorial_release_candidates",
        "editorial_release_candidate_articles",
      ]),
    );
    expect(
      db.prepare("PRAGMA table_info(editorial_publication_history)").all(),
    ).toHaveLength(8);

    db.prepare(
      "UPDATE editorial_documents SET archived_at=?,archived_by=?,archive_expires_at=? WHERE id=?",
    ).run(
      "2026-09-01T00:00:00.000Z",
      "alice@example.com",
      "2026-12-01T00:00:00.000Z",
      publishedId,
    );
    db.exec(migration("0140_editorial_document_deletion_requests.sql"));
    const migratedDocumentColumns = db
      .prepare("PRAGMA table_info(editorial_documents)")
      .all() as Array<{ name: string }>;
    expect(migratedDocumentColumns.map((column) => column.name)).toContain(
      "deleted_at",
    );
    expect(migratedDocumentColumns.map((column) => column.name)).toContain(
      "deleted_by",
    );
    for (const archiveColumn of [
      "archived_at",
      "archived_by",
      "archive_expires_at",
    ])
      expect(migratedDocumentColumns.map((column) => column.name)).toContain(
        archiveColumn,
      );
    expect(
      db
        .prepare(
          "SELECT archived_at,archived_by,archive_expires_at FROM editorial_documents WHERE id=?",
        )
        .get(publishedId),
    ).toEqual({
      archived_at: null,
      archived_by: null,
      archive_expires_at: null,
    });
    expect(
      db
        .prepare("SELECT deleted_at FROM editorial_documents WHERE id=?")
        .get(publishedId),
    ).toEqual({ deleted_at: null });
    const taskColumns = db
      .prepare("PRAGMA table_info(editorial_tasks)")
      .all() as Array<{ name: string }>;
    expect(taskColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "cancelled_at",
        "cancelled_by",
        "cancellation_reason",
      ]),
    );
    const currentVersionId = (
      db
        .prepare(
          "SELECT current_version_id FROM editorial_documents WHERE id=?",
        )
        .get(publishedId) as {
        current_version_id: string;
      }
    ).current_version_id;
    const insertDeletionRequest = db.prepare(
      `INSERT INTO editorial_document_deletion_requests
        (id,document_id,requested_version_id,requested_by,status,created_at,updated_at)
       VALUES(?,?,?,?, 'pending', ?, ?)`,
    );
    insertDeletionRequest.run(
      "deletion-request-1",
      publishedId,
      currentVersionId,
      "bob@example.com",
      proposalUpdatedAt,
      proposalUpdatedAt,
    );
    expect(() =>
      insertDeletionRequest.run(
        "deletion-request-2",
        publishedId,
        currentVersionId,
        "carol@example.com",
        proposalUpdatedAt,
        proposalUpdatedAt,
      ),
    ).toThrow();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
