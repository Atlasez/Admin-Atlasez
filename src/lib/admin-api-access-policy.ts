export type AdminApiAccessPolicy =
  "none" | "dedicated" | "admin" | "member" | "profile";

const methods = (...values: string[]) => new Set(values);

export const adminOperationTaskPath =
  /^\/api\/admin\/operations\/tasks\/((?:[0-9a-f-]{36}|application-(?:response|recovery)(?::|%3a)[0-9a-f-]{36}))$/i;

// These handlers select a project or reviewer scope from the request and
// enforce it themselves. Replacing that decision with the generic member
// stage check rejects valid project managers and weakens reviewer boundaries.
const routeScopedApiMethods = new Map<string, ReadonlySet<string>>([
  ["/api/admin/project-profile", methods("GET", "PUT")],
  ["/api/admin/my-intake", methods("GET")],
  ["/api/admin/member-intake", methods("GET", "PUT")],
  ["/api/admin/project-introductions", methods("GET")],
  ["/api/admin/project-profile-change-requests", methods("GET")],
  ["/api/admin/profile-change-requests", methods("GET")],
  ["/api/admin/applications", methods("GET")],
  ["/api/admin/developer/diagnostics", methods("GET")],
]);

const routeScopedDynamicApiMethods: ReadonlyArray<{
  path: RegExp;
  methods: ReadonlySet<string>;
}> = [
  {
    path: /^\/api\/admin\/project-profile-change-requests\/[0-9a-f-]{36}$/i,
    methods: methods("PATCH"),
  },
  {
    path: /^\/api\/admin\/profile-change-requests\/[0-9a-f-]{36}$/i,
    methods: methods("PATCH"),
  },
  {
    path: /^\/api\/admin\/applications\/[0-9a-f-]{36}$/i,
    methods: methods("PATCH"),
  },
  {
    path: /^\/api\/admin\/applications\/[0-9a-f-]{36}\/(?:interview|interview-review)$/i,
    methods: methods("GET", "PUT"),
  },
  {
    path: /^\/api\/admin\/applications\/[0-9a-f-]{36}\/(?:interview\/notify|interview\/complete|discord-retry)$/i,
    methods: methods("POST"),
  },
];

const memberScopedApiMethods = new Map<string, ReadonlySet<string>>([
  ["/api/admin/portal", methods("GET")],
  ["/api/admin/task-templates", methods("GET", "POST")],
  ["/api/admin/member-tasks", methods("GET")],
  ["/api/admin/my-access", methods("GET")],
  ["/api/admin/member-calendar", methods("GET")],
  ["/api/admin/notifications/preferences", methods("GET", "PUT")],
  ["/api/admin/notifications/snooze", methods("POST")],
  ["/api/admin/notifications", methods("GET")],
  ["/api/admin/notifications/read", methods("POST")],
  ["/api/admin/operations/tasks", methods("POST")],
  ["/api/admin/operations/availability-blocks", methods("POST")],
  ["/api/admin/operations/availability-rules", methods("POST")],
]);

const memberScopedDynamicApiMethods: ReadonlyArray<{
  path: RegExp;
  methods: ReadonlySet<string>;
}> = [
  {
    path: /^\/api\/admin\/task-workspaces\/[0-9a-f-]{36}$/i,
    methods: methods("GET", "PUT"),
  },
  {
    path: /^\/api\/admin\/task-templates\/[0-9a-f-]{36}$/i,
    methods: methods("PATCH"),
  },
  {
    path: /^\/api\/admin\/task-templates\/[0-9a-f-]{36}\/create$/i,
    methods: methods("POST"),
  },
  {
    path: /^\/api\/admin\/operations\/tasks\/[0-9a-f-]{36}$/i,
    methods: methods("PATCH"),
  },
  {
    path: adminOperationTaskPath,
    methods: methods("PATCH"),
  },
  {
    path: /^\/api\/admin\/operations\/events\/[0-9a-f-]{36}\/availability$/i,
    methods: methods("PUT"),
  },
  {
    path: /^\/api\/admin\/operations\/availability-blocks\/[0-9a-f-]{36}$/i,
    methods: methods("DELETE"),
  },
  {
    path: /^\/api\/admin\/operations\/availability-rules\/[0-9a-f-]{36}$/i,
    methods: methods("DELETE"),
  },
];

function isMemberScopedAdminApiMethod(pathname: string, method: string) {
  return Boolean(
    memberScopedApiMethods.get(pathname)?.has(method) ||
    memberScopedDynamicApiMethods.some(
      (route) => route.path.test(pathname) && route.methods.has(method),
    ),
  );
}

function isRouteScopedAdminApiMethod(pathname: string, method: string) {
  return Boolean(
    routeScopedApiMethods.get(pathname)?.has(method) ||
    routeScopedDynamicApiMethods.some(
      (route) => route.path.test(pathname) && route.methods.has(method),
    ),
  );
}

/**
 * ADMIN API auth is deny-by-default: every unlisted `/api/admin/*` method
 * requires the global admin scope. Narrower policies are exact method
 * allowlists for member APIs, self-profile, developer diagnostics, and routes
 * that apply a request-specific project/reviewer scope in their handler.
 */
export function getAdminApiAccessPolicy(
  pathname: string,
  method: string,
): AdminApiAccessPolicy {
  if (pathname !== "/api/admin" && !pathname.startsWith("/api/admin/"))
    return "none";

  if (pathname === "/api/admin/auth-status" && method === "GET")
    return "dedicated";
  if (pathname === "/api/admin/member-procedures") return "dedicated";
  if (isRouteScopedAdminApiMethod(pathname, method)) return "dedicated";
  if (
    pathname === "/api/admin/profile" &&
    (method === "GET" || method === "PUT")
  )
    return "profile";
  if (isMemberScopedAdminApiMethod(pathname, method)) return "member";

  return "admin";
}
