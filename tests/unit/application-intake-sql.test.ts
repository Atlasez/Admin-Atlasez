import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  APPLICANT_PROFILE_UPSERT_SQL,
  APPLICATION_INTAKE_INSERT_SQL,
  APPLICATION_INTAKE_MAX_UNRESOLVED,
} from "../../src/lib/application-intake-capacity";

const createApplicationDatabase = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE atlasez_member_applications (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, affiliation_email TEXT,
      family_name TEXT, given_name TEXT, middle_name TEXT, nickname TEXT,
      family_name_kana TEXT, given_name_kana TEXT, form_language TEXT,
      interests TEXT, message TEXT, status TEXT, created_at TEXT, updated_at TEXT,
      project_slug TEXT, project_answers TEXT, affiliation_type TEXT, institution TEXT,
      grade TEXT, country TEXT, timezone TEXT, desired_subjects TEXT, article_ideas TEXT,
      discord_user_id TEXT, availability_note TEXT, birth_date TEXT, residence_city TEXT,
      current_organizations TEXT, referral_source TEXT, motivation_reasons TEXT,
      desired_roles TEXT, interview_availability TEXT, applicant_questions TEXT
    );
  `);
  return db;
};

const insertApplication = (
  db: DatabaseSync,
  id: number,
  email = `member-${id}@example.invalid`,
  project = "atlas",
) => {
  const values = [
    `application-${id}`,
    `Member ${id}`,
    email,
    "school@example.invalid",
    "Family",
    "Given",
    "",
    "",
    "family-kana",
    "given-kana",
    "ja",
    "interest",
    "message",
    "2026-11-29T00:00:00.000Z",
    "2026-11-29T00:00:00.000Z",
    project,
    "{}",
    "student",
    "Example School",
    "year-1",
    "JP",
    "Asia/Tokyo",
    "",
    "article idea",
    "availability",
    "2000-01-01",
    "Tokyo",
    "",
    "referral",
    "motivation",
    "role",
    "weekday evening",
    "question",
    email,
    project,
    APPLICATION_INTAKE_MAX_UNRESOLVED,
  ];
  return db.prepare(APPLICATION_INTAKE_INSERT_SQL).run(...values);
};

describe("application intake SQL", () => {
  it("suppresses duplicate active applications and atomically caps all projects at ten", () => {
    const db = createApplicationDatabase();
    try {
      expect(insertApplication(db, 1, "same@example.invalid").changes).toBe(1);
      expect(insertApplication(db, 2, "same@example.invalid").changes).toBe(0);

      for (let id = 2; id < APPLICATION_INTAKE_MAX_UNRESOLVED; id++)
        expect(insertApplication(db, id).changes).toBe(1);
      expect(
        insertApplication(db, 10, "tenth@example.invalid", "other-project")
          .changes,
      ).toBe(1);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM atlasez_member_applications WHERE status IN ('new','reviewing')",
          )
          .get()?.count,
      ).toBe(10);
      expect(
        insertApplication(db, 11, "eleventh@example.invalid", "other-project")
          .changes,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  it("upserts a profile only when its application exists", () => {
    const db = createApplicationDatabase();
    db.exec(`
      CREATE TABLE atlasez_applicant_profiles (
        email TEXT PRIMARY KEY, family_name TEXT, given_name TEXT, middle_name TEXT,
        nickname TEXT, family_name_kana TEXT, given_name_kana TEXT, form_language TEXT,
        affiliation_email TEXT, affiliation_type TEXT, institution TEXT, grade TEXT,
        country TEXT, timezone TEXT, birth_date TEXT, residence_city TEXT,
        current_organizations TEXT, referral_source TEXT, created_at TEXT, updated_at TEXT
      );
      INSERT INTO atlasez_member_applications (id) VALUES ('application-1');
    `);
    const upsert = (applicationId: string) => {
      const values = [
        "member@example.invalid",
        "Family",
        "Given",
        "",
        "",
        "family-kana",
        "given-kana",
        "ja",
        "school@example.invalid",
        "student",
        "Example School",
        "year-1",
        "JP",
        "Asia/Tokyo",
        "2000-01-01",
        "Tokyo",
        "",
        "referral",
        "2026-11-29T00:00:00.000Z",
        "2026-11-29T00:00:00.000Z",
        applicationId,
      ];
      return db.prepare(APPLICANT_PROFILE_UPSERT_SQL).run(...values);
    };
    try {
      expect(upsert("missing-application").changes).toBe(0);
      expect(
        db
          .prepare("SELECT COUNT(*) AS count FROM atlasez_applicant_profiles")
          .get()?.count,
      ).toBe(0);
      expect(upsert("application-1").changes).toBe(1);
      expect(upsert("application-1").changes).toBe(1);
      expect(
        db
          .prepare("SELECT COUNT(*) AS count FROM atlasez_applicant_profiles")
          .get()?.count,
      ).toBe(1);
    } finally {
      db.close();
    }
  });
});
