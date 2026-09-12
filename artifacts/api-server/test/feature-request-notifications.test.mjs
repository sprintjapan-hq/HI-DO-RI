import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";

let baseUrl;
let serverProcess;
let notifications;
const createdKeys = [];

function sql(query) {
  return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-At", "-c", query], {
    encoding: "utf8",
  }).trim();
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.ok && (await response.json()).status === "ok") return;
    } catch {
      // The server may still be starting.
    }
    await wait(50);
  }
  throw new Error("API server did not become ready");
}

function insertRequest(overrides = {}) {
  const key = randomUUID();
  createdKeys.push(key);
  const status = overrides.status ?? "pending";
  const updatedAt = overrides.updatedAt ?? new Date();
  const nextAttemptAt = overrides.nextAttemptAt ?? new Date(0);
  const id = Number(
    sql(`INSERT INTO feature_requests
      (notification_key, name, request, notification_status, next_notification_attempt_at, updated_at)
      VALUES (${quote(key)}, 'テスト利用者', 'テスト要望', ${quote(status)},
        ${quote(nextAttemptAt.toISOString())}, ${quote(updatedAt.toISOString())})
      RETURNING id`).split("\n")[0],
  );
  return { id, key };
}

function readRequestByKey(key) {
  const raw = sql(`SELECT row_to_json(r) FROM (
    SELECT id, name, request, notification_status, notification_attempts,
      next_notification_attempt_at, notification_error, notified_at
    FROM feature_requests WHERE notification_key = ${quote(key)}
  ) r`);
  return JSON.parse(raw);
}

before(async () => {
  notifications = await import("../dist/feature-request-notifications.mjs");
  const port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(
    process.execPath,
    ["--enable-source-maps", "./dist/index.mjs"],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(port),
        FEATURE_REQUEST_SLACK_CHANNEL_ID: "",
      },
      stdio: "ignore",
    },
  );
  await waitForServer();
});

after(() => {
  serverProcess?.kill();
  if (createdKeys.length > 0) {
    sql(`DELETE FROM feature_requests WHERE notification_key IN
      (${createdKeys.map(quote).join(", ")})`);
  }
});

test("通知を送れなくてもAPIは受付成功を返し、内容と失敗状態を保存する", async () => {
  const requestText = `障害時にも残る要望 ${randomUUID()}`;
  const response = await fetch(`${baseUrl}/api/feature-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "障害テスト", request: requestText }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true });

  let row;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const raw = sql(`SELECT row_to_json(r) FROM (
      SELECT notification_key, name, request, notification_status,
        notification_attempts, notification_error
      FROM feature_requests WHERE request = ${quote(requestText)}
    ) r`);
    if (raw) {
      row = JSON.parse(raw);
      if (row.notification_status === "failed") break;
    }
    await wait(25);
  }

  assert.ok(row);
  createdKeys.push(row.notification_key);
  assert.equal(row.name, "障害テスト");
  assert.equal(row.request, requestText);
  assert.equal(row.notification_status, "failed");
  assert.equal(row.notification_attempts, 1);
  assert.match(row.notification_error, /not configured/);
});

test("Slack送信失敗後の同じ受付を、復旧時の同時再送でも一度だけ送る", async () => {
  const failureNow = new Date("2026-09-04T12:00:00.000Z");
  const recoveryNow = new Date(failureNow.getTime() + 2 * 60 * 1000);
  const { id, key } = insertRequest({ status: "pending" });
  const failed = await notifications.notifyFeatureRequest(id, {
    now: failureNow,
    sendSlackMessage: async () => {
      throw new Error("simulated Slack outage");
    },
  });

  assert.equal(failed, false);
  const failedRow = readRequestByKey(key);
  assert.equal(failedRow.notification_status, "failed");
  assert.equal(failedRow.notification_attempts, 1);
  assert.equal(failedRow.notification_error, "simulated Slack outage");
  assert.equal(
    new Date(failedRow.next_notification_attempt_at).getTime(),
    failureNow.getTime() + 60_000,
  );

  const sent = [];
  const sendSlackMessage = async (message) => {
    sent.push(message);
    await wait(20);
  };

  const results = await Promise.all([
    notifications.notifyFeatureRequest(id, { now: recoveryNow, sendSlackMessage }),
    notifications.notifyFeatureRequest(id, { now: recoveryNow, sendSlackMessage }),
  ]);

  assert.deepEqual(results.sort(), [false, true]);
  const matchingMessages = sent.filter((message) => message.client_msg_id === key);
  assert.equal(matchingMessages.length, 1);
  const row = readRequestByKey(key);
  assert.equal(row.notification_status, "sent");
  assert.equal(row.notification_attempts, 2);
  assert.equal(row.notification_error, null);
  assert.ok(row.notified_at);
});

test("タイムアウト回収が同時に走っても同じ受付を重複通知しない", async () => {
  const now = new Date("2026-09-04T12:00:00.000Z");
  const { key } = insertRequest({
    status: "sending",
    updatedAt: new Date(now.getTime() - 11 * 60 * 1000),
  });
  const sent = [];
  const sendSlackMessage = async (message) => {
    sent.push(message);
    await wait(20);
  };

  await Promise.all([
    notifications.retryDueNotifications({ now, sendSlackMessage }),
    notifications.retryDueNotifications({ now, sendSlackMessage }),
  ]);

  const matchingMessages = sent.filter((message) => message.client_msg_id === key);
  assert.equal(matchingMessages.length, 1);
  const row = readRequestByKey(key);
  assert.equal(row.notification_status, "sent");
  assert.equal(row.notification_attempts, 1);
  assert.ok(row.notified_at);
});