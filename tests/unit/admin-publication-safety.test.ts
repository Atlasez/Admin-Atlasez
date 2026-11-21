import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/admin-worker";

const secret = "editorial-release-secret";
const versionId = "c3aa94a0-fd78-4d4a-bf88-7284c5cebf57";
const articleVersionId = "d3aa94a0-fd78-4d4a-bf88-7284c5cebf57";
const commitSha = "a".repeat(40);
const documentId = "22222222-2222-4222-8222-222222222222";
const article = {
  articleId: "ja-math-set-theory-sets",
  path: "src/content/articles/jpn/mathematics/set-theory/sets.md",
  status: "published",
  versionId: articleVersionId,
};

async function signedHeaders(body: string) {
  const timestamp = String(Date.now());
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    "content-type": "application/json",
    "x-atlasez-release-timestamp": timestamp,
    "x-atlasez-release-signature": `sha256=${hex}`,
  };
}

class ReleaseStatement {
  readonly bindings: unknown[] = [];

  constructor(
    readonly query: string,
    private readonly database: ReleaseDatabase,
  ) {}

  bind(...values: unknown[]) {
    this.bindings.splice(0, this.bindings.length, ...values);
    return this;
  }

  async first<T>() {
    return this.database.first<T>(this.query, this.bindings);
  }

  async all<T>() {
    return this.database.all<T>(this.query);
  }
}

class ReleaseDatabase {
  readonly batches: Array<Array<{ query: string; bindings: unknown[] }>> = [];
  candidateState = "registered";
  historyRecorded = false;
  failNextBatch = false;

  prepare(query: string) {
    return new ReleaseStatement(query, this);
  }

  async first<T>(query: string, _bindings: unknown[]) {
    if (query.includes("FROM editorial_publication_history"))
      return (
        this.historyRecorded
          ? {
              deployment_id: "deployment-1",
              activated_at: "2026-11-21T00:00:00.000Z",
            }
          : null
      ) as T | null;
    if (
      query.includes(
        "SELECT repository, worker_name, commit_sha, manifest_hash",
      )
    )
      return null as T | null;
    if (query.includes("FROM editorial_release_candidates")) {
      if (query.includes("SELECT version_id FROM editorial_release_candidates"))
        return (
          this.candidateState === "registered"
            ? { version_id: versionId }
            : null
        ) as T | null;
      return {
        version_id: versionId,
        repository: "Atlasez/Atlasez01",
        worker_name: "atlasez01",
        commit_sha: commitSha,
        state: this.candidateState,
      } as T;
    }
    return null as T | null;
  }

  async all<T>(query: string) {
    if (query.includes("FROM editorial_documents"))
      return {
        results: [
          {
            id: documentId,
            source_article_id: article.articleId,
            locale: "jpn",
            subject: "mathematics",
            category: "set-theory",
            slug: "sets",
            current_version_id: articleVersionId,
            published_version_id: articleVersionId,
          },
        ] as T[],
      };
    if (query.includes("FROM editorial_document_revisions"))
      return {
        results: [{ id: articleVersionId, document_id: documentId }] as T[],
      };
    if (query.includes("FROM editorial_release_candidate_articles"))
      return {
        results: [
          {
            article_id: article.articleId,
            document_id: null,
            article_version_id: null,
            article_status: "draft",
          },
        ] as T[],
      };
    return { results: [] as T[] };
  }

  async batch(statements: ReleaseStatement[]) {
    this.batches.push(
      statements.map(({ query, bindings }) => ({
        query,
        bindings: [...bindings],
      })),
    );
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw new Error("simulated D1 write failure");
    }
    if (
      statements.some(({ query }) =>
        query.includes("INSERT OR IGNORE INTO editorial_publication_history"),
      )
    ) {
      this.historyRecorded = true;
      this.candidateState = "activated";
    }
    return [];
  }
}

