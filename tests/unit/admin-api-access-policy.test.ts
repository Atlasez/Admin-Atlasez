import { describe, expect, it } from "vitest";
import { getAdminApiAccessPolicy } from "../../src/lib/admin-api-access-policy";

const applicationId = "11111111-1111-4111-8111-111111111111";

describe("管理APIのアクセス方針", () => {
  it("管理API以外をこのゲートの対象にしない", () => {
    expect(getAdminApiAccessPolicy("/api/public/applications", "POST")).toBe(
      "none",
    );
    expect(getAdminApiAccessPolicy("/admin/portal/", "GET")).toBe("none");
  });

  it("専用スコープの例外は指定したパスとメソッドに限る", () => {
    expect(getAdminApiAccessPolicy("/api/admin/auth-status", "GET")).toBe(
      "dedicated",
    );
    expect(
      getAdminApiAccessPolicy("/api/admin/member-procedures", "POST"),
    ).toBe("dedicated");
    expect(getAdminApiAccessPolicy("/api/admin/auth-status", "POST")).toBe(
      "admin",
    );
  });

  it("プロフィール・開発者用APIの専用境界をメソッド単位で分ける", () => {
    expect(getAdminApiAccessPolicy("/api/admin/profile", "GET")).toBe(
      "profile",
    );
    expect(getAdminApiAccessPolicy("/api/admin/profile", "PUT")).toBe(
      "profile",
    );
    expect(getAdminApiAccessPolicy("/api/admin/profile", "DELETE")).toBe(
      "admin",
    );
    expect(
      getAdminApiAccessPolicy("/api/admin/developer/diagnostics", "GET"),
    ).toBe("dedicated");
    expect(
      getAdminApiAccessPolicy("/api/admin/developer/diagnostics", "POST"),
    ).toBe("admin");
  });

  it("応募APIはhandler側のスコープへ委譲し、ルート形式を限定する", () => {
    expect(getAdminApiAccessPolicy("/api/admin/applications", "GET")).toBe(
      "dedicated",
    );
    expect(
      getAdminApiAccessPolicy(
        `/api/admin/applications/${applicationId}`,
        "PATCH",
      ),
    ).toBe("dedicated");
    expect(
      getAdminApiAccessPolicy(
        `/api/admin/applications/${applicationId}/extra`,
        "GET",
      ),
    ).toBe("admin");
    expect(
      getAdminApiAccessPolicy("/api/admin/applications/not-a-uuid", "PATCH"),
    ).toBe("admin");
    expect(getAdminApiAccessPolicy("/api/admin/applications", "POST")).toBe(
      "admin",
    );
  });

  it("プロジェクト責任者・審査者のスコープをhandler側で決めるAPIを区別する", () => {
    expect(getAdminApiAccessPolicy("/api/admin/member-intake", "GET")).toBe(
      "dedicated",
    );
    expect(
      getAdminApiAccessPolicy(
        `/api/admin/project-profile-change-requests/${applicationId}`,
        "PATCH",
      ),
    ).toBe("dedicated");
    expect(getAdminApiAccessPolicy("/api/admin/member-intake", "DELETE")).toBe(
      "admin",
    );
  });

  it("未登録の管理APIとメソッドは管理者スコープへ倒す", () => {
    expect(getAdminApiAccessPolicy("/api/admin/future-write", "GET")).toBe(
      "admin",
    );
    expect(
      getAdminApiAccessPolicy("/api/admin/operations/tasks", "DELETE"),
    ).toBe("admin");
    expect(getAdminApiAccessPolicy("/api/admin", "GET")).toBe("admin");
  });

  it("固定seedで未知の管理APIのfail-closed性を反復確認する", () => {
    const seed = 0x0a71a5;
    let random = seed;
    const next = () => {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      return random >>> 0;
    };
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

    for (let index = 0; index < 256; index += 1) {
      const path = `/api/admin/agent-fuzz-${next().toString(16)}-${index}`;
      const method = methods[next() % methods.length];
      expect(
        getAdminApiAccessPolicy(path, method),
        `seed=0x${seed.toString(16)} case=${index} ${method} ${path}`,
      ).toBe("admin");
    }
  });
});
