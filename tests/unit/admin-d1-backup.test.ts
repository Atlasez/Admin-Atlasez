import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import {
  ADMIN_D1_BACKUP_ACCOUNT_ID,
  ADMIN_D1_BACKUP_BUCKET,
  ADMIN_D1_BACKUP_DATABASE_ID,
  ADMIN_D1_BACKUP_DATABASE_NAME,
  ADMIN_D1_BACKUP_MAX_AGE_MS,
  ADMIN_D1_BACKUP_MAX_EXPORT_BYTES,
  ADMIN_D1_BACKUP_RETENTION_DAYS,
  AdminD1BackupError,
  adminD1BackupApiUrl,
  assertAdminD1BackupGitHubContext,
  buildAdminD1BackupManifest,
  buildAdminD1BackupObjectKey,
  parseAdminD1BackupManifest,
  parseD1ExportResponse,
} from "../../scripts/lib/admin-d1-backup.mjs";
import {
  ADMIN_D1_BACKUP_LIFECYCLE_RULE_ID,
  assertAdminD1BackupExpiration,
  verifyAdminD1BackupRetention,
} from "../../scripts/lib/admin-d1-backup-r2.mjs";

const manifest = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  backupType: "cloudflare-d1-export",
  accountId: ADMIN_D1_BACKUP_ACCOUNT_ID,
  databaseName: ADMIN_D1_BACKUP_DATABASE_NAME,
  databaseId: ADMIN_D1_BACKUP_DATABASE_ID,
  runId: "123456-attempt-1",
  startedAt: "2026-11-29T18:00:00.000Z",
  completedAt: "2026-11-29T18:01:00.000Z",
  bookmark: "bookmark-safe",
  objectKey: "daily/2026-11-29/123456-attempt-1.sql",
  bytes: 42,
  sha256: "a".repeat(64),
  retentionDays: ADMIN_D1_BACKUP_RETENTION_DAYS,
  encryptionAtRest: "Cloudflare R2 AES-256 with Cloudflare-managed keys",
  encryptionInTransit: "TLS",
  ...overrides,
});

describe("admin D1 backup constants and target", () => {
  it("pins the approved database and private R2 bucket", () => {
    expect(ADMIN_D1_BACKUP_ACCOUNT_ID).toBe("812021e62fa20465950b61be55dfe064");
    expect(ADMIN_D1_BACKUP_DATABASE_NAME).toBe("atlasez-reports");
    expect(ADMIN_D1_BACKUP_DATABASE_ID).toBe(
      "d5112a62-7ed6-49c8-b6a2-18ee2dbab678",
    );
    expect(ADMIN_D1_BACKUP_BUCKET).toBe("atlasez-admin-d1-backups");
    expect(ADMIN_D1_BACKUP_RETENTION_DAYS).toBe(35);
    expect(ADMIN_D1_BACKUP_MAX_AGE_MS).toBe(26 * 60 * 60 * 1000);
    expect(ADMIN_D1_BACKUP_MAX_EXPORT_BYTES).toBe(512 * 1024 * 1024);
    expect(adminD1BackupApiUrl("/export")).toBe(
      "https://api.cloudflare.com/client/v4/accounts/812021e62fa20465950b61be55dfe064/d1/database/d5112a62-7ed6-49c8-b6a2-18ee2dbab678/export",
    );
  });
});

