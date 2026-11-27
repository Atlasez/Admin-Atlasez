import { expect, it } from "vitest";
import { runAdminStagingMigrationDrill } from "../../scripts/lib/admin-staging-migration-drill.mjs";

it("runs migration 0141, verifies backfill and old-column compatibility, then restores the synthetic pre-migration snapshot", () => {
  expect(runAdminStagingMigrationDrill()).toMatchObject({
    migration: "0141_application_intake_reconciliation.sql",
    restoredMigrationTail: [
      "0142_admin_scheduled_job_health.sql",
      "0143_admin_scheduled_health_alerts.sql",
      "0140_editorial_document_deletion_requests.sql",
    ],
    preservedApplicationRows: 1,
    preservedEmailQueueRows: 2,
    stagingBootstrapRolesSanitized: true,
    legacyInsertCompatible: true,
    isolatedBackupRestore: true,
    integrityCheck: "ok",
    foreignKeyViolations: 0,
    restoredIntegrityCheck: "ok",
  });
});
