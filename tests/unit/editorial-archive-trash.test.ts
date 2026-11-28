import { describe, expect, it, vi } from "vitest";
import worker from "../../src/admin-worker";
import { createAdminTestEnvironment } from "../helpers/admin-test-environment";

const fileA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const fileB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const fileC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const archivedAt = "2026-10-01T01:00:00.000Z";
const expiredAt = "2026-10-31T01:00:00.000Z";
const origin = "https://admin.atlasez.test";
const operator = "trash-operator@atlasez.test";
const editor = "trash-editor@atlasez.test";
const global = "global@atlasez.test";
const trashPath = "/api/admin/editor/documents?archivedOnly=1";
const purgePath = (id: string) =>
  `/api/admin/editor/documents/${id}/purge-archive`;

function fixture() {
  const { db, env, request } = createAdminTestEnvironment();
  db.prepare(
    "INSERT INTO report_admin_permissions(email,subject) VALUES (?,?)",
  ).run(editor, "mathematics");
  db.prepare(
    "INSERT INTO atlasez_project_memberships(project_id,email,role,joined_at) VALUES ('atlas',?,'manager',?)",
  ).run(operator, archivedAt);
  db.prepare(
    "INSERT INTO editorial_member_profiles(email,display_name,bio,updated_at) VALUES (?,'Operations','Fixture',?)",
  ).run(operator, archivedAt);
  db.prepare(
    "INSERT INTO editorial_project_member_profiles(project_id,email,internal_bio,updated_at) VALUES ('atlas',?,'Fixture',?)",
  ).run(operator, archivedAt);
  const insert = db.prepare(
    `INSERT INTO editorial_documents
       (id,subject,category,locale,slug,title,summary,body,status,concept_id,created_by,updated_by,created_at,updated_at,archived_at,archive_expires_at)
     VALUES (?,?,'test','ja',?,'Draft','','document body','draft','',?,?,?,?,?,?)`,
  );
  const archive = (id: string, subject: string, expiresAt = expiredAt) =>
    insert.run(
      id,
      subject,
      id,
      global,
      global,
      archivedAt,
      archivedAt,
      archivedAt,
      expiresAt,
    );
  return { db, env, request, archive };
}

