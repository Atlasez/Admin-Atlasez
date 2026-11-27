import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const TARGET_MIGRATION = "0141_application_intake_reconciliation.sql";
const MIGRATIONS_BEFORE_INTAKE = [
  "0142_admin_scheduled_job_health.sql",
  "0143_admin_scheduled_health_alerts.sql",
];
const MIGRATIONS_AFTER_INTAKE = [
  "0144_editorial_archive_approval_requests.sql",
];
const SYNTHETIC_APPLICATION_ID = "staging-migration-fixture-0141";
const NOW = "2026-11-03T00:00:00.000Z";

function columnNames(db) {
  return new Set(
    db
      .prepare("PRAGMA table_info(atlasez_member_applications)")
      .all()
      .map((column) => column.name),
  );
}

function count(db, sql, ...values) {
  return Number(db.prepare(sql).get(...values)?.count ?? 0);
}

function assertDatabaseIntegrity(db) {
  assert.equal(
    db.prepare("PRAGMA integrity_check").get()?.integrity_check,
    "ok",
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
}

export function runAdminStagingMigrationDrill({
  migrationDirectory = resolve("migrations"),
} = {}) {
  const files = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of [
    ...MIGRATIONS_BEFORE_INTAKE,
    TARGET_MIGRATION,
    ...MIGRATIONS_AFTER_INTAKE,
  ]) {
    assert.ok(files.includes(file), `release migration ${file} is missing`);
  }
  // Match the latest recorded production ledger: 0142/0143 were already
  // applied while 0141 was pending. The current main's 0144 archive approval
  // migration follows the intake migration in this drill; 0140 deletion is
  // deliberately excluded because the current release candidate does not
  // include PR #630.
  const preMigrationFiles = [
    ...files.filter(
      (file) =>
        file < TARGET_MIGRATION &&
        file !== "0140_editorial_document_deletion_requests.sql",
    ),
    ...MIGRATIONS_BEFORE_INTAKE,
  ];
  const directory = mkdtempSync(
    join(tmpdir(), "atlasez-admin-staging-migration-"),
  );
  const databasePath = join(directory, "staging.sqlite");
  const backupPath = join(directory, "before-0141.sqlite");
  let db;

  try {
    db = new DatabaseSync(databasePath);
    db.exec("PRAGMA foreign_keys=ON");
    for (const file of preMigrationFiles)
      db.exec(readFileSync(join(migrationDirectory, file), "utf8"));
    db.exec(`
      CREATE TABLE d1_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const recordMigration = db.prepare(
      "INSERT INTO d1_migrations(name) VALUES(?)",
    );
    for (const file of preMigrationFiles) recordMigration.run(file);

    // A fresh D1 receives hard-coded production operator/editor identities from
    // older migrations. A staging database must clear those bootstrap grants
    // before any OAuth account or test data is introduced, then grant only its
    // dedicated synthetic global operator.
    db.exec(`
      DELETE FROM report_admin_permissions;
      DELETE FROM editorial_workflow_roles;
      DELETE FROM atlasez_member_discord_role_sync_exclusions;
    `);
    db.prepare(
      "INSERT OR IGNORE INTO report_admin_permissions (email, subject) VALUES (?, '*')",
    ).run("staging-global-operator@atlasez.test");
    assert.equal(
      count(db, "SELECT COUNT(*) AS count FROM report_admin_permissions"),
      1,
    );
    assert.equal(
      db
        .prepare("SELECT email FROM report_admin_permissions WHERE subject='*'")
        .get()?.email,
      "staging-global-operator@atlasez.test",
    );
    assert.equal(
      count(db, "SELECT COUNT(*) AS count FROM editorial_workflow_roles"),
      0,
    );
    assert.equal(
      count(
        db,
        "SELECT COUNT(*) AS count FROM atlasez_member_discord_role_sync_exclusions",
      ),
      0,
    );

    const oldColumns = columnNames(db);
    assert.equal(
      oldColumns.has("operator_notification_recipients_json"),
      false,
    );
    assert.equal(oldColumns.has("intake_reconciliation_required"), false);

    db.prepare(
      `
      INSERT INTO atlasez_member_applications
        (id,name,email,interests,message,status,created_at,updated_at,project_slug)
      VALUES (?,?,?,?,?,'new',?,?,?)
    `,
    ).run(
      SYNTHETIC_APPLICATION_ID,
      "synthetic fixture",
      "staging-applicant@atlasez.test",
      "staging",
      "migration drill",
      NOW,
      NOW,
      "thinking-cafe",
    );
    const insertDelivery = db.prepare(`
      INSERT INTO atlasez_application_email_deliveries
        (id,application_id,recipient_email,kind,subject,text_body,html_body,status,attempt_count,
         next_attempt_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?, ?,0,?,?,?)
    `);
    insertDelivery.run(
      "staging-applicant-confirmation",
      SYNTHETIC_APPLICATION_ID,
      "staging-applicant@atlasez.test",
      "applicant_confirmation",
      "synthetic confirmation",
      "synthetic body",
      "<p>synthetic</p>",
      "sent",
      NOW,
      NOW,
      NOW,
    );
    insertDelivery.run(
      "staging-operator-notification",
      SYNTHETIC_APPLICATION_ID,
      "staging-operator@atlasez.test",
      "operator_notification",
      "synthetic operator notice",
      "synthetic body",
      "<p>synthetic</p>",
      "pending",
      NOW,
      NOW,
      NOW,
    );
    assert.equal(
      count(
        db,
        "SELECT COUNT(*) AS count FROM atlasez_application_email_deliveries WHERE application_id=?",
        SYNTHETIC_APPLICATION_ID,
      ),
      2,
    );

    db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
    db.close();
    db = undefined;

    db = new DatabaseSync(databasePath);
    db.exec(readFileSync(join(migrationDirectory, TARGET_MIGRATION), "utf8"));
    db.prepare("INSERT INTO d1_migrations(name) VALUES(?)").run(
      TARGET_MIGRATION,
    );
    const migrated = db
      .prepare(
        `
      SELECT operator_notification_recipients_json,intake_reconciliation_required
        FROM atlasez_member_applications WHERE id=?
    `,
      )
      .get(SYNTHETIC_APPLICATION_ID);
    assert.equal(
      migrated?.operator_notification_recipients_json,
      '["staging-operator@atlasez.test"]',
    );
    assert.equal(migrated?.intake_reconciliation_required, 0);
    assert.equal(
      count(
        db,
        "SELECT COUNT(*) AS count FROM atlasez_application_email_deliveries WHERE application_id=?",
        SYNTHETIC_APPLICATION_ID,
      ),
      2,
    );
    assert.equal(
      db
        .prepare(
          "SELECT status FROM atlasez_application_email_deliveries WHERE id='staging-applicant-confirmation'",
        )
        .get()?.status,
      "sent",
    );
    assert.ok(
      db
        .prepare("SELECT 1 FROM d1_migrations WHERE name=?")
        .get(TARGET_MIGRATION),
    );
    for (const file of MIGRATIONS_AFTER_INTAKE) {
      db.exec(readFileSync(join(migrationDirectory, file), "utf8"));
      db.prepare("INSERT INTO d1_migrations(name) VALUES(?)").run(file);
    }
    assert.ok(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='editorial_document_archive_requests'",
        )
        .get(),
    );

    // An older Worker that inserts only its pre-0141 columns remains compatible:
    // the two added columns are nullable/defaulted and do not become required inputs.
    db.prepare(
      `
      INSERT INTO atlasez_member_applications
        (id,name,email,interests,message,status,created_at,updated_at,project_slug)
      VALUES ('staging-old-worker-write','synthetic fixture','old-worker@atlasez.test','compat','compat','new',?,?,?)
    `,
    ).run(NOW, NOW, "thinking-cafe");
    const oldWorkerRow = db
      .prepare(
        `
      SELECT operator_notification_recipients_json,intake_reconciliation_required
        FROM atlasez_member_applications WHERE id='staging-old-worker-write'
    `,
      )
      .get();
    assert.equal(oldWorkerRow?.operator_notification_recipients_json, null);
    assert.equal(oldWorkerRow?.intake_reconciliation_required, 0);
    assertDatabaseIntegrity(db);
    db.close();
    db = undefined;

    // Restore only the isolated SQLite fixture and verify it returns to the
    // recorded pre-0141 baseline, without deleting existing migration rows.
    copyFileSync(backupPath, databasePath);
    db = new DatabaseSync(databasePath);
    const restoredColumns = columnNames(db);
    assert.equal(
      restoredColumns.has("operator_notification_recipients_json"),
      false,
    );
    assert.equal(restoredColumns.has("intake_reconciliation_required"), false);
    assert.equal(
      count(db, "SELECT COUNT(*) AS count FROM atlasez_member_applications"),
      1,
    );
    assert.equal(
      count(
        db,
        "SELECT COUNT(*) AS count FROM atlasez_application_email_deliveries WHERE application_id=?",
        SYNTHETIC_APPLICATION_ID,
      ),
      2,
    );
    const restoredMigrationFiles = db
      .prepare("SELECT name FROM d1_migrations ORDER BY id")
      .all()
      .map((row) => row.name);
    assert.deepEqual(restoredMigrationFiles, preMigrationFiles);
    assertDatabaseIntegrity(db);
    return {
      preMigrationFiles: preMigrationFiles.length,
      restoredMigrationTail: restoredMigrationFiles.slice(-3),
      migration: TARGET_MIGRATION,
      archiveApprovalMigration: MIGRATIONS_AFTER_INTAKE[0],
      preservedApplicationRows: 1,
      preservedEmailQueueRows: 2,
      stagingBootstrapRolesSanitized: true,
      legacyInsertCompatible: true,
      isolatedBackupRestore: true,
      integrityCheck: "ok",
      foreignKeyViolations: 0,
      restoredIntegrityCheck: "ok",
    };
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