function candidatePayload() {
  return {
    repository: "Atlasez/Atlasez01",
    workerName: "atlasez01",
    commitSha,
    versionId,
    manifest: { schemaVersion: 1, commitSha, entries: [article] },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("記事公開候補の永続化と切替復旧", () => {
  it("候補に含まれる記事とD1版IDを切替前に一括保存する", async () => {
    const database = new ReleaseDatabase();
    const body = JSON.stringify(candidatePayload());
    const cloudflareFetch = vi.fn();
    vi.stubGlobal("fetch", cloudflareFetch);

    const response = await worker.fetch(
      new Request(
        "https://admin.atlasez.org/api/internal/editorial-release/candidate",
        {
          method: "POST",
          headers: await signedHeaders(body),
          body,
        },
      ),
      {
        REPORTS: database,
        EDITORIAL_RELEASE_WEBHOOK_SECRET: secret,
        GITHUB_REPOSITORY: "Atlasez/Atlasez01",
      } as never,
    );

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(responseBody).toMatchObject({ ok: true, versionId });
    const savedStatements = database.batches.flat();
    expect(
      savedStatements.some(
        ({ query, bindings }) =>
          query.includes("INSERT INTO editorial_release_candidates") &&
          bindings.includes(versionId),
      ),
    ).toBe(true);
    expect(
      savedStatements.some(
        ({ query, bindings }) =>
          query.includes("INSERT INTO editorial_release_candidate_articles") &&
          bindings.includes(documentId) &&
          bindings.includes(articleVersionId),
      ),
    ).toBe(true);
    expect(cloudflareFetch).not.toHaveBeenCalled();
  });

  it("nullや配列などの候補JSONを400で拒否する", async () => {
    for (const body of [
      "null",
      "[]",
      JSON.stringify({ ...candidatePayload(), manifest: null }),
    ]) {
      const response = await worker.fetch(
        new Request(
          "https://admin.atlasez.org/api/internal/editorial-release/candidate",
          {
            method: "POST",
            headers: await signedHeaders(body),
            body,
          },
        ),
        {
          REPORTS: new ReleaseDatabase(),
          EDITORIAL_RELEASE_WEBHOOK_SECRET: secret,
        } as never,
      );
      expect(response.status).toBe(400);
    }

    const malformedEntryBody = JSON.stringify({
      ...candidatePayload(),
      manifest: { schemaVersion: 1, commitSha, entries: [null] },
    });
    const malformedEntryResponse = await worker.fetch(
      new Request(
        "https://admin.atlasez.org/api/internal/editorial-release/candidate",
        {
          method: "POST",
          headers: await signedHeaders(malformedEntryBody),
          body: malformedEntryBody,
        },
      ),
      {
        REPORTS: new ReleaseDatabase(),
        EDITORIAL_RELEASE_WEBHOOK_SECRET: secret,
      } as never,
    );
    expect(malformedEntryResponse.status).toBe(400);
  });

  it("D1の公開履歴書き込みが一時失敗してもCronが現行Versionを照合して補修する", async () => {
    const database = new ReleaseDatabase();
    database.failNextBatch = true;
    const deploymentResponse = () =>
      Response.json({
        success: true,
        result: {
          deployments: [
            {
              id: "deployment-1",
              versions: [{ version_id: versionId, percentage: 100 }],
            },
          ],
        },
      });
    vi.stubGlobal("fetch", vi.fn(deploymentResponse));
    const env = {
      REPORTS: database,
      EDITORIAL_RELEASE_WEBHOOK_SECRET: secret,
      CLOUDFLARE_WORKERS_READ_TOKEN: "read-only-token",
    } as never;
    const body = JSON.stringify({ versionId });
    const response = await worker.fetch(
      new Request(
        "https://admin.atlasez.org/api/internal/editorial-release/activated",
        {
          method: "POST",
          headers: await signedHeaders(body),
          body,
        },
      ),
      env,
    );
    expect(response.status).toBe(502);
    expect(database.historyRecorded).toBe(false);

    const pending: Promise<unknown>[] = [];
    await worker.scheduled({ cron: "*/1 * * * *" }, env, {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);

    expect(database.historyRecorded).toBe(true);
    expect(
      database.batches
        .flat()
        .some(
          ({ query, bindings }) =>
            query.includes("UPDATE editorial_documents") &&
            bindings.includes(versionId),
        ),
    ).toBe(true);
  });
});
