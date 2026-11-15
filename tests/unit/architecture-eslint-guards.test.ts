import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import {
  adminApiAccessBeforeDispatch,
  adminApiPoliciesReachScopes,
  adminApiPolicyFailsClosed,
  publicationCompareAndSet,
} from "../../scripts/eslint-rules/atlasez-architecture.mjs";

const rules = {
  "admin-api-access-before-dispatch": adminApiAccessBeforeDispatch,
  "admin-api-policies-reach-scopes": adminApiPoliciesReachScopes,
  "admin-api-policy-fails-closed": adminApiPolicyFailsClosed,
  "publication-compare-and-set": publicationCompareAndSet,
};

function lintRule(
  source: string,
  ruleName: keyof typeof rules,
  filename: string,
) {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(
    source,
    [
      {
        files: ["**/*.ts"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaVersion: "latest", sourceType: "module" },
        },
        plugins: { atlasez: { rules: rules as never } },
        rules: { [`atlasez/${ruleName}`]: "error" },
      },
    ],
    { filename },
  );
}

describe("Architecture ESLint guards", () => {
  it("admin API dispatch is allowed after the central access policy", () => {
    const valid = `
      async function handleAdminRequest(request, env) {
        const url = new URL(request.url);
        const adminApiAccess = getAdminApiAccessPolicy(url.pathname, request.method);
        const adminApiAccessFailure = await enforceAdminApiAccessPolicy(request, env, adminApiAccess);
        if (adminApiAccessFailure) return adminApiAccessFailure;
        if (url.pathname === "/api/admin/records") return listRecords(request, env);
      }
    `;
    const invalid = `
      async function handleAdminRequest(request, env) {
        const url = new URL(request.url);
        if (url.pathname === "/api/admin/records") return listRecords(request, env);
        const adminApiAccess = getAdminApiAccessPolicy(url.pathname, request.method);
        const adminApiAccessFailure = await enforceAdminApiAccessPolicy(request, env, adminApiAccess);
        if (adminApiAccessFailure) return adminApiAccessFailure;
      }
    `;

    expect(
      lintRule(
        valid,
        "admin-api-access-before-dispatch",
        "src/admin-worker.ts",
      ),
    ).toHaveLength(0);
    expect(
      lintRule(
        invalid,
        "admin-api-access-before-dispatch",
        "src/admin-worker.ts",
      ).map((message) => message.ruleId),
    ).toContain("atlasez/admin-api-access-before-dispatch");
    expect(
      lintRule(
        "const removedHandler = true;",
        "admin-api-access-before-dispatch",
        "src/admin-worker.ts",
      ).map((message) => message.ruleId),
    ).toContain("atlasez/admin-api-access-before-dispatch");
  });

  it("member API allowlists use the intended authentication and membership guards", () => {
    const valid = `
      async function enforceAdminApiAccessPolicy(policy, request, env) {
        let scope = null;
        switch (policy) {
          case "admin": scope = await getAdminScope(request, env); break;
          case "member": scope = await getMemberOperationScope(request, env); break;
          case "profile": scope = await getMemberProfileScope(request, env); break;
          default: return null;
        }
        return scope;
      }
    `;
    const invalid = valid.replace(
      'case "member": scope = await getMemberOperationScope(request, env); break;',
      'case "member": scope = await getAdminScope(request, env); break;',
    );

    expect(
      lintRule(valid, "admin-api-policies-reach-scopes", "src/admin-worker.ts"),
    ).toHaveLength(0);
    expect(
      lintRule(
        invalid,
        "admin-api-policies-reach-scopes",
        "src/admin-worker.ts",
      ).map((message) => message.ruleId),
    ).toContain("atlasez/admin-api-policies-reach-scopes");
    expect(
      lintRule(
        "const removedEnforcement = true;",
        "admin-api-policies-reach-scopes",
        "src/admin-worker.ts",
      ).map((message) => message.ruleId),
    ).toContain("atlasez/admin-api-policies-reach-scopes");
  });

  it("unknown admin endpoints default to admin and member exceptions stay allowlisted", () => {
    const valid = `
      function getAdminApiAccessPolicy(pathname, method) {
        if (pathname !== "/api/admin" && !pathname.startsWith("/api/admin/")) return "none";
        if (isMemberScopedAdminApiMethod(pathname, method)) return "member";
        return "admin";
      }
    `;
    const invalidMember = `
      function getAdminApiAccessPolicy(pathname, method) {
        if (pathname !== "/api/admin" && !pathname.startsWith("/api/admin/")) return "none";
        if (pathname.startsWith("/api/admin/")) return "member";
        return "admin";
      }
    `;
    const invalidDefault = valid.replace('return "admin";', 'return "none";');
    const invalidRoot = valid.replace('pathname !== "/api/admin" && ', "");

    expect(
      lintRule(
        valid,
        "admin-api-policy-fails-closed",
        "src/lib/admin-api-access-policy.ts",
      ),
    ).toHaveLength(0);
    expect(
      lintRule(
        invalidMember,
        "admin-api-policy-fails-closed",
        "src/lib/admin-api-access-policy.ts",
      ).map((message) => message.ruleId),
    ).toContain("atlasez/admin-api-policy-fails-closed");
    expect(
      lintRule(
        invalidDefault,
        "admin-api-policy-fails-closed",
        "src/lib/admin-api-access-policy.ts",
      ).map((message) => message.ruleId),
    ).toContain("atlasez/admin-api-policy-fails-closed");
    expect(
      lintRule(
        invalidRoot,
        "admin-api-policy-fails-closed",
        "src/lib/admin-api-access-policy.ts",
      ).map((message) => message.ruleId),
    ).toContain("atlasez/admin-api-policy-fails-closed");
    expect(
      lintRule(
        "const removedPolicy = true;",
        "admin-api-policy-fails-closed",
        "src/lib/admin-api-access-policy.ts",
      ).map((message) => message.ruleId),
    ).toContain("atlasez/admin-api-policy-fails-closed");
  });

  it("publication document updates compare updated_at and stop on conflicts", () => {
    const valid = `
      async function progressEditorialPublicationRun(run) {
        if (run.state === "deploy_pending") {
          const base = await db.prepare(
            "UPDATE editorial_documents SET published_at=? WHERE id=? AND updated_at=?",
          ).bind(now, document.id, document.updated_at).run();
          const proposal = await db.prepare(
            "UPDATE editorial_documents SET status=? WHERE id=? AND updated_at=?",
          ).bind(status, document.id, document.updated_at).run();
          const canonical = await db.prepare(
            "UPDATE editorial_documents SET body=? WHERE id=? AND updated_at=?",
          ).bind(body, document.id, document.updated_at).run();
          const unpublish = await db.prepare(
            "UPDATE editorial_documents SET published_at=NULL WHERE id=? AND updated_at=?",
          ).bind(document.id, document.updated_at).run();
          if (batchChangeCount([base], 0) !== 1) {
            const errorCode = "publication_compare_and_set_failed";
          }
          if (batchChangeCount([proposal], 0) !== 1) {
            const errorCode = "publication_compare_and_set_failed";
          }
          if (
            batchChangeCount([canonical], 0) !== 1 ||
            batchChangeCount([unpublish], 0) !== 1
          ) {
            const errorCode = "publication_compare_and_set_failed";
          }
        }
      }
    `;
    const invalidCompare = valid.replace(
      "WHERE id=? AND updated_at=?",
      "WHERE id=?",
    );
    const invalidRecovery = valid.replace(
      /publication_compare_and_set_failed/g,
      "publication_failed",
    );

    expect(
      lintRule(valid, "publication-compare-and-set", "src/admin-worker.ts"),
    ).toHaveLength(0);
    expect(
      lintRule(
        invalidCompare,
        "publication-compare-and-set",
        "src/admin-worker.ts",
      ).map((message) => message.ruleId),
    ).toContain("atlasez/publication-compare-and-set");
    expect(
      lintRule(
        invalidRecovery,
        "publication-compare-and-set",
        "src/admin-worker.ts",
      ).map((message) => message.ruleId),
    ).toContain("atlasez/publication-compare-and-set");
    expect(
      lintRule(
        "const removedPublicationProgress = true;",
        "publication-compare-and-set",
        "src/admin-worker.ts",
      ).map((message) => message.ruleId),
    ).toContain("atlasez/publication-compare-and-set");
  });
});
