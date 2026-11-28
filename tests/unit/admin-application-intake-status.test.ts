import { describe, expect, it } from "vitest";
import worker from "../../src/admin-worker";

const statusEnv = (
  unresolvedCount: number,
  oldestCreatedAt: string | null,
) => ({
  REPORTS: {
    prepare(query: string) {
      return {
        first: async () => {
          expect(query).toContain(
            "FROM atlasez_member_applications WHERE status IN ('new','reviewing')",
          );
          return {
            unresolved_count: unresolvedCount,
            oldest_created_at: oldestCreatedAt,
          };
        },
      };
    },
  },
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
});

describe("public application intake status", () => {
  it("returns only an open boolean without exposing queue details", async () => {
    const response = await worker.fetch(
      new Request("https://admin.example/api/public/application-intake-status"),
      statusEnv(4, new Date().toISOString()) as never,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ open: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("reports closed when the global unresolved limit is reached", async () => {
    const response = await worker.fetch(
      new Request("https://admin.example/api/public/application-intake-status"),
      statusEnv(10, new Date().toISOString()) as never,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ open: false });
  });
});
