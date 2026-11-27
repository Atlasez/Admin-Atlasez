import { expect, it } from "vitest";
import { runAdminStagingMigrationDrill } from "../../scripts/lib/admin-staging-migration-drill.mjs";

it("runs migration 0141, verifies backfill and old-column compatibility, then restores the synthetic pre-migration snapshot", () => {
  expect(runAdminStagingMigrationDrill()).toMatchObject({
    migration: "0141_application_intake_reconciliation.sql",
    archiveApprovalMigration: "0144_editorial_archive_approval_requests.sql",
    restoredMigrationTail: [
      "0139_editorial_release_candidates.sql",
      "0142_admin_scheduled_job_health.sql",
      "0143_admin_scheduled_health_alerts.sql",
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
