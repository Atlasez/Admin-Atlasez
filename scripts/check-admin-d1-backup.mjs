import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  ADMIN_D1_BACKUP_BUCKET,
  ADMIN_D1_BACKUP_ACCOUNT_ID,
  ADMIN_D1_BACKUP_DATABASE_ID,
  ADMIN_D1_BACKUP_MAX_AGE_MS,
  ADMIN_D1_BACKUP_R2_ENDPOINT,
  AdminD1BackupError,
  assertAdminD1BackupGitHubContext,
  parseAdminD1BackupManifest,
} from "./lib/admin-d1-backup.mjs";
import { assertAdminD1BackupExpiration } from "./lib/admin-d1-backup-r2.mjs";

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
    let latestResponse;
    try {
      latestResponse = await client.send(
        new GetObjectCommand({
          Bucket: ADMIN_D1_BACKUP_BUCKET,
          Key: "status/latest-success.json",
        }),
      );
    } catch {
      throw new AdminD1BackupError("backup_latest_success_missing");
    }
    if (!latestResponse.Body)
      throw new AdminD1BackupError("backup_latest_success_empty");
    let latest;
    try {
      latest = JSON.parse(await latestResponse.Body.transformToString());
    } catch {
      throw new AdminD1BackupError("backup_latest_success_invalid");
    }
    if (
      latest.schemaVersion !== 1 ||
      latest.accountId !== ADMIN_D1_BACKUP_ACCOUNT_ID ||
      latest.databaseId !== ADMIN_D1_BACKUP_DATABASE_ID
    )
      throw new AdminD1BackupError("backup_target_mismatch");
    const completedAt = Date.parse(latest.completedAt);
    const age = Date.now() - completedAt;
    if (
      !Number.isFinite(completedAt) ||
      age < 0 ||
      age > ADMIN_D1_BACKUP_MAX_AGE_MS
    )
      throw new AdminD1BackupError("backup_latest_success_stale");
    const manifestResponse = await client.send(
      new GetObjectCommand({
        Bucket: ADMIN_D1_BACKUP_BUCKET,
        Key: latest.manifestKey,
      }),
    );
    if (!manifestResponse.Body)
      throw new AdminD1BackupError("backup_manifest_missing");
    let manifest;
    try {
      manifest = parseAdminD1BackupManifest(
        await manifestResponse.Body.transformToString(),
      );
    } catch {
      throw new AdminD1BackupError("backup_manifest_invalid");
    }
    if (
      manifest.objectKey !== latest.objectKey ||
      manifest.bytes !== latest.bytes ||
      manifest.sha256 !== latest.sha256
    )
      throw new AdminD1BackupError("backup_manifest_mismatch");
    let head;
    try {
      head = await client.send(
        new HeadObjectCommand({
          Bucket: ADMIN_D1_BACKUP_BUCKET,
          Key: latest.objectKey,
        }),
      );
    } catch {
      throw new AdminD1BackupError("backup_object_missing");
    }
    if (
      head.ContentLength !== latest.bytes ||
      head.Metadata?.sha256 !== latest.sha256 ||
      head.Metadata?.database_id !== ADMIN_D1_BACKUP_DATABASE_ID
    )
      throw new AdminD1BackupError("backup_object_metadata_mismatch");
    assertAdminD1BackupExpiration(head.Expiration, head.LastModified);

    console.log(
      JSON.stringify({
        status: "success",
        databaseId: ADMIN_D1_BACKUP_DATABASE_ID,
        completedAt: latest.completedAt,
        bytes: latest.bytes,
      }),
    );
  } finally {
    client.destroy();
  }
}

run().catch((error) => {
  console.error(
    error instanceof AdminD1BackupError ? error.code : "backup_monitor_failed",
  );
  process.exitCode = 1;
});
