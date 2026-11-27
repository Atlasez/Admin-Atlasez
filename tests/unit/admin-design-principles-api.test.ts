import { expect, it, vi } from "vitest";
import worker from "../../src/admin-worker";
import { createAdminTestEnvironment } from "../helpers/admin-test-environment";

it("rejects a stale edit even when two design-principle writes share a timestamp", async () => {
  const { db, env, request } = createAdminTestEnvironment();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-26T00:00:00.000Z"));
  const email = env.ADMIN_PRIMARY_EMAIL;
  const path = "/api/admin/design-principles";
  const draft = {
    title: "初回",
    category: "selection",
    status: "candidate",
    statement: "適切な候補を選ぶ",
    sources: [{ label: "既存の参照", href: "/admin/editor/" }],
  };
  expect((await request(path, "member@atlasez.test")).status).toBe(403);
  const created = await request(path, email, draft);
  expect(created.status).toBe(201);
  const initial = (await created.json()) as { id: string; revision: string };
  const patch = (title: string, source: string) =>
    worker.fetch(
      new Request(`https://admin.atlasez.test${path}/${initial.id}`, {
        method: "PATCH",
        headers: {
          cookie: `atlasez_admin_session=isolated-${email}`,
          origin: "https://admin.atlasez.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...draft,
          title,
          revision: initial.revision,
          sources: [{ label: source, href: "/admin/editor/" }],
        }),
      }),
      env as never,
    );
  expect((await patch("先の更新", "先の参照")).status).toBe(200);
  expect((await patch("古い更新", "古い参照")).status).toBe(409);
  expect(db.prepare("SELECT title FROM admin_design_principles").get()).toEqual(
    { title: "先の更新" },
  );
  expect(
    db.prepare("SELECT label FROM admin_design_principle_sources").all(),
  ).toEqual([{ label: "先の参照" }]);
});
