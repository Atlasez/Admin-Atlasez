import { describe, expect, it, vi } from "vitest";
import worker from "../../src/worker";

const analyticsRequest = (regionCode: string, country = "JP") => {
  const request = new Request("https://atlas.example/api/article-analytics", {
    method: "POST",
    headers: {
      origin: "https://atlas.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      articleId: "article-id",
      articleTitle: "記事",
      subject: "mathematics",
      category: "algebra",
      locale: "ja",
      event: "view",
    }),
  });
  Object.defineProperty(request, "cf", { value: { country, regionCode } });
  return request;
};

function streamingRequest(
  path: string,
  chunkBytes: number,
  totalChunks: number,
) {
  let pulled = 0;
  let cancelled = false;
  const chunk = new Uint8Array(chunkBytes);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= totalChunks) {
        controller.close();
        return;
      }
      pulled += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request(`https://atlas.example${path}`, {
    method: "POST",
    headers: {
      origin: "https://atlas.example",
      "content-type": "application/json",
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return {
    request,
    totalChunks,
    get pulled() {
      return pulled;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

const emptyEnvironment = {
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  REPORTS: { prepare: vi.fn() },
};

describe("article analytics regional aggregation", () => {
  it("accepts a valid article report through the bounded JSON reader", async () => {
    const queries: string[] = [];
    const prepare = (query: string) => ({
      bind: (..._values: unknown[]) => ({
        first: async () => (query.includes("COUNT(*)") ? { count: 0 } : null),
        run: async () => {
          queries.push(query);
          return {};
        },
      }),
    });
    const response = await worker.fetch(
      new Request("https://atlas.example/api/article-reports", {
        method: "POST",
        headers: {
          origin: "https://atlas.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          articleTitle: "記事",
          articleUrl: "https://atlas.example/atlas/ja/example/",
          articleId: "example",
          subject: "mathematics",
          category: "algebra",
          reportType: "error",
          details: "説明",
          locale: "ja",
          openedAt: Date.now() - 2_000,
        }),
      }),
      {
        ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
        REPORTS: { prepare },
      } as never,
      { waitUntil: vi.fn() } as never,
    );

    expect(response.status).toBe(201);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("INSERT INTO article_reports");
  });

  it("stores only the Japanese region code alongside the article aggregate", async () => {
    const queries: string[] = [];
    const values: unknown[][] = [];
    const response = await worker.fetch(
      analyticsRequest("JP-13"),
      {
        ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
        REPORTS: {
          prepare: (query: string) => ({
            bind: (...bound: unknown[]) => {
              values.push(bound);
              return {
                run: async () => {
                  queries.push(query);
                  return {};
                },
              };
            },
          }),
        },
      } as never,
      {} as never,
    );

    expect(response.status).toBe(201);
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain("article_analytics_region_daily");
    expect(values[1]).toContain("JP-13");
  });

  it("does not create a regional row for non-Japanese traffic", async () => {
    const queries: string[] = [];
    const response = await worker.fetch(
      analyticsRequest("US-CA", "US"),
      {
        ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
        REPORTS: {
          prepare: (query: string) => ({
            bind: () => ({
              run: async () => {
                queries.push(query);
                return {};
              },
            }),
          }),
        },
      } as never,
      {} as never,
    );

    expect(response.status).toBe(201);
    expect(queries).toHaveLength(1);
  });

  it("rejects oversized streamed public inputs before consuming their full bodies", async () => {
    for (const [path, chunkBytes] of [
      ["/api/article-reports", 32_000],
      ["/api/article-analytics", 8_000],
    ] as const) {
      const streamed = streamingRequest(path, chunkBytes, 10);
      expect(streamed.request.headers.get("content-length")).toBeNull();
      const response = await worker.fetch(
        streamed.request,
        emptyEnvironment as never,
        { waitUntil: vi.fn() } as never,
      );

      expect(response.status).toBe(413);
      expect(streamed.cancelled).toBe(true);
      expect(streamed.pulled).toBeLessThan(streamed.totalChunks);
    }
    expect(emptyEnvironment.REPORTS.prepare).not.toHaveBeenCalled();
  });

  it("returns 400 for null, array, or primitive JSON without touching D1", async () => {
    for (const path of ["/api/article-reports", "/api/article-analytics"])
      for (const body of ["null", "[]", '"text"']) {
        const request = new Request(`https://atlas.example${path}`, {
          method: "POST",
          headers: {
            origin: "https://atlas.example",
            "content-type": "application/json",
          },
          body,
        });
        const response = await worker.fetch(
          request,
          emptyEnvironment as never,
          { waitUntil: vi.fn() } as never,
        );

        expect(response.status).toBe(400);
      }
    expect(emptyEnvironment.REPORTS.prepare).not.toHaveBeenCalled();
  });
});
