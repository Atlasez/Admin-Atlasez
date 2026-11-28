import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  ADMIN_D1_BACKUP_BUCKET,
  ADMIN_D1_BACKUP_RETENTION_DAYS,
  AdminD1BackupError,
} from "./admin-d1-backup.mjs";

export const ADMIN_D1_BACKUP_LIFECYCLE_RULE_ID =
  "atlasez-admin-d1-backups-35-day-expiration";

const dayMs = 24 * 60 * 60 * 1000;

export function assertAdminD1BackupExpiration(
  expirationHeader,
  lastModified,
  now = new Date(),
) {
  if (typeof expirationHeader !== "string")
    throw new AdminD1BackupError("r2_backup_retention_missing");
  const expiryDateValue = expirationHeader.match(/expiry-date="([^"]+)"/i)?.[1];
  const ruleId = expirationHeader.match(/rule-id="([^"]+)"/i)?.[1];
  const expiresAt = Date.parse(expiryDateValue ?? "");
  const modifiedAt = new Date(lastModified ?? "").getTime();
  if (
    ruleId !== ADMIN_D1_BACKUP_LIFECYCLE_RULE_ID ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(modifiedAt) ||
    !Number.isFinite(now.getTime()) ||
    expiresAt <= now.getTime()
  )
    throw new AdminD1BackupError("r2_backup_retention_invalid");

  const ageMs = expiresAt - modifiedAt;
  if (
    ageMs < ADMIN_D1_BACKUP_RETENTION_DAYS * dayMs ||
    ageMs >= (ADMIN_D1_BACKUP_RETENTION_DAYS + 1) * dayMs
  )
    throw new AdminD1BackupError("r2_backup_retention_invalid");

  return new Date(expiresAt).toISOString();
}

export async function verifyAdminD1BackupRetention(client, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const key = `daily/__preflight/${date}/${randomUUID()}.txt`;
  const marker = `atlasez-admin-d1-backup-preflight:${randomUUID()}`;
  let created = false;
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: ADMIN_D1_BACKUP_BUCKET,
        Key: key,
        Body: marker,
        ContentLength: Buffer.byteLength(marker),
        ContentType: "text/plain",
      }),
    );
    created = true;

    const head = await client.send(
      new HeadObjectCommand({ Bucket: ADMIN_D1_BACKUP_BUCKET, Key: key }),
    );
    assertAdminD1BackupExpiration(head.Expiration, head.LastModified, now);

    const downloaded = await client.send(
      new GetObjectCommand({ Bucket: ADMIN_D1_BACKUP_BUCKET, Key: key }),
    );
    if (
      !downloaded.Body ||
      (await downloaded.Body.transformToString()) !== marker
    )
      throw new AdminD1BackupError("r2_preflight_readback_mismatch");
  } catch (error) {
    if (error instanceof AdminD1BackupError) throw error;
    throw new AdminD1BackupError("r2_preflight_failed");
  } finally {
    if (created) {
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: ADMIN_D1_BACKUP_BUCKET, Key: key }),
        );
      } catch {
        console.error("r2_preflight_marker_cleanup_failed");
      }
    }
  }
}
