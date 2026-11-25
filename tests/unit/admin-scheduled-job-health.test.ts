import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  D1Database,
  D1PreparedStatement,
} from "../../src/lib/admin-database";
import {
  readScheduledJobHealth,
  runObservedScheduledJob,
  scheduledJobDefinitions,
  type ScheduledJobId,
  type ScheduledJobOutcome,
} from "../../src/lib/admin-scheduled-job-health";

const migration = readFileSync(
  new URL(
    "../../migrations/0142_admin_scheduled_job_health.sql",
    import.meta.url,
  ),
  "utf8",
);

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
});

class Statement implements D1PreparedStatement {
  values: SQLInputValue[] = [];

  constructor(
    readonly sql: string,
    readonly sqlite: DatabaseSync,
    readonly beforeRun?: (query: string) => Promise<void>,
  ) {}

  bind(...values: unknown[]) {
    this.values = values as SQLInputValue[];
    return this;
  }

  async run() {
    await this.beforeRun?.(this.sql);
    return {
      meta: {
        changes: Number(
          this.sqlite.prepare(this.sql).run(...this.values).changes,
        ),
      },
    };
  }

  async all<T>() {
    return {
      results: this.sqlite.prepare(this.sql).all(...this.values) as T[],
    };
  }

  async first<T>() {
    return (
      (this.sqlite.prepare(this.sql).get(...this.values) as T | undefined) ??
      null
    );
  }
}

const openDatabase = (
  applyMigration = true,
  beforeRun?: (query: string) => Promise<void>,
) => {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  if (applyMigration) sqlite.exec(migration);
  const db: D1Database = {
    prepare: (query) => new Statement(query, sqlite, beforeRun),
    batch: async <T>(statements: D1PreparedStatement[]) => {
      const results: Array<{ results: T[]; meta?: { changes?: number } }> = [];
      for (const statement of statements)
        results.push({ ...(await statement.run()), results: [] });
      return results;
    },
  };
  return { sqlite, db };
};

const clock = (initial = "2026-11-25T00:00:00.000Z") => {
  let value = Date.parse(initial);
  return {
    now: () => new Date(value),
    advance: (milliseconds: number) => {
      value += milliseconds;
    },
    iso: () => new Date(value).toISOString(),
  };
};

