// ESLint flat config。TS/JSファイルを対象とする（.astroテンプレートはastro checkが担当）
import tseslint from "typescript-eslint";
import astro from "eslint-plugin-astro";
import {
  adminApiAccessBeforeDispatch,
  adminApiPoliciesReachScopes,
  adminApiPolicyFailsClosed,
  publicationCompareAndSet,
} from "./scripts/eslint-rules/atlasez-architecture.mjs";

const architecturePlugin = {
  rules: {
    "admin-api-access-before-dispatch": adminApiAccessBeforeDispatch,
    "admin-api-policies-reach-scopes": adminApiPoliciesReachScopes,
    "admin-api-policy-fails-closed": adminApiPolicyFailsClosed,
    "publication-compare-and-set": publicationCompareAndSet,
  },
};
const astroRecommendedRules = Object.fromEntries(
  Object.entries(astro.configs["flat/recommended"].at(-1).rules).filter(
    ([ruleName]) => ruleName !== "prettier/prettier",
  ),
);

export default tseslint.config(
  ...tseslint.configs.recommended,
  ...astro.configs["flat/base"].slice(0, 2),
  {
    files: ["src/**/*.ts", "scripts/**/*.mjs", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/admin-worker.ts"],
    plugins: { atlasez: architecturePlugin },
    rules: {
      "atlasez/admin-api-access-before-dispatch": "error",
      "atlasez/admin-api-policies-reach-scopes": "error",
      "atlasez/publication-compare-and-set": "error",
    },
  },
  {
    files: ["src/lib/admin-api-access-policy.ts"],
    plugins: { atlasez: architecturePlugin },
    rules: {
      "atlasez/admin-api-policy-fails-closed": "error",
    },
  },
  {
    files: ["src/**/*.astro"],
    rules: astroRecommendedRules,
  },
  {
    ignores: [
      "dist/",
      "node_modules/",
      ".astro/",
      "versions/",
      "*.d.ts",
      "**/*.astro/*.js",
      "**/*.astro/*.ts",
    ],
  },
);