describe("D1 export polling response", () => {
  it("reads the documented nested signed URL response without exposing its value", () => {
    expect(
      parseD1ExportResponse(
        {
          success: true,
          result: {
            status: "complete",
            at_bookmark: "bookmark-1",
            result: {
              filename: "backup.sql",
              signed_url: "https://export.example/sql",
            },
          },
        },
        undefined,
      ),
    ).toEqual({
      bookmark: "bookmark-1",
      status: "complete",
      signedUrl: "https://export.example/sql",
    });
  });

  it("uses the current bookmark while the export is in progress", () => {
    expect(
      parseD1ExportResponse(
        { success: true, result: { at_bookmark: "bookmark-1" } },
        undefined,
      ),
    ).toEqual({ bookmark: "bookmark-1", status: "running" });
    expect(
      parseD1ExportResponse(
        {
          success: true,
          result: { status: "complete", signed_url: "https://x.test" },
        },
        "bookmark-1",
      ),
    ).toEqual({
      bookmark: "bookmark-1",
      status: "complete",
      signedUrl: "https://x.test/",
    });
  });

  it.each([
    ["rejects an unsuccessful API envelope", { success: false, result: {} }],
    ["rejects an export error", { success: true, result: { status: "error" } }],
    ["rejects a missing bookmark", { success: true, result: {} }],
    [
      "rejects a non-HTTPS download URL",
      {
        success: true,
        result: {
          status: "complete",
          at_bookmark: "bookmark-1",
          result: { signed_url: "http://example.invalid/backup" },
        },
      },
    ],
  ])("%s", (_name, response) => {
    expect(() => parseD1ExportResponse(response, undefined)).toThrow(
      AdminD1BackupError,
    );
  });
});

describe("object keys and manifests", () => {
  it("uses UTC dates and a sanitized unique workflow run identifier", () => {
    expect(
      buildAdminD1BackupObjectKey(
        "2026-11-29T18:00:00.000Z",
        "123/456-attempt-1",
      ),
    ).toBe("daily/2026-11-29/123-456-attempt-1.sql");
    expect(() => buildAdminD1BackupObjectKey("not-a-time", "run")).toThrow(
      AdminD1BackupError,
    );
    expect(() => buildAdminD1BackupObjectKey("2026-11-29", " ")).toThrow(
      AdminD1BackupError,
    );
  });

  it("records the exact database, 35-day retention and managed at-rest encryption", () => {
    const result = buildAdminD1BackupManifest({
      objectKey: "daily/2026-11-29/123-attempt-1.sql",
      bookmark: "bookmark-1",
      bytes: 42,
      sha256: "b".repeat(64),
      startedAt: "2026-11-29T18:00:00.000Z",
      completedAt: "2026-11-29T18:01:00.000Z",
      runId: "123-attempt-1",
    });
    expect(result.databaseId).toBe(ADMIN_D1_BACKUP_DATABASE_ID);
    expect(result.retentionDays).toBe(35);
    expect(result.encryptionAtRest).toContain("AES-256");
    expect(result.encryptionInTransit).toBe("TLS");
    expect(parseAdminD1BackupManifest(result)).toEqual(result);
  });

  it.each([
    ["wrong D1", { databaseId: "wrong" }],
    ["object outside daily prefix", { objectKey: "other/2026-11-29/a.sql" }],
    ["invalid digest", { sha256: "not-a-hash" }],
  ])("rejects a %s manifest", (_name, override) => {
    expect(() => parseAdminD1BackupManifest(manifest(override))).toThrow(
      AdminD1BackupError,
    );
  });
});

