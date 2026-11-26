import type { D1Database } from "./admin-database";
import { readRequestTextLimited } from "./request-body-text";

const job = "editorial-release-deployment-http-error";
const refreshIntervalMs = 15 * 60_000;

export type EditorialDeploymentHttpError = {
  status: number;
  providerCode: number | null;
  observedAt: string;
};

const isHttpError = (status: unknown): status is number =>
  typeof status === "number" &&
  Number.isInteger(status) &&
  status >= 400 &&
  status <= 599;

const safeProviderCode = (code: unknown): number | null =>
  typeof code === "number" &&
  Number.isInteger(code) &&
  code >= 1 &&
  code <= 999999
    ? code
    : null;

export async function readCloudflareDeploymentErrorCode(response: Response) {
  try {
    const body = await readRequestTextLimited(response, 8 * 1024);
    const payload = JSON.parse(body ?? "") as { errors?: { code?: unknown }[] };
    return safeProviderCode(payload?.errors?.[0]?.code);
  } catch {
    return null;
  }
}

export async function recordEditorialDeploymentHttpError(
  db: D1Database,
  status: number | null,
  providerCode: number | null,
  now = new Date(),
) {
  if (!isHttpError(status)) return;
  // This reserved checkpoint does not participate in the existing sync cursors.
  const cursor = JSON.stringify({
    status,
    providerCode: safeProviderCode(providerCode),
  });
  const refreshBefore = new Date(
    now.getTime() - refreshIntervalMs,
  ).toISOString();
  await db
    .prepare(
      `INSERT INTO admin_worker_sync_checkpoints (job, cursor, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(job) DO UPDATE SET cursor=excluded.cursor, updated_at=excluded.updated_at
       WHERE admin_worker_sync_checkpoints.updated_at <= excluded.updated_at
         AND (admin_worker_sync_checkpoints.cursor IS NOT excluded.cursor
           OR admin_worker_sync_checkpoints.updated_at <= ?)`,
    )
    .bind(job, cursor, now.toISOString(), refreshBefore)
    .run();
}

export async function readEditorialDeploymentHttpError(
  db: D1Database,
): Promise<EditorialDeploymentHttpError | null> {
  try {
    const row = await db
      .prepare(
        "SELECT cursor, updated_at FROM admin_worker_sync_checkpoints WHERE job = ?",
      )
      .bind(job)
      .first<{ cursor: string | null; updated_at: string }>();
    if (!row?.cursor || !Number.isFinite(Date.parse(row.updated_at)))
      return null;
    const saved = JSON.parse(row.cursor) as {
      status?: unknown;
      providerCode?: unknown;
    };
    if (!isHttpError(saved?.status)) return null;
    return {
      status: saved.status,
      providerCode: safeProviderCode(saved.providerCode),
      observedAt: new Date(row.updated_at).toISOString(),
    };
  } catch {
    return null;
  }
}
