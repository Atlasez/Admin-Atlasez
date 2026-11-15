import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/admin-worker";

const document = {
  id: "22222222-2222-4222-8222-222222222222",
  updated_at: "2026-08-30T00:00:00.000Z",
  subject: "mathematics",
  category: "overview",
  locale: "ja",
  slug: "compare-and-set",
  title: "競合を検知する記事",
  summary: "公開処理の競合検知テスト",
  concept_id: "mathematics.overview.compare-and-set",
  body: "更新前の本文",
  latex_engine: "katex",
  status: "approved",
  article_references: "[]",
  base_document_id: null,
  published_at: null,
  updated_by: "editor@example.test",
};

async function articleSnapshotHash() {
  const canonical = JSON.stringify([
    document.id,
    document.updated_at,
    document.subject,
    document.category,
    document.locale,
    document.slug,
    document.title,
    document.summary,
    document.concept_id,
    document.body,
    document.latex_engine,
    document.status,
    document.article_references,
  ]);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

class PublicationStatement {
  private values: unknown[] = [];

  constructor(
    private readonly query: string,
    private readonly runRecord: Record<string, unknown>,
    private readonly executed: Array<{ query: string; values: unknown[] }>,
  ) {}

  bind(...values: unknown[]) {
    const placeholders = (this.query.match(/\?/g) ?? []).length;
    if (placeholders !== values.length)
      throw new Error(
        `Wrong number of parameter bindings: expected ${placeholders}, received ${values.length}`,
      );
    this.values = values;
    return this;
  }

  async all<T>() {
    if (this.query.includes("FROM editorial_publication_runs"))
      return { results: [this.runRecord] as T[] };
    return { results: [] as T[] };
  }

  async first<T>() {
    if (this.query.includes("FROM editorial_documents")) return document as T;
    if (this.query.includes("SELECT failure_history"))
      return { failure_history: null } as T;
    if (this.query.includes("SELECT document_id"))
      return { document_id: document.id } as T;
    return null as T | null;
  }

  async run() {
    this.executed.push({ query: this.query, values: this.values });
    return {
      // Simulate a concurrent save winning immediately before the publish write.
      meta: {
        changes: this.query.includes("UPDATE editorial_documents") ? 0 : 1,
      },
    };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("記事公開の競合保護", () => {
  it("D1の比較更新が0件なら公開を確定せず運営確認にする", async () => {
    const run = {
      id: "33333333-3333-4333-8333-333333333333",
      document_id: document.id,
      action: "publish",
      state: "deploy_pending",
      attempt: 0,
      pull_request_number: 17,
      pull_request_url: "https://github.com/Atlasez/Atlasez01/pull/17",
      branch: "editorial/published-cas",
      merge_sha: "merge-sha",
      snapshot_updated_at: document.updated_at,
      snapshot_hash: await articleSnapshotHash(),
      created_by: "editor@example.test",
      created_at: document.updated_at,
      updated_at: document.updated_at,
      failure_history: null,
    };
    const executed: Array<{ query: string; values: unknown[] }> = [];
    const responses: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      responses.push(url);
      if (url.startsWith("https://atlasez.org/build-info.json"))
        return Response.json({ commit: "merge-sha" });
      if (url.startsWith("https://atlasez.org/atlas/"))
        return new Response("published article", { status: 200 });
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const pending: Promise<unknown>[] = [];
    await worker.scheduled(
      { cron: "*/1 * * * *" },
      {
        PUBLIC_SITE_ORIGIN: "https://atlasez.org",
        REPORTS: {
          prepare: (query: string) =>
            new PublicationStatement(query, run, executed),
        },
      } as never,
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) },
    );
    await Promise.all(pending);

    const attemptedDocumentWrite = executed.find((entry) =>
      entry.query.includes("UPDATE editorial_documents"),
    );
    expect(attemptedDocumentWrite?.query).toMatch(
      /WHERE id = \? AND updated_at = \?/,
    );
    expect(attemptedDocumentWrite?.values).toContain(document.updated_at);
    expect(
      executed.some(
        (entry) =>
          entry.query.includes("UPDATE editorial_publication_runs") &&
          entry.values.includes("needs_operator") &&
          entry.values.includes("publication_compare_and_set_failed"),
      ),
    ).toBe(true);
    expect(
      executed.some(
        (entry) =>
          entry.query.includes("UPDATE editorial_publication_runs") &&
          entry.values.includes("published"),
      ),
    ).toBe(false);
    expect(responses).toHaveLength(2);
  });
});
