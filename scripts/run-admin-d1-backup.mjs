import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  ADMIN_D1_BACKUP_ACCOUNT_ID,
  ADMIN_D1_BACKUP_BUCKET,
  ADMIN_D1_BACKUP_DATABASE_ID,
  ADMIN_D1_BACKUP_MAX_EXPORT_BYTES,
  ADMIN_D1_BACKUP_MAX_EXPORT_DURATION_MS,
  ADMIN_D1_BACKUP_POLL_INTERVAL_MS,
  ADMIN_D1_BACKUP_RETENTION_DAYS,
  ADMIN_D1_BACKUP_R2_ENDPOINT,
  AdminD1BackupError,
  adminD1BackupApiUrl,
  assertAdminD1BackupGitHubContext,
  buildAdminD1BackupManifest,
  buildAdminD1BackupObjectKey,
  parseD1ExportResponse,
} from "./lib/admin-d1-backup.mjs";
import { verifyAdminD1BackupRetention } from "./lib/admin-d1-backup-r2.mjs";

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0)
    throw new AdminD1BackupError(`environment_${name.toLowerCase()}_missing`);
  return value;
}

function createS3Client() {
  return new S3Client({
    region: "auto",
    endpoint: ADMIN_D1_BACKUP_R2_ENDPOINT,
    credentials: {
      accessKeyId: requiredEnv("ADMIN_D1_BACKUP_R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("ADMIN_D1_BACKUP_R2_SECRET_ACCESS_KEY"),
    },
  });
}

async function requestD1Export(apiToken, bookmark) {
  let response;
  try {
    response = await fetch(adminD1BackupApiUrl("/export"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        output_format: "polling",
        ...(bookmark ? { current_bookmark: bookmark } : {}),
        dump_options: { compatibility: "d1" },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AdminD1BackupError("cloudflare_export_request_failed");
  }
  if (!response.ok)
    throw new AdminD1BackupError("cloudflare_export_http_failed");
  try {
    return await response.json();
  } catch {
    throw new AdminD1BackupError("cloudflare_export_json_invalid");
  }
}

async function waitForD1Export(apiToken) {
  const deadline = Date.now() + ADMIN_D1_BACKUP_MAX_EXPORT_DURATION_MS;
  let bookmark;
  let pollResponse = await requestD1Export(apiToken);
  while (true) {
    const result = parseD1ExportResponse(pollResponse, bookmark);
    bookmark = result.bookmark;
    if (result.status === "complete") return result;
    if (Date.now() >= deadline)
      throw new AdminD1BackupError("cloudflare_export_timeout");
    await sleep(ADMIN_D1_BACKUP_POLL_INTERVAL_MS);
    pollResponse = await requestD1Export(apiToken, bookmark);
  }
}

async function writeLimitedDownload(response, filePath) {
  if (!response.ok || !response.body)
    throw new AdminD1BackupError("cloudflare_export_download_failed");
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > ADMIN_D1_BACKUP_MAX_EXPORT_BYTES
  )
    throw new AdminD1BackupError("cloudflare_export_too_large");

  const hash = createHash("sha256");
  let bytes = 0;
  const limitAndHash = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > ADMIN_D1_BACKUP_MAX_EXPORT_BYTES) {
        callback(new AdminD1BackupError("cloudflare_export_too_large"));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      limitAndHash,
      createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    if (error instanceof AdminD1BackupError) throw error;
    throw new AdminD1BackupError("cloudflare_export_download_failed");
  }
  if (bytes <= 0) throw new AdminD1BackupError("cloudflare_export_empty");
  return { bytes, sha256: hash.digest("hex") };
}

async function verifyObjectInR2(client, key, expected) {
  let response;
  try {
    response = await client.send(
      new GetObjectCommand({ Bucket: ADMIN_D1_BACKUP_BUCKET, Key: key }),
    );
  } catch {
    throw new AdminD1BackupError("r2_backup_readback_failed");
  }
  if (!response.Body) throw new AdminD1BackupError("r2_backup_readback_empty");
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of response.Body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > ADMIN_D1_BACKUP_MAX_EXPORT_BYTES)
        throw new AdminD1BackupError("r2_backup_readback_too_large");
      hash.update(buffer);
    }
  } catch (error) {
    if (error instanceof AdminD1BackupError) throw error;
    throw new AdminD1BackupError("r2_backup_readback_failed");
  }
  const sha256 = hash.digest("hex");
  if (bytes !== expected.bytes || sha256 !== expected.sha256)
    throw new AdminD1BackupError("r2_backup_readback_mismatch");
}

