import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = (name: string) =>
  readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8");

describe("ADMIN D1 migration history", () => {
  it("rejects new sequence collisions while preserving exact legacy filenames", () => {
    // D1 records full filenames, and these exact duplicates are already part
    // of the deployed ledger. Keep them unchanged and reject any new reuse.
    const legacySharedSequenceFiles = new Map([
      [
        "0055",
        [
          "0055_application_google_form_fields.sql",
          "0055_search_console_oauth_tokens.sql",
        ],
      ],
      [
        "0081",
        [
          "0081_atlasez_google_account_identities.sql",
          "0081_editorial_article_catalog.sql",
          "0081_editorial_document_archives.sql",
        ],
      ],
      [
        "0082",
        [
          "0082_editorial_article_catalog_provenance.sql",
          "0082_editorial_publication_pull_requests.sql",
        ],
      ],
      [
        "0088",
        [
          "0088_editorial_concept_metadata.sql",
          "0088_editorial_publication_run_resilience.sql",
        ],
      ],
    ]);
    const files = readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const sequences = files.map((name) => name.match(/^(\d{4})_/)?.[1]);
    const counts = new Map<string, number>();
    for (const sequence of sequences) {
      expect(sequence).toBeDefined();
      if (sequence) counts.set(sequence, (counts.get(sequence) ?? 0) + 1);
    }
    const duplicateSequences = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([sequence]) => sequence);
    expect(duplicateSequences).toEqual([...legacySharedSequenceFiles.keys()]);
    for (const [sequence, expectedFiles] of legacySharedSequenceFiles) {
      expect(files.filter((name) => name.startsWith(`${sequence}_`))).toEqual(
        expectedFiles,
      );
    }
  });

  it("keeps source for migrations already recorded in production", () => {
    expect(migration("0111_editorial_progress_reactions.sql")).toContain(
      "CREATE TABLE IF NOT EXISTS editorial_progress_reactions",
    );
    expect(migration("0112_admin_genre_role_catalog_lifecycle.sql")).toContain(
      "ADD COLUMN permission_scope",
    );
    expect(migration("0113_admin_member_lifecycle.sql")).toContain(
      "CREATE TABLE IF NOT EXISTS admin_member_lifecycle",
    );
  });

  it("enforces lowercase reaction emails with a copy-preserving follow-up migration", () => {
    const rebuild = migration(
      "0117_enforce_lowercase_progress_reaction_emails.sql",
    );

    expect(rebuild).toContain("CHECK(actor_email = lower(actor_email))");
    expect(rebuild).toContain("SELECT id, progress_id, lower(actor_email)");
    expect(rebuild).not.toContain("INSERT OR IGNORE");
    expect(rebuild).toContain("DROP TABLE editorial_progress_reactions");
    expect(rebuild).toContain("RENAME TO editorial_progress_reactions");
  });

  it("preserves queued application emails and conservatively backfills first attempts", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE atlasez_application_email_deliveries (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          attempt_count INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO atlasez_application_email_deliveries
          (id,status,attempt_count,created_at)
        VALUES
          ('pending','pending',0,'2026-10-01T00:00:00.000Z'),
          ('retry','retry',2,'2026-10-02T00:00:00.000Z');
      `);
      db.exec(migration("0132_application_email_first_attempt.sql"));

      expect(
        db
          .prepare(
            "SELECT id,status,attempt_count,first_attempt_at FROM atlasez_application_email_deliveries ORDER BY id",
          )
          .all(),
      ).toEqual([
        {
          id: "pending",
          status: "pending",
          attempt_count: 0,
          first_attempt_at: null,
        },
        {
          id: "retry",
          status: "retry",
          attempt_count: 2,
          first_attempt_at: "2026-10-02T00:00:00.000Z",
        },
      ]);
    } finally {
      db.close();
    }
  });
});
