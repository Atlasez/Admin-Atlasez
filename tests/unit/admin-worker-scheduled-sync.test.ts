import { describe, expect, it, vi } from "vitest";
import worker from "../../src/admin-worker";

class SyncStatement {
  values: unknown[] = [];

  constructor(
    readonly query: string,
    readonly onRun: (query: string, values: unknown[]) => void,
    readonly backupCheckpoint: string | null = null,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async all<T>() {
    if (this.query.includes("FROM editorial_documents"))
      return {
        results: Array.from({ length: 9 }, (_, index) => ({
          id: `document-${String(index + 1).padStart(2, "0")}`,
          locale: "ja",
          subject: "mathematics",
          category: "overview",
          slug: `article-${index + 1}`,
          published_at: null,
          publication_action: null,
        })) as T[],
      };
    return { results: [] as T[] };
  }

  async first<T>() {
    if (this.query.includes("COUNT(*) AS total"))
      return { total: 9, published: 4 } as T;
    if (
      this.query.includes("FROM admin_worker_sync_checkpoints") &&
      this.values[0] === "published-article-backups"
    )
      return { cursor: this.backupCheckpoint } as T;
    return null as T | null;
  }

  async run() {
    this.onRun(this.query, this.values);
    return { meta: { changes: 1 } };
  }
}

const runScheduled = async (cron: string, env: Record<string, unknown>) => {
  const pending: Promise<unknown>[] = [];
  await worker.scheduled({ cron }, env as never, {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  });
  await Promise.all(pending);
};

const mainTreeUrl = "/git/trees/main";
const articleTreeUrl = "/git/trees/tree-sha?recursive=1";
const backupRoot = () => Response.json({ sha: "tree-sha" });
const checkpoint = (cursor: string | null, complete: boolean) =>
  JSON.stringify({
    version: 1,
    repository: "Atlasez/Atlasez01",
    treeSha: "tree-sha",
    cursor,
    complete,
  });

describe("admin scheduled GitHub syncs", () => {
  it("fails visibly when article backup GitHub credentials are missing", async () => {
    const databaseCalls: string[] = [];
    await expect(
      runScheduled("1-59/2 * * * *", {
        REPORTS: {
          prepare: (query: string) => {
            databaseCalls.push(query);
            return new SyncStatement(query, () => undefined);
          },
        },
      }),
    ).rejects.toThrow("記事バックアップのGitHub認証が設定されていません。");
    expect(databaseCalls).toHaveLength(2);
    expect(
      databaseCalls.every((query) =>
        query.includes("admin_scheduled_job_health"),
      ),
    ).toBe(true);
  });

  it("uses D1 version pointers for publication status without rewriting them from GitHub", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      requests.push(String(input));
      throw new Error(
        "publication status must not be inferred from GitHub source files",
      );
    });
    try {
      await runScheduled("*/2 * * * *", {
        REPORTS: {
          prepare: (query: string) => new SyncStatement(query, () => undefined),
        },
      });

      expect(requests).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("limits published article backup sync to one resumable page", async () => {
    const executed: { query: string; values: unknown[] }[] = [];
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith(mainTreeUrl)) return backupRoot();
      if (url.endsWith(articleTreeUrl))
        return new Response(
          JSON.stringify({
            tree: Array.from({ length: 9 }, (_, index) => ({
              type: "blob",
              path: `src/content/articles/ja/math/overview/article-${index + 1}.md`,
              sha: `sha-${index + 1}`,
            })),
          }),
        );
      return new Response(
        JSON.stringify({
          content: btoa(`# Article\n\nBody`),
          encoding: "base64",
        }),
      );
    });
    try {
      await runScheduled("1-59/2 * * * *", {
        GITHUB_PUBLISH_TOKEN: "test-token",
        REPORTS: {
          prepare: (query: string) =>
            new SyncStatement(query, (statement, values) =>
              executed.push({ query: statement, values }),
            ),
        },
      });

      expect(requests).toHaveLength(10);
      expect(requests[0]).toMatch(/\/git\/trees\/main$/);
      expect(requests[1]).toMatch(/\/git\/trees\/tree-sha\?recursive=1$/);
      expect(requests.some((url) => url.endsWith("/git/blobs/sha-1"))).toBe(
        true,
      );
      expect(
        executed
          .find((entry) =>
            entry.query.includes(
              "INSERT OR IGNORE INTO article_source_backups",
            ),
          )
          ?.values.slice(3, 6),
      ).toEqual(["sha-1", "# Article\n\nBody", "scheduled"]);
      expect(
        executed.find((entry) =>
          entry.query.includes("admin_worker_sync_checkpoints"),
        )?.values,
      ).toEqual([
        "published-article-backups",
        checkpoint("src/content/articles/ja/math/overview/article-8.md", false),
        expect.any(String),
        null,
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    [
      "a non-success response",
      () => new Response("unavailable", { status: 503 }),
    ],
    ["a missing body", () => new Response(JSON.stringify({ sha: "sha-2" }))],
    [
      "an unsupported encoding",
      () =>
        new Response(
          JSON.stringify({ content: btoa("# Article"), encoding: "utf-8" }),
        ),
    ],
    [
      "a rejected request",
      () => {
        throw new Error("simulated provider detail");
      },
    ],
  ])(
    "does not advance the article backup checkpoint after %s",
    async (_failure, makeFailureResponse) => {
      const executed: { query: string; values: unknown[] }[] = [];
      let contentRequests = 0;
      vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith(mainTreeUrl)) return backupRoot();
        if (url.endsWith(articleTreeUrl))
          return new Response(
            JSON.stringify({
              tree: [
                {
                  type: "blob",
                  path: "src/content/articles/ja/math/overview/article-1.md",
                  sha: "sha-1",
                },
                {
                  type: "blob",
                  path: "src/content/articles/ja/math/overview/article-2.md",
                  sha: "sha-2",
                },
              ],
            }),
          );
        contentRequests += 1;
        if (contentRequests === 2) return makeFailureResponse();
        return new Response(
          JSON.stringify({ content: btoa("# Article"), encoding: "base64" }),
        );
      });
      try {
        await expect(
          runScheduled("1-59/2 * * * *", {
            GITHUB_PUBLISH_TOKEN: "test-token",
            REPORTS: {
              prepare: (query: string) =>
                new SyncStatement(query, (statement, values) =>
                  executed.push({ query: statement, values }),
                ),
            },
          }),
        ).rejects.toThrow("checkpointは進めていません");

        expect(
          executed.filter((entry) =>
            entry.query.includes(
              "INSERT OR IGNORE INTO article_source_backups",
            ),
          ),
        ).toHaveLength(1);
        expect(
          executed.some((entry) =>
            entry.query.includes("admin_worker_sync_checkpoints"),
          ),
        ).toBe(false);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("backs up an empty article blob instead of treating it as missing", async () => {
    const executed: { query: string; values: unknown[] }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(mainTreeUrl)) return backupRoot();
      if (url.endsWith(articleTreeUrl))
        return new Response(
          JSON.stringify({
            tree: [
              {
                type: "blob",
                path: "src/content/articles/ja/math/overview/empty.md",
                sha: "empty-sha",
              },
            ],
          }),
        );
      return new Response(JSON.stringify({ content: "", encoding: "base64" }));
    });
    try {
      await runScheduled("1-59/2 * * * *", {
        GITHUB_PUBLISH_TOKEN: "test-token",
        REPORTS: {
          prepare: (query: string) =>
            new SyncStatement(query, (statement, values) =>
              executed.push({ query: statement, values }),
            ),
        },
      });

      expect(
        executed
          .find((entry) =>
            entry.query.includes(
              "INSERT OR IGNORE INTO article_source_backups",
            ),
          )
          ?.values.slice(3, 6),
      ).toEqual(["empty-sha", "", "scheduled"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("checks only the root when the saved tree is complete and unchanged", async () => {
    const fetcher = vi.fn(async () => backupRoot());
    vi.stubGlobal("fetch", fetcher);
    try {
      await runScheduled("1-59/2 * * * *", {
        GITHUB_PUBLISH_TOKEN: "test-token",
        REPORTS: {
          prepare: (query: string) =>
            new SyncStatement(query, () => undefined, checkpoint(null, true)),
        },
      });
      expect(fetcher).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(/\/git\/trees\/main$/),
        expect.any(Object),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resumes the pinned tree without reading main or backing up earlier paths", async () => {
    const articlePath = "src/content/articles/ja/math/overview/";
    const writes: unknown[][] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith(articleTreeUrl)
        ? Response.json({
            tree: [1, 2].map((number) => ({
              type: "blob",
              path: `${articlePath}article-${number}.md`,
              sha: `blob-${number}`,
            })),
          })
        : Response.json({ content: btoa("# Article"), encoding: "base64" }),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      await runScheduled("1-59/2 * * * *", {
        GITHUB_PUBLISH_TOKEN: "test-token",
        REPORTS: {
          prepare: (query: string) =>
            new SyncStatement(
              query,
              (sql, values) => {
                if (sql.includes("admin_worker_sync_checkpoints"))
                  writes.push(values);
              },
              checkpoint(`${articlePath}article-1.md`, false),
            ),
        },
      });
      expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
        expect.stringContaining(articleTreeUrl),
        expect.stringMatching(/\/git\/blobs\/blob-2$/),
      ]);
      expect(writes).toEqual([
        [
          "published-article-backups",
          checkpoint(null, true),
          expect.any(String),
          checkpoint(`${articlePath}article-1.md`, false),
        ],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not mark a truncated tree as backed up", async () => {
    const written: string[] = [];
    const fetcher = vi
      .fn()
      .mockImplementationOnce(backupRoot)
      .mockResolvedValueOnce(Response.json({ tree: [], truncated: true }));
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(
        runScheduled("1-59/2 * * * *", {
          GITHUB_PUBLISH_TOKEN: "test-token",
          REPORTS: {
            prepare: (query: string) =>
              new SyncStatement(query, (sql) => written.push(sql)),
          },
        }),
      ).rejects.toThrow("バックアップ対象一覧が不完全");
      expect(
        written.some((sql) => sql.includes("admin_worker_sync_checkpoints")),
      ).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
