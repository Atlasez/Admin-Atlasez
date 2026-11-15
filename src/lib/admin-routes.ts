export const SEMINAR_REVIEW_PATH = "/admin/semi-platform/review/";

export const isSeminarReviewPath = (pathname: string) =>
  pathname === SEMINAR_REVIEW_PATH ||
  pathname === SEMINAR_REVIEW_PATH.slice(0, -1);

export type AdminNavSite =
  | "portal"
  | "atlas"
  | "semi-platform"
  | "student-council"
  | "thinking-cafe"
  | "secretariat";

export type AdminNavRouteState = {
  site: AdminNavSite;
  slug: string;
  current: string;
  home: string;
  label: string;
};

export const ADMIN_NAV_PAGE_LABELS: Record<string, string> = {
  "getting-started": "参加後の案内",
  portal: "Atlasezメンバー用サイト",
  "action-center": "アクションセンター",
  notifications: "通知",
  atlas: "学習サイトトップ",
  "semi-platform": "ゼミプラットフォーム",
  "seminar-review": "ゼミ企画審査",
  "student-council": "日本生徒会協会トップ",
  "thinking-cafe": "考えるカフェトップ",
  secretariat: "運営事務局トップ",
  editor: "記事編集",
  articles: "編集・フィードバック",
  workspace: "担当・自己紹介",
  "member-profile": "プロフィール",
  "member-profile-edit": "プロフィール編集",
  "member-tasks": "自分の担当タスク",
  "task-detail": "タスク詳細・引き継ぎ",
  "task-templates": "タスクテンプレート",
  "member-calendar": "自分の予定",
  "profile-requests": "メンバー情報の承認",
  "project-profile-requests": "運営内自己紹介の承認",
  operations: "運営タスク",
  progress: "進捗報告",
  calendar: "運営カレンダー",
  genres: "各ジャンル概要",
  review: "フィードバック一覧",
  reports: "問題報告",
  analytics: "学習サイト閲覧統計",
  permissions: "権限管理",
  guide: "作業の進め方",
  rules: "規則",
  onboarding: "初回案内",
  "onboarding-demo": "オンボーディング紹介",
  applications: "運営参加応募",
  "application-interview": "応募者対応",
  introductions: "運営内自己紹介",
  "co-working": "同時作業会",
  management: "管理トップ",
  procedures: "諸手続き",
  "member-management": "運営メンバー管理",
  "genre-roles": "ジャンル・役割管理",
  "operations-statistics": "運営メンバー統計",
  "publication-runs": "公開処理の状況",
  "update-history": "アップデート履歴",
  "audit-log": "操作履歴",
  developer: "開発者モード",
  workflow: "状態遷移・整合性",
};

const siteForProject = (project: string | null): AdminNavSite =>
  project === "secretariat"
    ? "secretariat"
    : project === "seminar-platform"
      ? "semi-platform"
      : project === "student-council-exchange"
        ? "student-council"
        : project === "thinking-cafe"
          ? "thinking-cafe"
          : project === "portal"
            ? "portal"
            : "atlas";

const slugForSite = (site: AdminNavSite) =>
  site === "secretariat"
    ? "secretariat"
    : site === "semi-platform"
      ? "seminar-platform"
      : site === "student-council"
        ? "student-council-exchange"
        : site === "thinking-cafe"
          ? "thinking-cafe"
          : "atlas";

const homeForSite = (site: AdminNavSite) =>
  site === "portal"
    ? "/admin/portal/"
    : site === "secretariat"
      ? "/admin/secretariat/"
      : site === "semi-platform"
        ? "/admin/semi-platform/"
        : site === "student-council"
          ? "/admin/student-council/"
          : site === "thinking-cafe"
            ? "/admin/thinking-cafe/"
            : "/admin/atlas/";

const labelForSite = (site: AdminNavSite) =>
  site === "portal"
    ? "Atlasezメンバー用サイト"
    : site === "secretariat"
      ? "Atlasez運営事務局"
      : site === "semi-platform"
        ? "ゼミプラットフォーム"
        : site === "student-council"
          ? "日本生徒会協会"
          : site === "thinking-cafe"
            ? "考えるカフェ"
            : "学習サイト「アトラス」運営用サイト";

const portalRoutes = new Set([
  "/admin/getting-started",
  "/admin/portal",
  "/admin/portal-prototype",
  "/admin/action-center",
  "/admin/notifications",
  "/admin/member-profile",
  "/admin/member-profile/edit",
  "/admin/member-tasks",
  "/admin/task-detail",
  "/admin/task-templates",
  "/admin/member-calendar",
]);

