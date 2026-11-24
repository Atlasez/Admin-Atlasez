import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/admin-worker";

const secret = "editorial-release-secret";
const cloudflareReadToken = "worker-metadata-read-token";
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
    return this.database.all<T>(this.query, this.bindings);
  }
}

class ReleaseDatabase {
  readonly batches: Array<Array<{ query: string; bindings: unknown[] }>> = [];
  readonly queryBindingCounts: number[] = [];
  documentRows: Array<Record<string, unknown>> = [
    {
      id: documentId,
      source_article_id: article.articleId,
      locale: "ja",
      subject: "mathematics",
      category: "set-theory",
      slug: "sets",
      current_version_id: articleVersionId,
      published_version_id: articleVersionId,
    },
  ];
  catalogRows: Array<Record<string, unknown>> = [
    {
      path: article.path,
      identity_key: "ja/mathematics/set-theory/sets",
      repository: "Atlasez/Atlasez01",
      source_article_id: article.articleId,
      document_id: documentId,
    },
  ];
  revisionRows: Array<Record<string, unknown>> = [
    { id: articleVersionId, document_id: documentId },
  ];
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

  async all<T>(query: string, bindings: unknown[] = []) {
    this.queryBindingCounts.push(bindings.length);
    if (bindings.length > 100)
      throw new Error("D1 permits at most 100 bound parameters per query");
    if (query.includes("FROM editorial_article_catalog")) {
      const keys = new Set(bindings.slice(1));
      return {
        results: this.catalogRows.filter(
          (row) => keys.has(row.path) || keys.has(row.identity_key),
        ) as T[],
      };
    }
    if (query.includes("FROM editorial_documents"))
      return { results: this.documentRows as T[] };
    if (query.includes("FROM editorial_document_revisions"))
      return { results: this.revisionRows as T[] };
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
    if (statements.some(({ bindings }) => bindings.length > 100))
      throw new Error("D1 permits at most 100 bound parameters per statement");
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

function candidatePayload(entries = [article]) {
  return {
    repository: "Atlasez/Atlasez01",
    workerName: "atlasez01",
    commitSha,
    versionId,
    manifest: { schemaVersion: 1, commitSha, entries },
  };
}

function currentDeploymentResponse() {
  return Response.json({
    success: true,
    result: {
      deployments: [
        {
          id: "deployment-current",
          versions: [
            {
              version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              percentage: 100,
            },
          ],
        },
      ],
    },
  });
}

function streamingRequest(
  url: string,
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
  const request = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("記事公開候補の永続化と切替復旧", () => {
  it("Content-Lengthのない過大な候補・有効化Webhookを読み切る前に停止する", async () => {
    const cloudflareFetch = vi.fn();
    vi.stubGlobal("fetch", cloudflareFetch);
    for (const path of [
      "/api/internal/editorial-release/candidate",
      "/api/internal/editorial-release/activated",
    ]) {
      const streamed = streamingRequest(
        `https://admin.atlasez.org${path}`,
        250_000,
        10,
      );
      expect(streamed.request.headers.get("content-length")).toBeNull();
      const response = await worker.fetch(streamed.request, {
        REPORTS: new ReleaseDatabase(),
        EDITORIAL_RELEASE_WEBHOOK_SECRET: secret,
        CLOUDFLARE_WORKERS_READ_TOKEN: cloudflareReadToken,
      } as never);

      expect(response.status).toBe(413);
      expect(streamed.cancelled).toBe(true);
      expect(streamed.pulled).toBeLessThan(streamed.totalChunks);
    }
    expect(cloudflareFetch).not.toHaveBeenCalled();
  });

  it("25 MB超過のGitHub WebhookをContent-Lengthなしでも読み切らず停止する", async () => {
    const streamed = streamingRequest(
      "https://admin.atlasez.org/api/internal/github-publication-webhook",
      1_000_000,
      30,
    );
    expect(streamed.request.headers.get("content-length")).toBeNull();
    const response = await worker.fetch(streamed.request, {
      GITHUB_WEBHOOK_SECRET: "github-webhook-secret",
    } as never);

    expect(response.status).toBe(413);
    expect(streamed.cancelled).toBe(true);
    expect(streamed.pulled).toBeLessThan(streamed.totalChunks);
  });

  it("候補に含まれる記事とD1版IDを切替前に一括保存する", async () => {
    const database = new ReleaseDatabase();
    const body = JSON.stringify(candidatePayload());
    const cloudflareFetch = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        currentDeploymentResponse(),
    );
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
        CLOUDFLARE_WORKERS_READ_TOKEN: cloudflareReadToken,
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
    expect(cloudflareFetch).toHaveBeenCalledOnce();
    expect(cloudflareFetch.mock.calls[0][0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/812021e62fa20465950b61be55dfe064/workers/scripts/atlasez01/deployments?per_page=1",
    );
    expect(cloudflareFetch.mock.calls[0][1]).toMatchObject({
      headers: {
        authorization: `Bearer ${cloudflareReadToken}`,
      },
    });
  });

  it("同じarticleIdの別原稿が残っていても公開パスのカタログ紐付けで解決する", async () => {
    const database = new ReleaseDatabase();
    database.catalogRows[0].path =
      "src/content/articles/ja/mathematics/set-theory/sets.md";
    const duplicateDocumentId = "33333333-3333-4333-8333-333333333333";
    const duplicateVersionId = "e3aa94a0-fd78-4d4a-bf88-7284c5cebf57";
    database.documentRows.push({
      id: duplicateDocumentId,
      source_article_id: article.articleId,
      locale: "ja",
      subject: "mathematics",
      category: "abstract-algebra",
      slug: "groups",
      current_version_id: duplicateVersionId,
      published_version_id: duplicateVersionId,
    });
    database.revisionRows.push({
      id: duplicateVersionId,
      document_id: duplicateDocumentId,
    });
    const body = JSON.stringify(candidatePayload());
    vi.stubGlobal("fetch", vi.fn(currentDeploymentResponse));

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
        CLOUDFLARE_WORKERS_READ_TOKEN: cloudflareReadToken,
        GITHUB_REPOSITORY: "Atlasez/Atlasez01",
      } as never,
    );

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    const savedArticle = database.batches
      .flat()
      .find(({ query }) =>
        query.includes("INSERT INTO editorial_release_candidate_articles"),
      );
    expect(savedArticle?.bindings).toContain(documentId);
    expect(savedArticle?.bindings).not.toContain(duplicateDocumentId);
  });

  it("41件を超える記事版をD1の100 bind上限内で候補登録する", async () => {
    const entries = Array.from({ length: 201 }, (_, index) => {
      const sequence = String(index + 1).padStart(12, "0");
      return {
        articleId: `ja-math-set-theory-article-${index + 1}`,
        path: `src/content/articles/jpn/mathematics/set-theory/article-${index + 1}.md`,
        status: "published",
        versionId: `d3aa94a0-fd78-4d4a-bf88-${sequence}`,
      };
    });
    const database = new ReleaseDatabase();
    database.documentRows = entries.map((entry, index) => ({
      id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`,
      source_article_id: entry.articleId,
      locale: "ja",
      subject: "mathematics",
      category: "set-theory",
      slug: `article-${index + 1}`,
      current_version_id: entry.versionId,
      published_version_id: entry.versionId,
    }));
    database.revisionRows = database.documentRows.map((document) => ({
      id: document.current_version_id,
      document_id: document.id,
    }));
    database.catalogRows = entries.map((entry, index) => ({
      path: entry.path,
      identity_key: `ja/mathematics/set-theory/article-${index + 1}`,
      repository: "Atlasez/Atlasez01",
      source_article_id: entry.articleId,
      document_id: database.documentRows[index].id,
    }));
    const body = JSON.stringify(candidatePayload(entries));
    vi.stubGlobal("fetch", vi.fn(currentDeploymentResponse));

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
        CLOUDFLARE_WORKERS_READ_TOKEN: cloudflareReadToken,
        GITHUB_REPOSITORY: "Atlasez/Atlasez01",
      } as never,
    );

    expect(response.status).toBe(200);
    expect(database.queryBindingCounts.every((count) => count <= 100)).toBe(
      true,
    );
    const articleStatements = database.batches
      .flat()
      .filter(({ query }) =>
        query.includes("INSERT INTO editorial_release_candidate_articles"),
      );
    expect(articleStatements).toHaveLength(13);
    expect(
      articleStatements.every(({ bindings }) => bindings.length <= 100),
    ).toBe(true);
    expect(
      articleStatements.reduce(
        (count, statement) => count + statement.bindings.length / 6,
        0,
      ),
    ).toBe(201);
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

  it("読み取りTokenが未設定なら候補をD1へ記録せず配信前に止める", async () => {
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
    expect(response.status, JSON.stringify(responseBody)).toBe(503);
    expect(responseBody.code).toBe("cloudflare_read_token_missing");
    expect(database.batches).toHaveLength(0);
    expect(cloudflareFetch).not.toHaveBeenCalled();
  });

  it("読み取りTokenがCloudflareに拒否された場合も候補登録前に止める", async () => {
    const database = new ReleaseDatabase();
    const body = JSON.stringify(candidatePayload());
    const cloudflareFetch = vi.fn(() =>
      Response.json(
        { success: false, errors: [{ code: 10000 }] },
        { status: 403 },
      ),
    );
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
        CLOUDFLARE_WORKERS_READ_TOKEN: cloudflareReadToken,
        GITHUB_REPOSITORY: "Atlasez/Atlasez01",
      } as never,
    );

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(503);
    expect(responseBody.code).toBe("cloudflare_deployment_lookup_failed");
    expect(database.batches).toHaveLength(0);
    expect(cloudflareFetch).toHaveBeenCalledOnce();
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
