import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspaceDir = path.resolve(apiDir, "../..");
const webDistDir = path.join(workspaceDir, "artifacts/hidori/dist/public");
const releaseKeys = [];
let baseUrl;
let serverProcess;
let productionBundle;
let toReleaseCard;

function sql(statement) {
  return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-At", "-c", statement], {
    encoding: "utf8",
  }).trim();
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        reject(new Error("No free port"));
        return;
      }
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function readJavaScriptBundles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return readJavaScriptBundles(entryPath);
    return entry.name.endsWith(".js") ? [readFileSync(entryPath, "utf8")] : [];
  });
}

before(async () => {
  execFileSync(
    "pnpm",
    ["--filter", "@workspace/hidori", "run", "build"],
    {
      cwd: workspaceDir,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "4173",
        BASE_PATH: "/",
      },
      stdio: "pipe",
    },
  );
  productionBundle = readJavaScriptBundles(webDistDir).join("\n");
  const releaseMapper = await build({
    entryPoints: [path.join(workspaceDir, "artifacts/hidori/src/lib/release-history.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const mapperModuleUrl = `data:text/javascript;base64,${Buffer.from(
    releaseMapper.outputFiles[0].text,
  ).toString("base64")}`;
  ({ toReleaseCard } = await import(mapperModuleUrl));

  const port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["--enable-source-maps", "./dist/index.mjs"], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      FEATURE_REQUEST_SLACK_CHANNEL_ID: "",
    },
    stdio: "ignore",
  });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.ok && (await response.json()).status === "ok") return;
    } catch {
      // The built server may still be starting.
    }
    await wait(50);
  }
  throw new Error("API server did not become ready");
});

after(() => {
  serverProcess?.kill();
  if (releaseKeys.length > 0) {
    sql(
      `DELETE FROM feature_requests WHERE notification_key IN (${releaseKeys
        .map(quote)
        .join(", ")});`,
    );
  }
});

test("production web bundle includes candidate generation and the latest static release", () => {
  assert.match(productionBundle, /Googleカレンダーから候補日を生成/);
  assert.match(
    productionBundle,
    /Googleカレンダーの権限が切れています。再接続してからもう一度お試しください。/,
  );
  assert.match(productionBundle, /Googleカレンダー連携の日程調整フローを完成/);
  assert.match(
    productionBundle,
    /開催日の確定時、候補の仮予定をすべて削除して確定日時だけを正式予定として登録/,
  );
});

test("production API exposes the organizer calendar route instead of hiding it", async () => {
  const response = await fetch(`${baseUrl}/api/calendar-preview/candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ condition: "" }),
  });

  assert.equal(response.status, 401);
  assert.notEqual(response.status, 404);
});

test("production history client renders a completed request returned by its API", async () => {
  const notificationKey = randomUUID();
  const publicNote = `公開リリース確認 ${randomUUID()}`;
  releaseKeys.push(notificationKey);
  sql(`INSERT INTO feature_requests
    (notification_key, name, request, notification_status, development_status,
     development_note, completed_at)
    VALUES (${quote(notificationKey)}, '公開テスト', '履歴API確認', 'sent', 'completed',
      ${quote(publicNote)}, NOW());`);

  const response = await fetch(`${baseUrl}/api/feature-requests/releases`);
  assert.equal(response.status, 200);
  const releases = await response.json();
  const publishedRelease = releases.find((release) => release.note === publicNote);
  assert.ok(publishedRelease?.completedAt);

  const renderedCard = toReleaseCard(publishedRelease);
  assert.equal(renderedCard.title, publicNote);
  assert.equal(renderedCard.version, `完了 #${publishedRelease.id}`);
  assert.deepEqual(renderedCard.features, ["運営画面の完了通知と同時に自動掲載"]);
  assert.match(productionBundle, /feature-requests\/releases/);
});