const currentForPath = (path: string) => {
  if (isSeminarReviewPath(path)) return "seminar-review";
  if (path === "/admin/member-profile/edit") return "member-profile-edit";
  if (
    [
      "/admin/member-tasks",
      "/admin/task-detail",
      "/admin/task-templates",
    ].includes(path)
  )
    return "member-tasks";
  const fixedPaths: Record<string, string> = {
    "/admin/getting-started": "getting-started",
    "/admin/portal": "portal",
    "/admin/portal-prototype": "portal",
    "/admin/action-center": "action-center",
    "/admin/notifications": "notifications",
    "/admin/atlas": "atlas",
    "/admin/secretariat": "secretariat",
    "/admin/semi-platform": "semi-platform",
    "/admin/student-council": "student-council",
    "/admin/thinking-cafe": "thinking-cafe",
    "/admin/articles": "articles",
    "/admin/editor": "editor",
    "/admin/workspace": "workspace",
    "/admin/member-profile": "member-profile",
    "/admin/genres": "genres",
    "/admin/manage": "management",
    "/admin/procedures": "procedures",
    "/admin/member-management": "member-management",
    "/admin/genre-roles": "genre-roles",
    "/admin/operations-statistics": "operations-statistics",
    "/admin/publication-runs": "publication-runs",
    "/admin/calendar": "calendar",
    "/admin/operations": "operations",
    "/admin/progress": "progress",
    "/admin/co-working": "co-working",
    "/admin/review": "review",
    "/admin/reports": "reports",
    "/admin/analytics": "analytics",
    "/admin/permissions": "permissions",
    "/admin/guide": "guide",
    "/admin/update-history": "update-history",
    "/admin/audit-log": "audit-log",
    "/admin/rules": "rules",
    "/admin/onboarding-demo": "onboarding-demo",
    "/admin/applications": "applications",
    "/admin/application-interview": "application-interview",
    "/admin/introductions": "introductions",
    "/admin/member-calendar": "member-calendar",
    "/admin/profile-requests": "profile-requests",
    "/admin/project-profile-requests": "project-profile-requests",
    "/admin/developer": "developer",
    "/admin/workflow": "workflow",
  };
  return fixedPaths[path] ?? (path.slice("/admin/".length) || "atlas");
};

/** Shared route metadata for the server-rendered and transitioned admin navigation. */
export function resolveAdminNavRoute(
  pathname: string,
  requestedProject: string | null = null,
): AdminNavRouteState {
  const path = pathname.replace(/\/$/, "") || "/";
  const validOperationProjects = new Set([
    "secretariat",
    "seminar-platform",
    "student-council-exchange",
    "thinking-cafe",
  ]);
  const operationProject = validOperationProjects.has(requestedProject ?? "")
    ? requestedProject
    : "atlas";
  const querySite = siteForProject(requestedProject);
  const site: AdminNavSite = portalRoutes.has(path)
    ? "portal"
    : path === "/admin/profile-requests" || path === "/admin/secretariat"
      ? "secretariat"
      : path === "/admin/semi-platform" || isSeminarReviewPath(path)
        ? "semi-platform"
        : path === "/admin/student-council"
          ? "student-council"
          : path === "/admin/thinking-cafe"
            ? "thinking-cafe"
            : [
                  "/admin/operations",
                  "/admin/progress",
                  "/admin/calendar",
                  "/admin/co-working",
                ].includes(path)
              ? siteForProject(operationProject)
              : querySite;
  const current = currentForPath(path);
  return {
    site,
    slug: slugForSite(site),
    current,
    home: homeForSite(site),
    label: labelForSite(site),
  };
}

const adminPageNames = [
  "workspace",
  "member-profile",
  "member-tasks",
  "task-detail",
  "task-templates",
  "member-calendar",
  "portal",
  "getting-started",
  "action-center",
  "notifications",
  "atlas",
  "semi-platform",
  "applications",
  "application-interview",
  "articles",
  "operations",
  "progress",
  "calendar",
  "genres",
  "manage",
  "workflow",
  "review",
  "reports",
  "analytics",
  "editor",
  "guide",
  "rules",
  "introductions",
  "procedures",
  "profile-requests",
  "project-profile-requests",
  "publication-runs",
  "secretariat",
  "co-working",
  "permissions",
  "member-management",
  "genre-roles",
  "operations-statistics",
  "developer",
  "audit-log",
  "update-history",
  "onboarding-demo",
  "ui-prototype",
  "portal-prototype",
  "student-council",
  "thinking-cafe",
] as const;

export const ADMIN_PAGE_PATHS = adminPageNames.map(
  (name) => `/admin/${name}` as const,
);

const adminPagePathSet = new Set(
  ADMIN_PAGE_PATHS.flatMap((path) => [path, `${path}/`]),
);

const uiPrototypeNames = [
  "welcome-screens",
  "welcome-login",
  "welcome-not-found",
  "welcome-auth-error",
  "welcome-server-error",
  "welcome-logged-out",
  "welcome-operations-error",
] as const;

/** Nested UI prototypes. Full global admins only; not a top-level nav item. */
export const globalAdminPrototypePaths = uiPrototypeNames.flatMap((name) => {
  const path = `/admin/ui-prototype/${name}`;
  return [path, `${path}/`];
});

// Nested pages stay out of the top-level navigation list while still passing
// through the admin Worker page gate.
const adminNestedPagePathSet = new Set([
  "/admin/member-profile/edit",
  "/admin/member-profile/edit/",
  ...globalAdminPrototypePaths,
]);

export const isAdminPagePath = (pathname: string) =>
  adminPagePathSet.has(pathname) ||
  adminNestedPagePathSet.has(pathname) ||
  isSeminarReviewPath(pathname);
