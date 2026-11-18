import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const resultsDirectory = process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results";
const outputDirectory = "verification-artifacts";
const journey = process.env.VERIFICATION_JOURNEY?.trim() || null;
const outputFile = path.join(
  outputDirectory,
  journey ? "summary-" + journey + ".json" : "summary.json",
);

function gitValue(...args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

const buildInfo = await readJson("dist/build-info.json");
const playwright = await readJson(
  path.join(resultsDirectory, "playwright-report.json"),
);
const stats = playwright?.stats ?? null;
const lighthouseRuns = await Promise.all(
  (await readdir(".lighthouseci").catch(() => []))
    .filter((file) => /^lhr-.+\.json$/.test(file))
    .map(async (file) => {
      const report = await readJson(path.join(".lighthouseci", file));
      if (!report?.categories) return null;
      return {
        url: report.finalDisplayedUrl ?? report.requestedUrl ?? null,
        scores: Object.fromEntries(
          Object.entries(report.categories).map(([name, category]) => [
            name,
            category.score,
          ]),
        ),
      };
    }),
);
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  target: {
    buildTarget: process.env.ATLASEZ_BUILD_TARGET ?? "ci",
    siteUrl: process.env.SITE_URL ?? null,
    basePath: process.env.BASE_PATH ?? null,
  },
  source: {
    commit: gitValue("rev-parse", "HEAD"),
    branch: gitValue("branch", "--show-current"),
  },
  ci: {
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    ref: process.env.GITHUB_REF ?? null,
  },
  build: buildInfo
    ? {
        commit: buildInfo.commit ?? null,
        builtAt: buildInfo.builtAt ?? null,
      }
    : null,
  e2e: {
    outcome: process.env.E2E_OUTCOME ?? null,
    journey,
    reportPath: playwright
      ? path.join(resultsDirectory, "playwright-report.json")
      : null,
    stats,
    failures: playwright?.errors ?? [],
  },
  checks: {
    deploymentConfig: process.env.DEPLOY_CONFIG_OUTCOME ?? null,
    typecheck: process.env.CHECK_OUTCOME ?? null,
    lint: process.env.LINT_OUTCOME ?? null,
    format: process.env.FORMAT_OUTCOME ?? null,
    unit: process.env.UNIT_OUTCOME ?? null,
    build: process.env.BUILD_OUTCOME ?? null,
    publicationModel: process.env.PUBLICATION_MODEL_OUTCOME ?? null,
    links: process.env.LINKS_OUTCOME ?? null,
  },
  lighthouse: {
    collectionOutcome: process.env.LHCI_COLLECT_OUTCOME ?? null,
    assertionOutcome: process.env.LHCI_ASSERT_OUTCOME ?? null,
    runs: lighthouseRuns.filter(Boolean),
  },
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, JSON.stringify(summary, null, 2) + "\n");
console.log("Verification summary: " + outputFile);
