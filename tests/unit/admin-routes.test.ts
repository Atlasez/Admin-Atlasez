import { describe, expect, it } from "vitest";
import {
  ADMIN_PAGE_PATHS,
  globalAdminPrototypePaths,
  isAdminPagePath,
  resolveAdminNavRoute,
} from "../../src/lib/admin-routes";

describe("admin page routes", () => {
  it("exposes every generated admin page through the Worker", () => {
    expect(ADMIN_PAGE_PATHS).toHaveLength(46);
    expect(isAdminPagePath("/admin/getting-started/")).toBe(true);
    expect(isAdminPagePath("/admin/getting-started")).toBe(true);
    expect(isAdminPagePath("/admin/task-detail/")).toBe(true);
    expect(isAdminPagePath("/admin/task-templates/")).toBe(true);
    expect(isAdminPagePath("/admin/portal-prototype/")).toBe(true);
    expect(ADMIN_PAGE_PATHS).toContain("/admin/portal-prototype");

    for (const path of ADMIN_PAGE_PATHS) {
      expect(isAdminPagePath(path)).toBe(true);
      expect(isAdminPagePath(`${path}/`)).toBe(true);
    }
  });

  it("does not expose unrelated paths as admin pages", () => {
    expect(isAdminPagePath("/admin/unknown")).toBe(false);
    expect(isAdminPagePath("/atlas/ja/")).toBe(false);
  });

  it("exposes the nested member profile editor without adding it to top-level navigation", () => {
    expect(isAdminPagePath("/admin/member-profile/edit")).toBe(true);
    expect(isAdminPagePath("/admin/member-profile/edit/")).toBe(true);
    expect(ADMIN_PAGE_PATHS).not.toContain("/admin/member-profile/edit");
  });

  it("exposes the member notification inbox as a top-level admin route", () => {
    expect(isAdminPagePath("/admin/notifications")).toBe(true);
    expect(isAdminPagePath("/admin/notifications/")).toBe(true);
    expect(ADMIN_PAGE_PATHS).toContain("/admin/notifications");
  });

  it("does not expose removed editor prototypes but keeps active prototypes", () => {
    expect(isAdminPagePath("/admin/editor/outline")).toBe(false);
    expect(isAdminPagePath("/admin/editor/outline/")).toBe(false);
    expect(isAdminPagePath("/admin/ui-prototype/editor-toolbar/")).toBe(false);
    expect(isAdminPagePath("/admin/ui-prototype/editor-header-codex/")).toBe(
      false,
    );
    expect(isAdminPagePath("/admin/ui-prototype/welcome-login/")).toBe(true);
    expect(ADMIN_PAGE_PATHS).not.toContain("/admin/editor/outline");
  });

  it("does not expose the removed learning content prototype", () => {
    expect(isAdminPagePath("/admin/ui-prototype/learning-content")).toBe(false);
    expect(isAdminPagePath("/admin/ui-prototype/learning-content/")).toBe(
      false,
    );
    expect(ADMIN_PAGE_PATHS).not.toContain(
      "/admin/ui-prototype/learning-content",
    );
  });

  it("keeps welcome-screen prototypes out of top-level navigation", () => {
    expect(isAdminPagePath("/admin/ui-prototype/welcome-login/")).toBe(true);
    expect(isAdminPagePath("/admin/ui-prototype/welcome-not-found")).toBe(true);
    expect(globalAdminPrototypePaths).toContain(
      "/admin/ui-prototype/welcome-operations-error/",
    );
    expect(ADMIN_PAGE_PATHS).not.toContain("/admin/ui-prototype/welcome-login");
  });

  it("uses the same project and page state for server and client navigation", () => {
    expect(
      resolveAdminNavRoute("/admin/calendar/", "seminar-platform"),
    ).toEqual({
      site: "semi-platform",
      slug: "seminar-platform",
      current: "calendar",
      home: "/admin/semi-platform/",
      label: "ゼミプラットフォーム",
    });
    expect(resolveAdminNavRoute("/admin/profile-requests/", "atlas")).toEqual({
      site: "secretariat",
      slug: "secretariat",
      current: "profile-requests",
      home: "/admin/secretariat/",
      label: "Atlasez運営事務局",
    });
    expect(resolveAdminNavRoute("/admin/member-profile/edit/")).toEqual({
      site: "portal",
      slug: "atlas",
      current: "member-profile-edit",
      home: "/admin/portal/",
      label: "Atlasezメンバー用サイト",
    });
  });
});
