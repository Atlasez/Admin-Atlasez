import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidenceDirectory = path.join(
  root,
  "verification-artifacts",
  "agent-fix",
);
const summaryPath = path.join(evidenceDirectory, "workflow.json");

function usage() {
  console.log(
    "Usage:\n" +
      "  npm run agent:fix -- reproduce <tests/...spec.ts>\n" +
      "  npm run agent:fix -- verify [--journey <portal|article-editor|publication|member-tasks|calendar|permissions>]\n" +
      '  npm run agent:fix -- draft-pr --title "..." --description "..."',
  );
}

async function readSummary() {
  try {
    return JSON.parse(await readFile(summaryPath, "utf8"));
  } catch {
    return { schemaVersion: 1, reproductions: [], verification: null };
  }
}

async function saveSummary(summary) {
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n");
}

function run(command, args, env, logPath) {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(logPath, { flags: "w" });
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      log.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      log.write(chunk);
    });
    child.once("error", (error) => {
      log.end();
      reject(error);
    });
    child.once("close", (code) => {
      log.end();
      resolve(code ?? 1);
    });
  });
}

async function reproduce(testPath) {
  if (!testPath?.startsWith("tests/") || testPath.includes("..")) {
    throw new Error("指定できる再現テストは tests/ 以下のファイルです。");
  }
  const absoluteTestPath = path.resolve(root, testPath);
  if (!absoluteTestPath.startsWith(path.join(root, "tests") + path.sep))
    throw new Error("再現テストのパスがtests/の範囲外です。");
  const summary = await readSummary();
  const logPath = path.join(evidenceDirectory, "reproduce.log");
  const exitCode = await run(
    "npm",
    ["test", "--", testPath, "--reporter=verbose"],
    process.env,
    logPath,
  );
  summary.reproductions.push({
    test: testPath,
    outcome: exitCode === 0 ? "passed" : "failed",
    exitCode,
    logPath: path.relative(root, logPath),
    generatedAt: new Date().toISOString(),
  });
  await saveSummary(summary);
  return exitCode;
}

async function verify(journey) {
  const verification = [];
  const baseEnv = {
    ...process.env,
    ATLASEZ_BUILD_TARGET: "admin",
    SITE_URL: "https://admin.atlasez.org",
    BASE_PATH: "/",
  };
  const commands = [
    ["deploy-config", "npm", ["run", "verify:deploy-config"], process.env],
    ["check", "npm", ["run", "check"], process.env],
    ["lint", "npm", ["run", "lint"], process.env],
    ["format", "npm", ["run", "format:check"], process.env],
    ["unit", "npm", ["test"], process.env],
    [
      "publication-model",
      "npm",
      ["run", "verify:publication-model"],
      process.env,
    ],
    ["admin-build", "npm", ["run", "build"], baseEnv],
    ["build-info", "npm", ["run", "verify:build-info"], baseEnv],
  ];
  if (journey)
    commands.push([
      "e2e-" + journey,
      "npm",
      ["run", "agent:verify", "--", "run", journey],
      process.env,
    ]);

  await mkdir(evidenceDirectory, { recursive: true });
  for (const [name, executable, args, env] of commands) {
    const logPath = path.join(evidenceDirectory, name + ".log");
    const exitCode = await run(executable, args, env, logPath);
    verification.push({
      name,
      command: [executable, ...args].join(" "),
      outcome: exitCode === 0 ? "passed" : "failed",
      exitCode,
      logPath: path.relative(root, logPath),
    });
    const summary = await readSummary();
    summary.verification = {
      generatedAt: new Date().toISOString(),
      journey: journey ?? null,
      steps: verification,
      outcome: exitCode === 0 ? "running" : "failed",
    };
    await saveSummary(summary);
    if (exitCode !== 0) return exitCode;
  }

  const summary = await readSummary();
  summary.verification.outcome = "passed";
  await saveSummary(summary);
  return 0;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? null : (args[index + 1] ?? null);
}

async function createDraftPr(args) {
  const title = option(args, "--title");
  const description = option(args, "--description");
  if (!title || !description)
    throw new Error("draft-prには--titleと--descriptionが必要です。");
  const summary = await readSummary();
  if (summary.verification?.outcome !== "passed")
    throw new Error("全検証が成功したworkflow.jsonが必要です。");
  const branch = await new Promise((resolve, reject) => {
    const child = spawn("git", ["branch", "--show-current"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error("git branch failed")),
    );
  });
  if (!branch || branch === "main" || branch === "master")
    throw new Error("Draft PRはmain以外のブランチからだけ作成できます。");

  const bodyPath = path.join(evidenceDirectory, "draft-pr-body.md");
  const body = [
    description,
    "",
    "## Agent verification",
    "",
    ...summary.verification.steps.map(
      (step) => `- ${step.outcome.toUpperCase()}: ${step.command}`,
    ),
    "",
    `Evidence: ${path.relative(root, summaryPath)}`,
    "",
    "本PRは開発用Draftです。自動Merge・本番Deployは行いません。",
  ].join("\n");
  await writeFile(bodyPath, body + "\n");
  const logPath = path.join(evidenceDirectory, "draft-pr.log");
  return run(
    "gh",
    [
      "pr",
      "create",
      "--draft",
      "--base",
      "main",
      "--title",
      title,
      "--body-file",
      bodyPath,
    ],
    process.env,
    logPath,
  );
}

const [command, ...args] = process.argv.slice(2);
try {
  process.chdir(root);
  if (command === "reproduce") process.exitCode = await reproduce(args[0]);
  else if (command === "verify")
    process.exitCode = await verify(option(args, "--journey"));
  else if (command === "draft-pr") process.exitCode = await createDraftPr(args);
  else {
    usage();
    process.exitCode = command ? 2 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
