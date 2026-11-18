import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifacts = path.join(root, "verification-artifacts");
const sessionFile = path.join(artifacts, "local-session.json");
const journeys = {
  portal: [
    "tests/e2e/admin-nav-portal.spec.ts",
    "参加中のプロジェクトを運営と参加者に分けて表示する",
  ],
  "article-editor": [
    "tests/e2e/admin-editor-workspace.spec.ts",
    "新規原稿の自動保存内容は再読み込み後も復元できる",
  ],
  publication: [
    "tests/e2e/admin-publication-runs.spec.ts",
    "公開処理一覧には最後に選択した状態の応答だけを反映する",
  ],
  "member-tasks": [
    "tests/e2e/admin-action-center.spec.ts",
    "アクションセンターで絞り込みと状態変更を操作できる",
  ],
  calendar: [
    "tests/e2e/admin-calendar.spec.ts",
    "月移動の古い応答を破棄し、次の月の読込失敗を再試行できる",
  ],
  permissions: [
    "tests/e2e/admin-permissions.spec.ts",
    "実効権限プレビューはユーザー単位の閲覧・編集・承認範囲を表示する",
  ],
};

function usage() {
  console.log(
    "Usage: npm run agent:verify -- doctor | run <journey> | cleanup\nJourneys: " +
      Object.keys(journeys).join(", "),
  );
}

function assertSafeInputs(env = process.env) {
  const base = env.E2E_BASE_URL?.trim();
  if (
    base &&
    !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(
      base,
    )
  )
    throw new Error(
      "E2E_BASE_URL must be local; remote and production E2E is blocked.",
    );
  if (env.E2E_AUTH_STORAGE_STATE)
    throw new Error(
      "Unset E2E_AUTH_STORAGE_STATE before running isolated mocked journeys.",
    );
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not allocate a local port.");
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 500);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function doctor(env = process.env) {
  assertSafeInputs(env);
  const checks = [
    ["リポジトリ", existsSync(path.join(root, "package.json"))],
    [
      "Playwright依存関係",
      existsSync(path.join(root, "node_modules/.bin/playwright")),
    ],
    ["Astro依存関係", existsSync(path.join(root, "node_modules/.bin/astro"))],
    [
      "管理ポータルのビルド",
      existsSync(path.join(root, "dist/admin/portal/index.html")),
    ],
    ["ビルド情報", existsSync(path.join(root, "dist/build-info.json"))],
  ];
  for (const [label, ok] of checks)
    console.log((ok ? "PASS " : "FAIL ") + label);
  if (checks.some(([, ok]) => !ok)) return 1;
  try {
    const info = JSON.parse(
      await readFile(path.join(root, "dist/build-info.json"), "utf8"),
    );
    console.log("INFO build SHA: " + (info.commit ?? "unknown"));
  } catch {
    console.error("FAIL build-info.jsonを読み取れません。");
    return 1;
  }
  const buildInfoStatus = run("npm", ["run", "verify:build-info"], env);
  if (buildInfoStatus !== 0) return buildInfoStatus;
  console.log("INFO 認証境界と隔離D1統合テストを確認します。");
  return run(
    "npm",
    [
      "test",
      "--",
      "tests/unit/admin-worker-auth.test.ts",
      "tests/unit/admin-readiness-integration.test.ts",
    ],
    env,
  );
}

async function runJourney(name) {
  const journey = journeys[name];
  if (!journey) {
    console.error("Unknown journey: " + (name ?? "(missing)"));
    usage();
    return 2;
  }
  assertSafeInputs();
  const port = await freePort();
  const localUrl = "http://127.0.0.1:" + port;
  const outputDir = path.join("verification-artifacts", "test-results", name);
  const env = {
    ...process.env,
    ATLASEZ_BUILD_TARGET: "admin",
    SITE_URL: "https://admin.atlasez.org",
    BASE_PATH: "/",
    E2E_BASE_URL: localUrl,
    E2E_PORT: String(port),
    E2E_REUSE_SERVER: "0",
    PLAYWRIGHT_OUTPUT_DIR: outputDir,
    VERIFICATION_JOURNEY: name,
  };
  console.log("ローカル専用の検証を開始: " + name + " (" + localUrl + ")");
  let status = run("npm", ["run", "build"], env);
  if (status === 0) status = run("npm", ["run", "verify:build-info"], env);
  if (status === 0) status = await doctor(env);
  await mkdir(artifacts, { recursive: true });
  if (status === 0)
    status = run(
      "npm",
      [
        "run",
        "test:e2e",
        "--",
        journey[0],
        "--grep",
        journey[1],
        "--workers=1",
      ],
      env,
    );
  await writeFile(
    sessionFile,
    JSON.stringify({ port, journey: name, exitCode: status }, null, 2) + "\n",
  );
  const summaryStatus = run("npm", ["run", "verification:summary"], {
    ...env,
    E2E_OUTCOME: status === 0 ? "passed" : "failed",
  });
  return status || summaryStatus;
}

async function cleanup() {
  if (!existsSync(sessionFile)) {
    console.log("管理対象のローカル検証セッションはありません。");
    return 0;
  }
  const session = JSON.parse(await readFile(sessionFile, "utf8"));
  if (await portIsOpen(Number(session.port))) {
    console.error(
      "ポート " +
        session.port +
        " が応答しています。別プロセスの可能性があるため停止しません。",
    );
    return 1;
  }
  await rm(sessionFile);
  console.log(
    "検証サーバーの終了を確認しました。保存した証拠は保持しています。",
  );
  return 0;
}

process.chdir(root);
const [command, argument] = process.argv.slice(2);
try {
  if (command === "doctor") process.exitCode = await doctor();
  else if (command === "run") process.exitCode = await runJourney(argument);
  else if (command === "cleanup") process.exitCode = await cleanup();
  else {
    usage();
    process.exitCode = command ? 2 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
