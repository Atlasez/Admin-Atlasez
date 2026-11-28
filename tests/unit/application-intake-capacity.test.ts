import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APPLICATION_INTAKE_MAX_OLDEST_AGE_BUSINESS_DAYS,
  APPLICATION_INTAKE_MAX_UNRESOLVED,
  applicationIntakePausedMessage,
  applicationIntakePauseReason,
  elapsedJapaneseBusinessDays,
} from "../../src/lib/application-intake-capacity";

describe("application intake capacity", () => {
  it("pauses at ten globally unresolved applications", () => {
    expect(APPLICATION_INTAKE_MAX_UNRESOLVED).toBe(10);
    expect(
      applicationIntakePauseReason({
        unresolvedCount: 9,
        oldestCreatedAt: null,
      }),
    ).toBeNull();
    expect(
      applicationIntakePauseReason({
        unresolvedCount: 10,
        oldestCreatedAt: "2026-11-29T01:00:00.000Z",
      }),
    ).toBe("unresolved_limit");
  });

  it("counts Japan business days after receipt and excludes weekends and public holidays", () => {
    expect(APPLICATION_INTAKE_MAX_OLDEST_AGE_BUSINESS_DAYS).toBe(3);
    const receivedAt = "2026-01-07T01:00:00.000Z";
    expect(
      elapsedJapaneseBusinessDays(receivedAt, new Date("2026-01-11T15:00:00Z")),
    ).toBe(2);
    expect(
      elapsedJapaneseBusinessDays(receivedAt, new Date("2026-01-12T15:00:00Z")),
    ).toBe(3);
    expect(
      applicationIntakePauseReason(
        { unresolvedCount: 1, oldestCreatedAt: receivedAt },
        new Date("2026-01-12T15:00:00Z"),
      ),
    ).toBe("oldest_unresolved_age");
  });

  it("fails closed for an invalid unresolved timestamp and ignores malformed dates when no cases are open", () => {
    expect(
      applicationIntakePauseReason({
        unresolvedCount: 1,
        oldestCreatedAt: "unknown",
      }),
    ).toBe("invalid_oldest_timestamp");
    expect(
      applicationIntakePauseReason({
        unresolvedCount: 0,
        oldestCreatedAt: "unknown",
      }),
    ).toBeNull();
  });

  it("returns a pause message in the applicant's selected language", () => {
    expect(applicationIntakePausedMessage("ja")).toContain("一時停止");
    expect(applicationIntakePausedMessage("en")).toContain(
      "temporarily paused",
    );
  });

  it("checks open status globally in the public and authenticated intake handler", () => {
    const source = readFileSync("src/admin-worker.ts", "utf8");
    expect(source).toContain("applicationIntakePauseReason(");
    expect(source).toContain(
      "FROM atlasez_member_applications WHERE status IN ('new','reviewing')",
    );
    expect(source).toContain("applicationStatements = [applicationInsert]");
    expect(source).toContain("env.REPORTS.batch(applicationStatements)");
  });
});
