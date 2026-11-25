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

  it("publication records candidates before moving the version pointer", () => {
    const valid = `
      async function progressEditorialPublicationRun(run) {
        if (run.state === "deploy_pending") {
          return await waitForEditorialReleaseCandidate(run);
        }
      }
      async function registerEditorialReleaseCandidate(env) {
        await env.REPORTS.batch([
          env.REPORTS.prepare("INSERT INTO editorial_release_candidates VALUES (?)"),
          env.REPORTS.prepare("INSERT INTO editorial_release_candidate_articles VALUES (?)"),
        ]);
      }
      async function activateEditorialReleaseCandidate(env, versionId) {
        const deployment = await getCurrentEditorialWorkerDeployment(env);
        const versions = deployment?.versions ?? [];
        if (!deployment || versions.length !== 1 || versions[0]?.version_id !== versionId || versions[0]?.percentage !== 100) return;
        const statements = [
          env.REPORTS.prepare("INSERT OR IGNORE INTO editorial_publication_history VALUES (?)"),
          env.REPORTS.prepare("UPDATE editorial_documents SET published_version_id = ?"),
        ];
        await env.REPORTS.batch(statements);
      }
    `;
    const invalidVersionCheck = valid.replace(
      "versions[0]?.percentage !== 100",
      "versions[0]?.percentage !== 50",
    );
    const invalidCandidateContents = valid.replace(
      'env.REPORTS.prepare("INSERT INTO editorial_release_candidate_articles VALUES (?)"),',
      "",
    );
    const invalidPointerMutation = valid.replace(
      'env.REPORTS.prepare("UPDATE editorial_documents SET published_version_id = ?")',
      'env.REPORTS.prepare("UPDATE editorial_documents SET body = ?")',
    );

    expect(
      lintRule(valid, "publication-compare-and-set", "src/admin-worker.ts"),
    ).toHaveLength(0);
    expect(
      lintRule(
        invalidVersionCheck,
        "publication-compare-and-set",
        "src/admin-worker.ts",
      ).map((message) => message.ruleId),
    ).toContain("atlasez/publication-compare-and-set");
    expect(
      lintRule(
        invalidCandidateContents,
        "publication-compare-and-set",
        "src/admin-worker.ts",
      ).map((message) => message.ruleId),
    ).toContain("atlasez/publication-compare-and-set");
    expect(
      lintRule(
        invalidPointerMutation,
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