async function run() {
  assertAdminD1BackupGitHubContext();
  if (process.env.ADMIN_D1_BACKUP_ENABLED !== "true")
    throw new AdminD1BackupError("backup_not_enabled");
  if (process.env.ADMIN_D1_BACKUP_CONFIRM_PRODUCTION_EXPORT !== "true")
    throw new AdminD1BackupError("production_export_not_confirmed");

  const apiToken = requiredEnv("ADMIN_D1_BACKUP_API_TOKEN");
  const client = createS3Client();
  let workDirectory;
  const startedAt = new Date().toISOString();
  const runId = requiredEnv("GITHUB_RUN_ID");
  const attempt = requiredEnv("GITHUB_RUN_ATTEMPT");
  const scheduledTime = process.env.GITHUB_RUN_STARTED_AT || startedAt;

  try {
    await verifyAdminD1BackupRetention(client);
    const exported = await waitForD1Export(apiToken);
    let downloadResponse;
    try {
      downloadResponse = await fetch(exported.signedUrl, {
        signal: AbortSignal.timeout(ADMIN_D1_BACKUP_MAX_EXPORT_DURATION_MS),
      });
    } catch {
      throw new AdminD1BackupError("cloudflare_export_download_failed");
    }

    workDirectory = await mkdtemp(join(tmpdir(), "atlasez-admin-d1-backup-"));
    const sqlPath = join(workDirectory, "reports.sql");
    const download = await writeLimitedDownload(downloadResponse, sqlPath);

    try {
      const verifierPath = resolve("scripts/verify-d1-export.mjs");
      const verifierOutput = execFileSync(
        process.execPath,
        [verifierPath, sqlPath],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      const verified = JSON.parse(verifierOutput);
      if (
        verified.integrity !== "ok" ||
        verified.foreignKeyViolations !== 0 ||
        verified.bytes !== download.bytes ||
        verified.sha256 !== download.sha256
      )
        throw new Error("invalid-verifier-result");
    } catch {
      throw new AdminD1BackupError("backup_sql_validation_failed");
    }

    const objectKey = buildAdminD1BackupObjectKey(
      scheduledTime,
      `${runId}-attempt-${attempt}`,
    );
    const metadata = {
      sha256: download.sha256,
      database_id: ADMIN_D1_BACKUP_DATABASE_ID,
      retention_days: String(ADMIN_D1_BACKUP_RETENTION_DAYS),
    };
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: ADMIN_D1_BACKUP_BUCKET,
          Key: objectKey,
          Body: createReadStream(sqlPath),
          ContentLength: download.bytes,
          ContentType: "application/sql",
          Metadata: metadata,
        }),
      );
    } catch {
      throw new AdminD1BackupError("r2_backup_upload_failed");
    }
    await verifyObjectInR2(client, objectKey, download);

    const completedAt = new Date().toISOString();
    const manifest = buildAdminD1BackupManifest({
      objectKey,
      bookmark: exported.bookmark,
      bytes: download.bytes,
      sha256: download.sha256,
      startedAt,
      completedAt,
      runId: `${runId}-attempt-${attempt}`,
    });
    const uploadedManifestKey = `${objectKey}.manifest.json`;
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: ADMIN_D1_BACKUP_BUCKET,
          Key: uploadedManifestKey,
          Body: JSON.stringify(manifest, null, 2),
          ContentLength: Buffer.byteLength(JSON.stringify(manifest, null, 2)),
          ContentType: "application/json",
        }),
      );
      const latest = {
        schemaVersion: 1,
        accountId: ADMIN_D1_BACKUP_ACCOUNT_ID,
        databaseId: ADMIN_D1_BACKUP_DATABASE_ID,
        completedAt,
        objectKey,
        manifestKey: uploadedManifestKey,
        bytes: download.bytes,
        sha256: download.sha256,
      };
      const latestBody = JSON.stringify(latest, null, 2);
      await client.send(
        new PutObjectCommand({
          Bucket: ADMIN_D1_BACKUP_BUCKET,
          Key: "status/latest-success.json",
          Body: latestBody,
          ContentLength: Buffer.byteLength(latestBody),
          ContentType: "application/json",
        }),
      );
    } catch {
      throw new AdminD1BackupError("r2_backup_manifest_write_failed");
    }
    console.log(
      JSON.stringify({
        status: "success",
        databaseId: ADMIN_D1_BACKUP_DATABASE_ID,
        objectKey,
        bytes: download.bytes,
        sha256: download.sha256,
        completedAt,
      }),
    );
  } finally {
    if (workDirectory)
      await rm(workDirectory, { recursive: true, force: true });
    client.destroy();
  }
}

run().catch((error) => {
  console.error(
    error instanceof AdminD1BackupError ? error.code : "backup_failed",
  );
  process.exitCode = 1;
});