describe("editorial archive trash", () => {
  it("keeps deletion review scoped and refuses approval until a public article is withdrawn", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(archivedAt));
    const { db, request, archive } = fixture();
    const coordinator = "deletion-coordinator@atlasez.test";
    const otherCoordinator = "other-coordinator@atlasez.test";
    const appoint = db.prepare(
      "INSERT INTO editorial_workflow_roles(role,subject,email,created_at,created_by) VALUES ('subject-coordinator',?,?,?,?)",
    );
    appoint.run("mathematics", coordinator, archivedAt, global);
    appoint.run("physics", otherCoordinator, archivedAt, global);
    archive(fileA, "mathematics");
    db.prepare(
      "UPDATE editorial_documents SET archived_at=NULL, archive_expires_at=NULL, current_version_id='v1', published_version_id='v1', published_at=? WHERE id=?",
    ).run(archivedAt, fileA);
    db.prepare(
      "UPDATE admin_notification_global_cutoff SET cleared_before=?",
    ).run("2026-09-30T01:00:00.000Z");
    const path = `/api/admin/editor/documents/${fileA}/deletion-request`;
    expect(
      (await request(path, editor, { expectedVersionId: "v0" })).status,
    ).toBe(409);
    const response = await request(path, editor, { expectedVersionId: "v1" });
    expect(response.status).toBe(201);
    const deletion = (await response.json()) as { request: { id: string } };
    const review = `/api/admin/editor/deletion-requests/${deletion.request.id}`;
    const decision = { decision: "approved" };
    const queue = "/api/admin/editor/deletion-requests";
    expect((await request(review, otherCoordinator, decision)).status).toBe(
      403,
    );
    expect(await (await request(queue, otherCoordinator)).json()).toEqual({
      requests: [],
    });
    const assignedQueue = await request(queue, coordinator);
    expect((await assignedQueue.json()).requests).toMatchObject([
      { id: deletion.request.id },
    ]);
    expect((await request("/admin/deletion-requests/", operator)).status).toBe(
      200,
    );
    expect(
      (await request(`/admin/editor/?document=${fileA}`, operator)).status,
    ).toBe(200);
    expect(
      JSON.stringify(
        await (await request("/api/admin/notifications", operator)).json(),
      ),
    ).toContain(deletion.request.id);
    const blocked = await request(review, coordinator, decision);
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      error: expect.stringContaining("公開停止"),
    });
    expect(
      db
        .prepare("SELECT deleted_at FROM editorial_documents WHERE id=?")
        .get(fileA),
    ).toMatchObject({ deleted_at: null });
  });

  it.each(["/admin/articles/?trash=1", `/admin/editor/?document=${fileA}`])(
    "keeps the archive destination %s through login",
    async (path) => {
      const { env } = fixture();
      const response = await worker.fetch(new Request(`${origin}${path}`), {
        ...env,
        ADMIN_AUTH_MODE: "google-oauth",
        GOOGLE_OAUTH_CLIENT_ID: "fixture-client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "fixture-client-secret",
      } as never);
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location")!, origin);
      expect(location.pathname).toBe("/auth/google/login");
      expect(location.searchParams.get("returnTo")).toBe(path);
    },
  );

  it("lists archived drafts for operations and restricts an editor to their subject", async () => {
    const { request, archive } = fixture();
    archive(fileA, "mathematics");
    archive(fileB, "physics");
    expect((await request("/admin/articles/?trash=1", operator)).status).toBe(
      200,
    );
    const broad = await request(trashPath, operator);
    expect(broad.status).toBe(200);
    expect(await broad.json()).toMatchObject({
      documents: expect.arrayContaining(
        [
          { id: fileA, canPurgeArchive: true, canRestoreArchive: true },
          { id: fileB, canPurgeArchive: true, canRestoreArchive: true },
        ].map((item) => expect.objectContaining(item)),
      ),
    });
    const scoped = await request(trashPath, editor);
    expect(scoped.status).toBe(200);
    expect((await scoped.json()).documents).toMatchObject([
      { id: fileA, canPurgeArchive: false, canRestoreArchive: true },
    ]);
  });

  it("requires an operations role, same origin and the current archive timestamp to purge", async () => {
    const { db, request, archive } = fixture();
    archive(fileA, "mathematics");
    const del = (email: string, value: string, from = origin) =>
      request(purgePath(fileA), email, { archivedAt: value }, from, "DELETE");
    expect((await del(editor, archivedAt)).status).toBe(403);
    expect(
      (await del(operator, archivedAt, "https://other.atlasez.test")).status,
    ).toBe(403);
    expect((await del(operator, expiredAt)).status).toBe(409);
    db.prepare("UPDATE editorial_documents SET published_at=? WHERE id=?").run(
      archivedAt,
      fileA,
    );
    expect((await del(operator, archivedAt)).status).toBe(409);
    db.prepare(
      "UPDATE editorial_documents SET published_at=NULL WHERE id=?",
    ).run(fileA);
    expect((await del(operator, archivedAt)).status).toBe(200);
    expect((await del(operator, archivedAt)).status).toBe(409);
    expect(
      db.prepare("SELECT id FROM editorial_documents WHERE id=?").get(fileA),
    ).toBeUndefined();
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='article_archive_purged' AND target_id=?",
        )
        .get(fileA),
    ).toMatchObject({ n: 1 });
  });

  it("notifies operations of an editor request and starts the 30-day window on approval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(archivedAt));
    const { db, request, archive } = fixture();
    archive(fileA, "mathematics");
    db.prepare(
      "UPDATE editorial_documents SET archived_at=NULL, archive_expires_at=NULL WHERE id=?",
    ).run(fileA);
    const path = `/api/admin/editor/documents/${fileA}/archive-request`;
    db.prepare(
      "UPDATE admin_notification_global_cutoff SET cleared_before=?",
    ).run("2026-09-30T01:00:00.000Z");
    const submit = await request(path, editor, {
      expectedUpdatedAt: archivedAt,
    });
    expect(submit.status).toBe(201);
    const { requestId } = (await submit.json()) as { requestId: string };
    expect(
      (await request(`/admin/editor/?document=${fileA}`, operator)).status,
    ).toBe(200);
    const notifications = await request("/api/admin/notifications", operator);
    expect(notifications.status).toBe(200);
    expect(JSON.stringify(await notifications.json())).toContain(requestId);
    const approved = await request(
      path,
      operator,
      { requestId, decision: "approved" },
      origin,
      "PATCH",
    );
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      archivedAt,
      archiveExpiresAt: expiredAt,
    });
    expect((await request(trashPath, operator)).status).toBe(200);
  });

  it("purges only expired, approved archives on the hourly job", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T01:00:00.000Z"));
    const { db, env, archive } = fixture();
    archive(fileA, "mathematics");
    archive(fileB, "physics", "2026-12-01T01:00:00.000Z");
    archive(fileC, "physics");
    const insert = db.prepare(
      `INSERT INTO editorial_document_archive_requests(id,document_id,status,requested_by,requested_at,requested_updated_at,decided_at)
       VALUES (?,?, 'approved', ?,?,?,?)`,
    );
    insert.run("request-a", fileA, editor, archivedAt, archivedAt, archivedAt);
    insert.run("request-b", fileB, editor, archivedAt, archivedAt, archivedAt);
    const pending: Promise<unknown>[] = [];
    await worker.scheduled(
      { cron: "0 * * * *" },
      {
        ...env,
        RESEND_API_KEY: "isolated-resend-fixture",
        EMAIL_FROM: "fixture@atlasez.test",
      } as never,
      {
        waitUntil: (task) => pending.push(task),
      },
    );
    await Promise.all(pending);
    expect(
      db.prepare("SELECT id FROM editorial_documents ORDER BY id").all(),
    ).toMatchObject([{ id: fileB }, { id: fileC }]);
    expect(
      db
        .prepare(
          "SELECT id FROM editorial_document_archive_requests WHERE document_id=?",
        )
        .get(fileA),
    ).toBeUndefined();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
