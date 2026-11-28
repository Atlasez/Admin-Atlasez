import Holidays from "date-holidays";

export const APPLICATION_INTAKE_MAX_UNRESOLVED = 10;
export const APPLICATION_INTAKE_MAX_OLDEST_AGE_BUSINESS_DAYS = 3;
export const APPLICATION_INTAKE_INSERT_SQL = `INSERT INTO atlasez_member_applications
  (id,name,email,affiliation_email,family_name,given_name,middle_name,nickname,family_name_kana,given_name_kana,form_language,interests,message,status,created_at,updated_at,project_slug,project_answers,affiliation_type,institution,grade,country,timezone,desired_subjects,article_ideas,discord_user_id,availability_note,birth_date,residence_city,current_organizations,referral_source,motivation_reasons,desired_roles,interview_availability,applicant_questions)
  SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?, 'new',?,?,?,?,?,?,?,?,?,?,?,'',?,?,?,?,?,?,?,?,?
  WHERE NOT EXISTS (
    SELECT 1 FROM atlasez_member_applications
    WHERE lower(email)=lower(?) AND project_slug=? AND status IN ('new','reviewing')
  )
    AND (SELECT COUNT(*) FROM atlasez_member_applications
         WHERE status IN ('new','reviewing')) < ?`;

export const APPLICANT_PROFILE_UPSERT_SQL = `INSERT INTO atlasez_applicant_profiles
  (email,family_name,given_name,middle_name,nickname,family_name_kana,given_name_kana,form_language,
   affiliation_email,affiliation_type,institution,grade,country,timezone,birth_date,residence_city,
   current_organizations,referral_source,created_at,updated_at)
  SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
  WHERE EXISTS (SELECT 1 FROM atlasez_member_applications WHERE id=?)
  ON CONFLICT(email) DO UPDATE SET
    family_name=excluded.family_name,given_name=excluded.given_name,middle_name=excluded.middle_name,
    nickname=excluded.nickname,
    family_name_kana=excluded.family_name_kana,given_name_kana=excluded.given_name_kana,
    form_language=excluded.form_language,affiliation_type=excluded.affiliation_type,
    affiliation_email=excluded.affiliation_email,
    institution=excluded.institution,grade=excluded.grade,country=excluded.country,
    timezone=excluded.timezone,birth_date=excluded.birth_date,residence_city=excluded.residence_city,
    current_organizations=excluded.current_organizations,referral_source=excluded.referral_source,
    updated_at=excluded.updated_at`;

type PendingApplicationStats = {
  unresolvedCount: number;
  oldestCreatedAt: string | null;
};

export type ApplicationIntakePauseReason =
  "unresolved_limit" | "oldest_unresolved_age" | "invalid_oldest_timestamp";

const dayMs = 24 * 60 * 60 * 1000;
const japanesePublicHolidaysByYear = new Map<number, Set<string>>();
const japanHolidayCalendar = new Holidays("JP", { types: ["public"] });

function jstDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function japanesePublicHolidays(year: number) {
  let dates = japanesePublicHolidaysByYear.get(year);
  if (!dates) {
    dates = new Set(
      japanHolidayCalendar
        .getHolidays(year)
        .filter((holiday) => holiday.type === "public")
        .map((holiday) => holiday.date.slice(0, 10)),
    );
    japanesePublicHolidaysByYear.set(year, dates);
  }
  return dates;
}

export function elapsedJapaneseBusinessDays(
  startedAt: string,
  now = new Date(),
) {
  const started = new Date(startedAt);
  if (
    !Number.isFinite(started.getTime()) ||
    !Number.isFinite(now.getTime()) ||
    started.getTime() > now.getTime()
  )
    return null;

  const startDate = jstDate(started);
  const today = jstDate(now);
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  let cursor = Date.UTC(startYear, startMonth - 1, startDay) + dayMs;
  const end = Date.UTC(todayYear, todayMonth - 1, todayDay);
  let elapsed = 0;

  while (
    cursor <= end &&
    elapsed < APPLICATION_INTAKE_MAX_OLDEST_AGE_BUSINESS_DAYS
  ) {
    const date = new Date(cursor);
    const weekday = date.getUTCDay();
    const year = date.getUTCFullYear();
    const dateKey = date.toISOString().slice(0, 10);
    if (
      weekday !== 0 &&
      weekday !== 6 &&
      !japanesePublicHolidays(year).has(dateKey)
    )
      elapsed += 1;
    cursor += dayMs;
  }
  return elapsed;
}

export function applicationIntakePauseReason(
  stats: PendingApplicationStats,
  now = new Date(),
): ApplicationIntakePauseReason | null {
  if (stats.unresolvedCount >= APPLICATION_INTAKE_MAX_UNRESOLVED)
    return "unresolved_limit";
  if (stats.unresolvedCount <= 0 || !stats.oldestCreatedAt) return null;
  const elapsed = elapsedJapaneseBusinessDays(stats.oldestCreatedAt, now);
  if (elapsed === null) return "invalid_oldest_timestamp";
  if (elapsed >= APPLICATION_INTAKE_MAX_OLDEST_AGE_BUSINESS_DAYS)
    return "oldest_unresolved_age";
  return null;
}

export function applicationIntakePausedMessage(language: string) {
  return language === "en"
    ? "Application intake is temporarily paused. Please check back after the application process resumes."
    : "応募の受付を一時停止しています。受付再開後にあらためてお申し込みください。";
}
