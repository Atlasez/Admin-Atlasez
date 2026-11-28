import { S3Client } from "@aws-sdk/client-s3";
import {
  ADMIN_D1_BACKUP_R2_ENDPOINT,
  AdminD1BackupError,
  assertAdminD1BackupGitHubContext,
} from "./lib/admin-d1-backup.mjs";
import { verifyAdminD1BackupRetention } from "./lib/admin-d1-backup-r2.mjs";

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0)
    throw new AdminD1BackupError(`environment_${name.toLowerCase()}_missing`);
  return value;
}

async function run() {
  assertAdminD1BackupGitHubContext();
  const client = new S3Client({
    region: "auto",
    endpoint: ADMIN_D1_BACKUP_R2_ENDPOINT,
    credentials: {
      accessKeyId: requiredEnv("ADMIN_D1_BACKUP_R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("ADMIN_D1_BACKUP_R2_SECRET_ACCESS_KEY"),
    },
  });
  try {
    await verifyAdminD1BackupRetention(client);
    console.log(
      JSON.stringify({
        status: "success",
        operation: "r2-preflight-retention",
      }),
    );
  } finally {
    client.destroy();
  }
}

run().catch((error) => {
  console.error(
    error instanceof AdminD1BackupError ? error.code : "r2_preflight_failed",
  );
  process.exitCode = 1;
});
