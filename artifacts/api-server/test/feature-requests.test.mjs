import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";

let baseUrl;
let serverProcess;
const notificationKeys = [];
const operatorId = "feature-request-test-operator";

function sql(statement) {
  return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-At", "-c", statement], {
    encoding: "utf8",
  }).trim();
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
      if (!address || typeof address === "string") return reject(new Error("No free port"));
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function request(path, userId, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "X-Test-User-Id": userId } : {}),
      ...options.headers,
    },
  });
  return { response, body: await response.json() };
}

async function insertRequest(status = "failed") {
  const key = randomUUID();
  notificationKeys.push(key);
  const escapedError = "Slack authentication failed";
  return Number(
    sql(`INSERT INTO feature_requests
      (notification_key, name, request, notification_status, notification_attempts,
       notification_error, next_notification_attempt_at)
      VALUES ('${key}', '運営テスト', '通知確認', '${status}', 3,
       '${escapedError}', NOW() + INTERVAL '1 hour')
      RETURNING id;`).split("\n")[0],
  );
}

before(async () => {
  const port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["--enable-source-maps", "./dist/index.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      OPERATOR_USER_IDS: operatorId,
      FEATURE_REQUEST_SLACK_CHANNEL_ID: "",
    },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.ok) return;
    } catch {}
    await wait(50);
  }
  throw new Error("API server did not become ready");
});

after(() => {
  serverProcess?.kill();
  if (notificationKeys.length) {
    sql(`DELETE FROM feature_requests WHERE notification_key IN (${notificationKeys
      .map((key) => `'${key}'`)
      .join(",")});`);
  }
});

test("pending notification list is operator-only and exposes retry details", async () => {
  const id = await insertRequest();
  assert.equal((await request("/api/feature-requests/notifications/pending")).response.status, 401);
  assert.equal(
    (await request("/api/feature-requests/notifications/pending", "ordinary-user")).response.status,
    403,
  );

  const { response, body } = await request(
    "/api/feature-requests/notifications/pending",
    operatorId,
  );
  assert.equal(response.status, 200);
  const item = body.requests.find((requestItem) => requestItem.id === id);
  assert.equal(item.notificationAttempts, 3);
  assert.equal(item.notificationError, "Slack authentication failed");
  assert.equal(typeof item.createdAt, "string");
  assert.equal(typeof item.nextNotificationAttemptAt, "string");
});

test("operator can safely schedule an unsent request and sent requests are rejected", async () => {
  const failedId = await insertRequest();
  const retry = await request(
    `/api/feature-requests/${failedId}/retry-notification`,
    operatorId,
    { method: "POST" },
  );
  assert.equal(retry.response.status, 202);
  assert.equal(retry.body.success, true);

  const sentId = await insertRequest("sent");
  const sentRetry = await request(
    `/api/feature-requests/${sentId}/retry-notification`,
    operatorId,
    { method: "POST" },
  );
  assert.equal(sentRetry.response.status, 409);
});