export const ADMIN_D1_BACKUP_ACCOUNT_ID = "812021e62fa20465950b61be55dfe064";
export const ADMIN_D1_BACKUP_DATABASE_NAME = "atlasez-reports";
export const ADMIN_D1_BACKUP_DATABASE_ID =
  "d5112a62-7ed6-49c8-b6a2-18ee2dbab678";
export const ADMIN_D1_BACKUP_BUCKET = "atlasez-admin-d1-backups";
export const ADMIN_D1_BACKUP_RETENTION_DAYS = 35;
export const ADMIN_D1_BACKUP_MAX_EXPORT_BYTES = 512 * 1024 * 1024;
export const ADMIN_D1_BACKUP_MAX_EXPORT_DURATION_MS = 10 * 60 * 1000;
export const ADMIN_D1_BACKUP_POLL_INTERVAL_MS = 10 * 1000;
export const ADMIN_D1_BACKUP_MAX_AGE_MS = 26 * 60 * 60 * 1000;
export const ADMIN_D1_BACKUP_R2_ENDPOINT = `https://${ADMIN_D1_BACKUP_ACCOUNT_ID}.r2.cloudflarestorage.com`;

export class AdminD1BackupError extends Error {
  constructor(code) {
    super(code);
    this.name = "AdminD1BackupError";
    this.code = code;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function adminD1BackupApiUrl(suffix = "") {
  return `https://api.cloudflare.com/client/v4/accounts/${ADMIN_D1_BACKUP_ACCOUNT_ID}/d1/database/${ADMIN_D1_BACKUP_DATABASE_ID}${suffix}`;
}

export function parseD1ExportResponse(payload, fallbackBookmark) {
  if (
    !isRecord(payload) ||
    payload.success !== true ||
    !isRecord(payload.result)
  )
    throw new AdminD1BackupError("cloudflare_export_response_invalid");

  const result = payload.result;
  if (result.status === "error" || result.error)
    throw new AdminD1BackupError("cloudflare_export_failed");

  const bookmark =
    typeof result.at_bookmark === "string" && result.at_bookmark.length > 0
      ? result.at_bookmark
      : fallbackBookmark;
  if (typeof bookmark !== "string" || bookmark.length === 0)
    throw new AdminD1BackupError("cloudflare_export_bookmark_missing");

  const exportResult = isRecord(result.result) ? result.result : result;
  let signedUrl;
  if (
    typeof exportResult.signed_url === "string" &&
    exportResult.signed_url.length > 0
  ) {
    let parsedUrl;
    try {
      parsedUrl = new URL(exportResult.signed_url);
    } catch {
      throw new AdminD1BackupError("cloudflare_export_url_invalid");
    }
    if (parsedUrl.protocol !== "https:")
      throw new AdminD1BackupError("cloudflare_export_url_invalid");
    signedUrl = parsedUrl.toString();
  }

  if (
    result.status !== undefined &&
    !["complete", "error"].includes(result.status)
  )
    throw new AdminD1BackupError("cloudflare_export_status_invalid");

  const complete = result.status === "complete" || Boolean(signedUrl);
  if (complete && !signedUrl)
    throw new AdminD1BackupError("cloudflare_export_url_missing");

  return {
    bookmark,
    status: complete ? "complete" : "running",
    ...(signedUrl ? { signedUrl } : {}),
  };
}

export function buildAdminD1BackupObjectKey(scheduledTime, runId) {
  const timestamp = new Date(scheduledTime);
  if (!Number.isFinite(timestamp.getTime()))
    throw new AdminD1BackupError("backup_timestamp_invalid");
  if (typeof runId !== "string" || !runId.trim())
    throw new AdminD1BackupError("backup_run_id_missing");

  const date = timestamp.toISOString().slice(0, 10);
  const safeRunId = runId.trim().replace(/[^A-Za-z0-9_-]/g, "-");
  return `daily/${date}/${safeRunId}.sql`;
}

export function assertAdminD1BackupGitHubContext(env = process.env) {
  if (env.GITHUB_REPOSITORY !== "Atlasez/Admin-Atlasez")
    throw new AdminD1BackupError("github_repository_invalid");
  if (env.GITHUB_REF !== "refs/heads/main")
    throw new AdminD1BackupError("github_ref_invalid");
}

export function parseAdminD1BackupManifest(value) {
  const manifest = typeof value === "string" ? JSON.parse(value) : value;
  if (!isRecord(manifest))
    throw new AdminD1BackupError("backup_manifest_invalid");
  if (
    manifest.schemaVersion !== 1 ||
    manifest.accountId !== ADMIN_D1_BACKUP_ACCOUNT_ID ||
    manifest.databaseName !== ADMIN_D1_BACKUP_DATABASE_NAME ||
    manifest.databaseId !== ADMIN_D1_BACKUP_DATABASE_ID
  )
    throw new AdminD1BackupError("backup_target_mismatch");
  if (
    typeof manifest.objectKey !== "string" ||
    !/^daily\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]+\.sql$/.test(manifest.objectKey)
  )
    throw new AdminD1BackupError("backup_object_key_invalid");
  if (
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)
  )
    throw new AdminD1BackupError("backup_manifest_integrity_invalid");
  if (!Number.isFinite(Date.parse(manifest.completedAt)))
    throw new AdminD1BackupError("backup_manifest_time_invalid");
  return manifest;
}

export function buildAdminD1BackupManifest({
  objectKey,
  bookmark,
  bytes,
  sha256,
  startedAt,
  completedAt,
  runId,
}) {
  if (!objectKey.startsWith("daily/"))
    throw new AdminD1BackupError("backup_object_key_invalid");
  if (typeof bookmark !== "string" || bookmark.length === 0)
    throw new AdminD1BackupError("backup_bookmark_missing");
  if (!Number.isSafeInteger(bytes) || bytes <= 0)
    throw new AdminD1BackupError("backup_size_invalid");
  if (!/^[a-f0-9]{64}$/.test(sha256))
    throw new AdminD1BackupError("backup_sha256_invalid");
  if (
    !Number.isFinite(Date.parse(startedAt)) ||
    !Number.isFinite(Date.parse(completedAt))
  )
    throw new AdminD1BackupError("backup_time_invalid");
  if (typeof runId !== "string" || !runId.trim())
    throw new AdminD1BackupError("backup_run_id_missing");

  return {
    schemaVersion: 1,
    backupType: "cloudflare-d1-export",
    accountId: ADMIN_D1_BACKUP_ACCOUNT_ID,
    databaseName: ADMIN_D1_BACKUP_DATABASE_NAME,
    databaseId: ADMIN_D1_BACKUP_DATABASE_ID,
    runId,
    startedAt,
    completedAt,
    bookmark,
    objectKey,
    bytes,
    sha256,
    retentionDays: ADMIN_D1_BACKUP_RETENTION_DAYS,
    encryptionAtRest: "Cloudflare R2 AES-256 with Cloudflare-managed keys",
    encryptionInTransit: "TLS",
  };
}
