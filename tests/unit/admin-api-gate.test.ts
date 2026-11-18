import { describe, expect, it } from "vitest";
import worker from "../../src/admin-worker";

function unauthenticatedEnv() {
  const statement = {
    bind() {
      return this;
    },
    async all() {
      return { results: [] };
    },
    async first() {
      return null;
    },
    async run() {
      return { meta: { changes: 0 } };
    },
  };
  const fetchedAssets: string[] = [];
  return {
    env: {
      ADMIN_AUTH_MODE: "google-oauth",
      ADMIN_PRIMARY_EMAIL: "admin@example.test",
      REPORTS: {
        prepare: () => statement,
        batch: async () => [],
      },
      ASSETS: {
        fetch: async (request: Request) => {
          fetchedAssets.push(new URL(request.url).pathname);
          return new Response("asset", { status: 200 });
        },
      },
    },
    fetchedAssets,
  };
}

describe("管理APIの実行時認証境界", () => {
  it("新規・未登録の管理APIもディスパッチ前に認証を要求する", async () => {
    const { env } = unauthenticatedEnv();
    const response = await worker.fetch(
      new Request("https://admin.example.test/api/admin/future-write", {
        method: "POST",
      }),
      env as never,
    );

    expect(response.status).toBe(401);
  });

  it("管理者・メンバー・専用スコープの各境界で未認証を拒否する", async () => {
    const cases = [
      ["/api/admin/report-admin-permissions", "GET"],
      ["/api/admin/portal", "GET"],
      [
        "/api/admin/applications/11111111-1111-4111-8111-111111111111?project=thinking-cafe",
        "PATCH",
      ],
      ["/api/admin/profile", "GET"],
      ["/api/admin/developer/diagnostics", "GET"],
      ["/api/admin/auth-status", "GET"],
      ["/api/admin/member-procedures", "GET"],
    ] as const;

    for (const [path, method] of cases) {
      const { env } = unauthenticatedEnv();
      const response = await worker.fetch(
        new Request(`https://admin.example.test${path}`, { method }),
        env as never,
      );
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it("管理PWAのmanifestとservice workerは許可した静的資産として配信する", async () => {
    const { env, fetchedAssets } = unauthenticatedEnv();
    for (const path of ["/admin-manifest.webmanifest", "/admin-sw.js"]) {
      const response = await worker.fetch(
        new Request(`https://admin.example.test${path}`),
        env as never,
      );
      expect(response.status).toBe(200);
      expect(fetchedAssets).toContain(path);
    }
  });
});