describe("R2 backup expiration", () => {
  it("requires the approved 35-day lifecycle rule on uploaded backup objects", () => {
    const lastModified = new Date("2026-11-29T18:00:00.000Z");
    const now = new Date("2026-11-29T18:01:00.000Z");
    const expires = new Date("2027-01-04T00:00:00.000Z");
    const header = `expiry-date="${expires.toUTCString()}", rule-id="${ADMIN_D1_BACKUP_LIFECYCLE_RULE_ID}"`;
    expect(assertAdminD1BackupExpiration(header, lastModified, now)).toBe(
      expires.toISOString(),
    );
  });

  it.each([
    ["no lifecycle header", undefined, "2026-11-29T18:00:00.000Z"],
    [
      "the wrong lifecycle rule",
      'expiry-date="Mon, 04 Jan 2027 00:00:00 GMT", rule-id="another-rule"',
      "2026-11-29T18:00:00.000Z",
    ],
    [
      "an expiration earlier than 35 days",
      `expiry-date="Mon, 28 Dec 2026 00:00:00 GMT", rule-id="${ADMIN_D1_BACKUP_LIFECYCLE_RULE_ID}"`,
      "2026-11-29T18:00:00.000Z",
    ],
  ])("rejects %s", (_name, header, lastModified) => {
    expect(() =>
      assertAdminD1BackupExpiration(
        header,
        lastModified,
        new Date("2026-11-29T18:01:00.000Z"),
      ),
    ).toThrow(AdminD1BackupError);
  });

  it("checks a disposable object under daily/ and removes the preflight marker", async () => {
    const now = new Date("2026-11-29T18:00:00.000Z");
    const expires = new Date(now.getTime() + 35 * 24 * 60 * 60 * 1000 + 60_000);
    const operations: string[] = [];
    let markerBody = "";
    const client = {
      async send(command: unknown) {
        if (command instanceof PutObjectCommand) {
          operations.push("put");
          expect(command.input.Key).toMatch(/^daily\/__preflight\//);
          markerBody = String(command.input.Body);
          return {};
        }
        if (command instanceof HeadObjectCommand) {
          operations.push("head");
          return {
            Expiration: `expiry-date="${expires.toUTCString()}", rule-id="${ADMIN_D1_BACKUP_LIFECYCLE_RULE_ID}"`,
            LastModified: now,
          };
        }
        if (command instanceof GetObjectCommand) {
          operations.push("get");
          return { Body: { transformToString: async () => markerBody } };
        }
        if (command instanceof DeleteObjectCommand) {
          operations.push("delete");
          return {};
        }
        throw new Error("unexpected-s3-command");
      },
    };

    await expect(
      verifyAdminD1BackupRetention(client, now),
    ).resolves.toBeUndefined();
    expect(operations).toEqual(["put", "head", "get", "delete"]);
  });
});

describe("workflow guardrails", () => {
  it("only accepts the official repository and main branch", () => {
    expect(() =>
      assertAdminD1BackupGitHubContext({
        GITHUB_REPOSITORY: "Atlasez/Admin-Atlasez",
        GITHUB_REF: "refs/heads/main",
      }),
    ).not.toThrow();
    expect(() =>
      assertAdminD1BackupGitHubContext({
        GITHUB_REPOSITORY: "fork/Admin-Atlasez",
        GITHUB_REF: "refs/heads/main",
      }),
    ).toThrow(AdminD1BackupError);
    expect(() =>
      assertAdminD1BackupGitHubContext({
        GITHUB_REPOSITORY: "Atlasez/Admin-Atlasez",
        GITHUB_REF: "refs/heads/codex/feature",
      }),
    ).toThrow(AdminD1BackupError);
  });

  it("keeps scheduled production export disabled by default and manually confirmed", () => {
    const workflow = parse(
      readFileSync(".github/workflows/admin-d1-backup.yml", "utf8"),
    ) as {
      permissions: Record<string, string>;
      on: {
        schedule: unknown[];
        workflow_dispatch: {
          inputs: { confirm_production_export: { default: boolean } };
        };
      };
      jobs: { backup: { environment: string; steps: Array<{ name: string }> } };
    };
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.backup.environment).toBe("admin-d1-backup");
    expect(workflow.on.schedule).toHaveLength(2);
    expect(
      workflow.on.workflow_dispatch.inputs.confirm_production_export.default,
    ).toBe(false);
    const text = readFileSync(".github/workflows/admin-d1-backup.yml", "utf8");
    expect(text).toContain("vars.ADMIN_D1_BACKUP_ENABLED == 'true'");
    expect(text).toContain("inputs.confirm_production_export == true");
    expect(text).toContain("github.repository == 'Atlasez/Admin-Atlasez'");
    expect(text).toContain("github.ref == 'refs/heads/main'");
    const steps = workflow.jobs.backup.steps.map(({ name }) => name);
    expect(
      steps.indexOf(
        "Verify R2 bucket retention before starting a production export",
      ),
    ).toBeLessThan(
      steps.indexOf("Export, validate, and upload the production D1 database"),
    );
  });
});