const logger = () => ({ info: vi.fn(), error: vi.fn() });
const jobId: ScheduledJobId = "editorial-release-reconcile";
const jobHealth = async (
  db: D1Database,
  now: Date,
  id: ScheduledJobId = jobId,
) => (await readScheduledJobHealth(db, now)).jobs.find((job) => job.id === id)!;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("scheduled job health storage", () => {
  it("adds a bounded observation table without changing existing business data", async () => {
    const { sqlite, db } = openDatabase(false);
    sqlite.exec(
      "CREATE TABLE existing_business_data (id TEXT PRIMARY KEY, body TEXT);",
    );
    sqlite
      .prepare("INSERT INTO existing_business_data VALUES (?,?)")
      .run("existing", "keep me");
    sqlite.exec(migration);
    sqlite.exec(migration);
    const logs = logger();
    for (const definition of scheduledJobDefinitions)
      await runObservedScheduledJob(db, definition.id, async () => undefined, {
        logger: logs,
      });
    await runObservedScheduledJob(db, jobId, async () => undefined, {
      logger: logs,
    });

    expect(
      sqlite.prepare("SELECT * FROM existing_business_data").get(),
    ).toEqual({ id: "existing", body: "keep me" });
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS total FROM admin_scheduled_job_health")
        .get(),
    ).toEqual({ total: 16 });
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO admin_scheduled_job_health (job_id,current_run_id,last_status,last_started_at,updated_at) VALUES (?,?,?,?,?)",
        )
        .run("arbitrary-job", "run", "running", "2026-11-25", "2026-11-25"),
    ).toThrow();
  });

  it("separates an empty history from an unavailable monitoring table", async () => {
    const empty = openDatabase();
    const missing = openDatabase(false);
    const now = new Date("2026-11-25T00:00:00.000Z");
    const first = await readScheduledJobHealth(empty.db, now);
    const second = await readScheduledJobHealth(missing.db, now);

    expect(first.available).toBe(true);
    expect(second.available).toBe(false);
    for (const result of [first, second]) {
      expect(result.generatedAt).toBe(now.toISOString());
      expect(result.jobs).toHaveLength(16);
      expect(result.jobs.every((job) => job.status === "unknown")).toBe(true);
      expect(result.jobs.every((job) => job.lastSucceededAt === null)).toBe(
        true,
      );
    }
    expect(first.jobs[0].detail).not.toEqual(second.jobs[0].detail);
  });

  it("records success, consecutive failures, and recovery while preserving the original task result", async () => {
    const { db } = openDatabase();
    const time = clock();
    const options = { now: time.now, logger: logger() };
    const result = await runObservedScheduledJob(
      db,
      jobId,
      async () => {
        time.advance(120);
        return { processed: 3 };
      },
      options,
    );
    expect(result).toEqual({ processed: 3 });
    const successfulAt = time.iso();
    expect(await jobHealth(db, time.now())).toMatchObject({
      status: "ok",
      lastSucceededAt: successfulAt,
      lastFailedAt: null,
      lastDurationMs: 120,
      consecutiveFailures: 0,
      lastErrorCode: null,
    });

    const failure = new Error("private upstream details");
    for (let count = 1; count <= 2; count += 1) {
      time.advance(60_000);
      await expect(
        runObservedScheduledJob(
          db,
          jobId,
          async () => {
            time.advance(25);
            throw failure;
          },
          options,
        ),
      ).rejects.toBe(failure);
      expect(await jobHealth(db, time.now())).toMatchObject({
        status: "error",
        lastSucceededAt: successfulAt,
        lastFailedAt: time.iso(),
        lastDurationMs: 25,
        consecutiveFailures: count,
        lastErrorCode: "execution_failed",
      });
    }
    const failedAt = time.iso();
    time.advance(60_000);
    await runObservedScheduledJob(
      db,
      jobId,
      async () => {
        time.advance(10);
      },
      options,
    );
    expect(await jobHealth(db, time.now())).toMatchObject({
      status: "ok",
      lastSucceededAt: time.iso(),
      lastFailedAt: failedAt,
      lastDurationMs: 10,
      consecutiveFailures: 0,
      lastErrorCode: null,
    });
  });

  it("keeps partial failures and skipped work distinct from successful completion", async () => {
    const { db } = openDatabase();
    const time = clock();
    const options = { now: time.now, logger: logger() };
    await runObservedScheduledJob(db, jobId, async () => undefined, options);
    const successfulAt = time.iso();
    time.advance(60_000);
    await runObservedScheduledJob(
      db,
      jobId,
      async (report) => {
        report({ status: "warning", code: "partial_failure" });
        report({ status: "success" });
        report({ status: "skipped", code: "not_configured" });
      },
      options,
    );
    const failedAt = time.iso();
    expect(await jobHealth(db, time.now())).toMatchObject({
      status: "warning",
      lastSucceededAt: successfulAt,
      lastFailedAt: failedAt,
      consecutiveFailures: 1,
      lastErrorCode: "partial_failure",
    });

    time.advance(60_000);
    await runObservedScheduledJob(
      db,
      jobId,
      async (report) => {
        report({ status: "skipped", code: "not_configured" });
        report({ status: "success" });
      },
      options,
    );
    expect(await jobHealth(db, time.now())).toMatchObject({
      status: "warning",
      lastSucceededAt: successfulAt,
      lastFailedAt: failedAt,
      consecutiveFailures: 1,
      lastErrorCode: "not_configured",
    });

    await runObservedScheduledJob(
      db,
      "application-email",
      async (report) => {
        report({ status: "skipped", code: "not_configured" });
      },
      options,
    );
    expect(await jobHealth(db, time.now(), "application-email")).toMatchObject({
      status: "warning",
      lastSucceededAt: null,
      lastFailedAt: null,
      consecutiveFailures: 0,
    });
  });

  it.each(["success", "error"] as const)(
    "keeps the newer %s run metadata while recording overlapping completions",
    async (newerOutcome) => {
      const { db, sqlite } = openDatabase();
      const time = clock();
      const logs = logger();
      const options = { now: time.now, logger: logs };
      const oldStarted = deferred();
      const releaseOld = deferred();
      const oldFailure = new Error("old failure");
      const newerFailure = new Error("newer failure");
      const oldRun = runObservedScheduledJob(
        db,
        jobId,
        async () => {
          oldStarted.resolve();
          await releaseOld.promise;
          if (newerOutcome === "success") throw oldFailure;
          return "old result";
        },
        options,
      );
      // Attach the rejection handler before allowing the older task to finish.
      const oldResult = oldRun.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await oldStarted.promise;
      time.advance(60_000);
      const newer = runObservedScheduledJob(
        db,
        jobId,
        async () => {
          time.advance(15);
          if (newerOutcome === "error") throw newerFailure;
          return "new result";
        },
        options,
      );
      if (newerOutcome === "error")
        await expect(newer).rejects.toBe(newerFailure);
      else await expect(newer).resolves.toBe("new result");
      const expected = await jobHealth(db, time.now());
      const latestRunMetadata = () =>
        sqlite
          .prepare(
            `SELECT current_run_id,last_status,last_started_at,last_finished_at,
               consecutive_failures,last_duration_ms,last_error_code,updated_at
             FROM admin_scheduled_job_health WHERE job_id=?`,
          )
          .get(jobId);
      const expectedRun = latestRunMetadata();
      time.advance(10);
      releaseOld.resolve();
      if (newerOutcome === "success")
        expect(await oldResult).toEqual({ error: oldFailure });
      else expect(await oldResult).toEqual({ value: "old result" });
      expect(latestRunMetadata()).toEqual(expectedRun);
      expect(await jobHealth(db, time.now())).toMatchObject({
        lastStartedAt: expected.lastStartedAt,
        lastFinishedAt: expected.lastFinishedAt,
        lastDurationMs: expected.lastDurationMs,
        lastErrorCode: expected.lastErrorCode,
        consecutiveFailures: expected.consecutiveFailures,
        status: newerOutcome === "success" ? "warning" : "error",
        lastSucceededAt:
          newerOutcome === "success" ? expected.lastSucceededAt : time.iso(),
        lastFailedAt:
          newerOutcome === "success" ? time.iso() : expected.lastFailedAt,
      });
      if (newerOutcome === "success") {
        expect((await jobHealth(db, time.now())).detail).toBe(
          "並行していた処理が、最後の成功より後に失敗しています。",
        );
        const failedAt = time.iso();
        time.advance(60_000);
        await runObservedScheduledJob(
          db,
          jobId,
          async () => undefined,
          options,
        );
        expect(await jobHealth(db, time.now())).toMatchObject({
          status: "ok",
          lastSucceededAt: time.iso(),
          lastFailedAt: failedAt,
          consecutiveFailures: 0,
        });
      }
      const events = [...logs.info.mock.calls, ...logs.error.mock.calls].map(
        ([value]) => JSON.parse(String(value)),
      );
      expect(
        events
          .filter((event) => event.event === "admin_scheduled_job_finished")
          .every((event) => event.observation === "recorded"),
      ).toBe(true);
    },
  );

  it.each(["success", "error"] as const)(
    "keeps the latest %s time when an earlier completion write arrives late",
    async (outcome) => {
      const oldWriteStarted = deferred();
      const releaseOldWrite = deferred();
      let completions = 0;
      const { db } = openDatabase(true, async (query) => {
        if (
          query.includes("UPDATE admin_scheduled_job_health SET") &&
          completions++ === 0
        ) {
          oldWriteStarted.resolve();
          await releaseOldWrite.promise;
        }
      });
      const time = clock();
      const options = { now: time.now, logger: logger() };
      const failure = new Error("original failure");
      const older = runObservedScheduledJob(
        db,
        jobId,
        async () => {
          if (outcome === "error") throw failure;
          return "old";
        },
        options,
      ).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await oldWriteStarted.promise;
      time.advance(60_000);
      const newer = runObservedScheduledJob(
        db,
        jobId,
        async () => {
          time.advance(20);
          if (outcome === "error") throw failure;
          return "new";
        },
        options,
      );
      if (outcome === "error") await expect(newer).rejects.toBe(failure);
      else await expect(newer).resolves.toBe("new");
      const expected = await jobHealth(db, time.now());
      releaseOldWrite.resolve();
      expect(await older).toEqual(
        outcome === "error" ? { error: failure } : { value: "old" },
      );
      expect(await jobHealth(db, time.now())).toEqual(expected);
    },
  );

  it("does not let a delayed older start replace a newer run", async () => {
    const oldWriteStarted = deferred();
    const releaseOldWrite = deferred();
    let starts = 0;
    const { db } = openDatabase(true, async (query) => {
      if (
        query.includes("INSERT INTO admin_scheduled_job_health") &&
        starts++ === 0
      ) {
        oldWriteStarted.resolve();
        await releaseOldWrite.promise;
      }
    });
    const time = clock();
    const options = { now: time.now, logger: logger() };
    const older = runObservedScheduledJob(
      db,
      jobId,
      async () => "old",
      options,
    );
    await oldWriteStarted.promise;
    time.advance(60_000);
    await runObservedScheduledJob(db, jobId, async () => "new", options);
    const expected = await jobHealth(db, time.now());
    releaseOldWrite.resolve();
    await expect(older).resolves.toBe("old");
    expect(await jobHealth(db, time.now())).toEqual(expected);
    expect(
      options.logger.info.mock.calls
        .map(([value]) => JSON.parse(String(value)))
        .some(
          (event) =>
            event.event === "admin_scheduled_job_started" &&
            event.observation === "not_recorded",
        ),
    ).toBe(true);
  });

  it("retains a failed completion without replacing run metadata when its start write failed", async () => {
    let failStart = false;
    const { db, sqlite } = openDatabase(true, async (query) => {
      if (failStart && query.includes("INSERT INTO admin_scheduled_job_health"))
        throw new Error("monitoring start unavailable");
    });
    const time = clock();
    const logs = logger();
    const options = { now: time.now, logger: logs };
    await runObservedScheduledJob(db, jobId, async () => "first", options);
    const expected = await jobHealth(db, time.now());
    failStart = true;
    time.advance(60_000);
    const failure = new Error("original business failure");
    await expect(
      runObservedScheduledJob(
        db,
        jobId,
        async () => {
          throw failure;
        },
        options,
      ),
    ).rejects.toBe(failure);
    expect(await jobHealth(db, time.now())).toMatchObject({
      status: "warning",
      lastStartedAt: expected.lastStartedAt,
      lastFinishedAt: expected.lastFinishedAt,
      lastSucceededAt: expected.lastSucceededAt,
      lastDurationMs: expected.lastDurationMs,
      lastFailedAt: time.iso(),
      consecutiveFailures: 0,
    });
    expect(
      sqlite
        .prepare(
          "SELECT last_status FROM admin_scheduled_job_health WHERE job_id=?",
        )
        .get(jobId),
    ).toEqual({ last_status: "success" });
    expect(
      logs.error.mock.calls.map(([value]) => JSON.parse(String(value))),
    ).toEqual([
      expect.objectContaining({
        event: "admin_scheduled_job_started",
        observation: "unavailable",
      }),
      expect.objectContaining({
        event: "admin_scheduled_job_finished",
        status: "error",
        observation: "recorded",
      }),
    ]);
  });

  it("continues the task when monitoring is unavailable and preserves task exceptions", async () => {
    const { db } = openDatabase(false);
    const time = clock();
    const logs = logger();
    const options = { now: time.now, logger: logs };
    const task = vi.fn(async () => "business result");
    await expect(
      runObservedScheduledJob(db, jobId, task, options),
    ).resolves.toBe("business result");
    expect(task).toHaveBeenCalledOnce();
    const failure = new Error("business failure");
    await expect(
      runObservedScheduledJob(
        db,
        jobId,
        async () => {
          throw failure;
        },
        options,
      ),
    ).rejects.toBe(failure);
    expect((await readScheduledJobHealth(db, time.now())).available).toBe(
      false,
    );
    const events = logs.error.mock.calls.map(([value]) =>
      JSON.parse(String(value)),
    );
    expect(events).toHaveLength(4);
    expect(events.every((event) => event.observation === "unavailable")).toBe(
      true,
    );
    expect(
      events.find((event) => event.status === "success")?.observation,
    ).toBe("unavailable");
  });

  it("does not claim persisted success when the completion write fails", async () => {
    const sensitive = "operator@example.invalid SECRET_DATABASE_ARGUMENT";
    const { db } = openDatabase(true, async (query) => {
      if (query.includes("UPDATE admin_scheduled_job_health SET"))
        throw new Error(sensitive);
    });
    const time = clock();
    const logs = logger();
    await expect(
      runObservedScheduledJob(db, jobId, async () => 42, {
        now: time.now,
        logger: logs,
      }),
    ).resolves.toBe(42);
    expect(await jobHealth(db, time.now())).toMatchObject({
      status: "running",
      lastSucceededAt: null,
    });
    const event = JSON.parse(String(logs.error.mock.calls[0][0]));
    expect(event).toMatchObject({
      status: "success",
      observation: "unavailable",
    });
    expect(JSON.stringify(logs.error.mock.calls)).not.toContain(sensitive);
    time.advance(180_001);
    expect(await jobHealth(db, time.now())).toMatchObject({
      status: "warning",
      lastSucceededAt: null,
    });
  });

  it("warns for stale success and overdue running jobs using each job's own interval", async () => {
    const { db } = openDatabase();
    const time = clock();
    const options = { now: time.now, logger: logger() };
    await runObservedScheduledJob(db, jobId, async () => undefined, options);
    await runObservedScheduledJob(
      db,
      "personal-data-retention",
      async () => undefined,
      options,
    );
    time.advance(180_000);
    expect((await jobHealth(db, time.now())).status).toBe("ok");
    time.advance(1);
    expect((await jobHealth(db, time.now())).status).toBe("warning");
    expect(
      (await jobHealth(db, time.now(), "personal-data-retention")).status,
    ).toBe("ok");
    time.advance(10_800_000 - 180_001);
    expect(
      (await jobHealth(db, time.now(), "personal-data-retention")).status,
    ).toBe("ok");
    time.advance(1);
    expect(
      (await jobHealth(db, time.now(), "personal-data-retention")).status,
    ).toBe("warning");

    const started = deferred();
    const release = deferred();
    const running = runObservedScheduledJob(
      db,
      jobId,
      async () => {
        started.resolve();
        await release.promise;
      },
      options,
    );
    await started.promise;
    expect((await jobHealth(db, time.now())).status).toBe("running");
    time.advance(180_001);
    expect((await jobHealth(db, time.now())).status).toBe("warning");
    release.resolve();
    await running;
  });

  it("stores and logs only fixed error codes, never raw failures or reporter payloads", async () => {
    const { sqlite, db } = openDatabase();
    const time = clock();
    const logs = logger();
    const sensitive = "person@example.invalid SECRET_AUTHORIZATION_TOKEN";
    const failure = new Error(sensitive);
    await expect(
      runObservedScheduledJob(
        db,
        jobId,
        async () => {
          throw failure;
        },
        { now: time.now, logger: logs },
      ),
    ).rejects.toBe(failure);
    time.advance(60_000);
    await runObservedScheduledJob(
      db,
      jobId,
      async (report) => {
        report({
          status: "warning",
          code: sensitive,
          body: sensitive,
        } as unknown as ScheduledJobOutcome);
      },
      { now: time.now, logger: logs },
    );
    const rows = sqlite
      .prepare("SELECT * FROM admin_scheduled_job_health")
      .all();
    expect(JSON.stringify(rows)).not.toContain(sensitive);
    expect(
      JSON.stringify([...logs.info.mock.calls, ...logs.error.mock.calls]),
    ).not.toContain(sensitive);
    expect(await jobHealth(db, time.now())).toMatchObject({
      lastErrorCode: "partial_failure",
      status: "warning",
    });
  });

  it("does not let a broken logging sink change the business result", async () => {
    const { db } = openDatabase();
    const logs = {
      info: () => {
        throw new Error("log sink down");
      },
      error: () => {
        throw new Error("log sink down");
      },
    };
    await expect(
      runObservedScheduledJob(db, jobId, async () => "done", { logger: logs }),
    ).resolves.toBe("done");
    const failure = new Error("original failure");
    await expect(
      runObservedScheduledJob(
        db,
        jobId,
        async () => {
          throw failure;
        },
        { logger: logs },
      ),
    ).rejects.toBe(failure);
  });
});
