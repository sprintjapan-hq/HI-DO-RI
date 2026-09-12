import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import net from "node:net";
import http from "node:http";

let baseUrl;
const createdShareIds = [];
let serverProcess;
let googleServer;
let googleBaseUrl;
const googleEvents = new Map();
const googleCreateAttempts = new Map();
const googleCreateFailures = new Map();
const googleDeleteFailures = new Map();
const googleGetFailures = new Map();
let googleFreeBusyStatus = 200;
let googleFreeBusyPeriods = [];
let lastGoogleFreeBusyRequest;
let googleCreateStatus = 200;
const legacyTestShareId = "legacy-test-poll";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await wait(25);
  }
  throw new Error("Condition did not become true before timeout");
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

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not determine a free port"));
        return;
      }
      const port = address.port;
      probe.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")));
    req.on("error", reject);
  });
}

async function startGoogleServer() {
  googleServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const eventPrefix = "/calendar/v3/calendars/primary/events/";
    res.setHeader("Content-Type", "application/json");

    if (req.method === "POST" && url.pathname === "/calendar/v3/freeBusy") {
      lastGoogleFreeBusyRequest = await readRequestBody(req);
      if (googleFreeBusyStatus !== 200) {
        res.writeHead(googleFreeBusyStatus).end(JSON.stringify({ error: "injected" }));
        return;
      }
      res.writeHead(200).end(JSON.stringify({
        calendars: { primary: { busy: googleFreeBusyPeriods } },
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/calendar/v3/calendars/primary/events") {
      const event = await readRequestBody(req);
      googleCreateAttempts.set(event.id, (googleCreateAttempts.get(event.id) ?? 0) + 1);
      if (googleCreateStatus !== 200) {
        res.writeHead(googleCreateStatus).end(JSON.stringify({ error: "injected" }));
        return;
      }
      const failure = googleCreateFailures.get(event.id);
      if (failure) {
        googleCreateFailures.delete(event.id);
        res.writeHead(failure.status).end(JSON.stringify({
          error: {
            errors: failure.reason ? [{ reason: failure.reason }] : [],
          },
        }));
        return;
      }
      if (googleEvents.has(event.id)) {
        res.writeHead(409).end(JSON.stringify({ error: "duplicate" }));
        return;
      }
      const saved = { ...event, htmlLink: `https://calendar.test/events/${event.id}` };
      googleEvents.set(event.id, saved);
      res.writeHead(200).end(JSON.stringify(saved));
      return;
    }

    if (url.pathname.startsWith(eventPrefix)) {
      const eventId = decodeURIComponent(url.pathname.slice(eventPrefix.length));
      if (req.method === "GET") {
        const failure = googleGetFailures.get(eventId);
        if (failure) {
          googleGetFailures.delete(eventId);
          res.writeHead(failure.status).end(JSON.stringify({ error: "injected" }));
          return;
        }
        const event = googleEvents.get(eventId);
        res.writeHead(event ? 200 : 404).end(JSON.stringify(event ?? { error: "missing" }));
        return;
      }
      if (req.method === "DELETE") {
        const failure = googleDeleteFailures.get(eventId);
        if (failure) {
          googleDeleteFailures.delete(eventId);
          if (failure.deleteAnyway) googleEvents.delete(eventId);
          res.writeHead(failure.status).end(JSON.stringify({ error: "injected" }));
          return;
        }
        const existed = googleEvents.delete(eventId);
        res.writeHead(existed ? 204 : 404).end();
        return;
      }
    }

    res.writeHead(404).end(JSON.stringify({ error: "unknown request" }));
  });
  const port = await findFreePort();
  googleBaseUrl = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    googleServer.once("error", reject);
    googleServer.listen(port, "127.0.0.1", resolve);
  });
}

function sql(command, { output = false } = {}) {
  return execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", ...(output ? ["-At"] : []), "-c", command],
    { encoding: output ? "utf8" : undefined, stdio: output ? undefined : "ignore" },
  )?.trim();
}

function calendarRows(shareId) {
  const result = sql(
    `SELECT json_agg(row_to_json(events)) FROM (
       SELECT pce.google_event_id, pce.kind, pce.candidate_id
       FROM poll_calendar_events pce
       JOIN polls p ON p.id = pce.poll_id
       WHERE p.share_id = '${shareId.replaceAll("'", "''")}'
       ORDER BY pce.kind, pce.candidate_id
     ) events`,
    { output: true },
  );
  return JSON.parse(result || "null") ?? [];
}

function calendarSyncRow(shareId) {
  const result = sql(
    `SELECT row_to_json(sync) FROM (
       SELECT pcs.status, pcs.attempts, pcs.last_error
       FROM poll_calendar_syncs pcs
       JOIN polls p ON p.id = pcs.poll_id
       WHERE p.share_id = '${shareId.replaceAll("'", "''")}'
     ) sync`,
    { output: true },
  );
  return JSON.parse(result || "null");
}

async function request(path, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await response.json();
  return { response, body };
}

async function createPoll(overrides = {}, ownerUserId = "poll-test-organizer") {
  const title = `回帰テスト ${randomUUID()}`;
  const { response, body } = await request("/api/polls", {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({
      title,
      candidates: ["2026年9月10日", "2026年9月11日"],
      ...overrides,
    }),
  });
  assert.equal(response.status, 201);
  assert.equal(typeof body.adminKey, "string");
  createdShareIds.push(body.shareId);
  return body;
}

function deleteCreatedPolls() {
  if (createdShareIds.length === 0) return;

  const values = createdShareIds
    .map((shareId) => `'${shareId.replaceAll("'", "''")}'`)
    .join(", ");
  execFileSync(
    "psql",
    [
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `DELETE FROM polls WHERE share_id IN (${values})`,
    ],
    { stdio: "ignore" },
  );
}

function seedLegacyPoll() {
  execFileSync(
    "psql",
    [
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `INSERT INTO polls (share_id, title, note, owner_user_id, admin_key)
       VALUES ('${legacyTestShareId}', '以前のイベント', '', NULL, NULL)
       ON CONFLICT (share_id) DO UPDATE
       SET owner_user_id = NULL, admin_key = NULL`,
    ],
    { stdio: "ignore" },
  );
  createdShareIds.push(legacyTestShareId);
}

before(async () => {
  await startGoogleServer();
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
        GOOGLE_CALENDAR_TEST_TOKEN: "local-calendar-test-token",
        GOOGLE_CALENDAR_TEST_BASE_URL: googleBaseUrl,
      },
      stdio: "ignore",
    },
  );
  await waitForServer();
});

after(() => {
  serverProcess?.kill();
  googleServer?.close();
  sql("DROP TRIGGER IF EXISTS poll_calendar_events_test_failure ON poll_calendar_events; DROP FUNCTION IF EXISTS fail_poll_calendar_event_insert();");
  deleteCreatedPolls();
});

test("ログインしていない利用者はイベントを作成できない", async () => {
  const { response, body } = await request("/api/polls", {
    method: "POST",
    body: JSON.stringify({
      title: "未認証イベント",
      candidates: ["候補1", "候補2"],
    }),
  });
  assert.equal(response.status, 401);
  assert.equal(body.error, "イベント作成にはログインが必要です。");
});

test("明示した期間・平日・開始時刻・所要時間の候補条件を解析できる", async () => {
  const { response, body } = await request("/api/calendar-preview/candidates", {
    method: "POST",
    headers: { "X-Test-User-Id": `calendar-condition-${randomUUID()}` },
    body: JSON.stringify({
      condition: "10月1日から15日までの平日で、19時以降の1時間枠で",
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(body.error, "Googleカレンダーを接続してください。");
});

test("スラッシュ区切りの日付範囲と午後を候補条件として解析できる", async () => {
  const { response, body } = await request("/api/calendar-preview/candidates", {
    method: "POST",
    headers: { "X-Test-User-Id": `calendar-sync-test-slash-afternoon-${randomUUID()}` },
    body: JSON.stringify({
      condition: "2026/9/18-9/22の午後。1時間枠",
      limit: 20,
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(body.interpretation, "9月18日から9月22日まで、毎日の13:00から18:00の間で60分");
  assert.ok(body.slots.length > 0);
  assert.ok(body.slots.every((slot) => {
    const start = new Date(slot.start);
    return start >= new Date("2026-09-18T04:00:00.000Z")
      && start < new Date("2026-09-23T00:00:00.000Z")
      && slot.label.match(/\s(?:13|14|15|16|17):00〜/);
  }));
});

test("スラッシュ区切りの日付範囲とコロン時刻の窓を解析できる", async () => {
  const { response, body } = await request("/api/calendar-preview/candidates", {
    method: "POST",
    headers: { "X-Test-User-Id": `calendar-sync-test-colon-range-${randomUUID()}` },
    body: JSON.stringify({
      condition: "2026/9/18-9/22の13:00-15:00。2時間枠",
      limit: 20,
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(body.interpretation, "9月18日から9月22日まで、毎日の13:00から15:00の間で120分");
  assert.deepEqual(body.slots.map((slot) => slot.label), [
    "2026/9/18(金) 13:00〜15:00",
    "2026/9/19(土) 13:00〜15:00",
    "2026/9/20(日) 13:00〜15:00",
    "2026/9/21(月) 13:00〜15:00",
    "2026/9/22(火) 13:00〜15:00",
  ]);
});

test("「日の間」の日付範囲と午後のコロン時刻を同時に解析できる", async () => {
  const { response, body } = await request("/api/calendar-preview/candidates", {
    method: "POST",
    headers: { "X-Test-User-Id": `calendar-sync-test-japanese-range-afternoon-${randomUUID()}` },
    body: JSON.stringify({
      condition: "10月1日から7日の間で平日の13:00-17:00の間の1時間枠",
      limit: 20,
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(body.interpretation, "10月1日から10月7日まで、平日の13:00から17:00の間で60分");
  assert.ok(body.slots.length > 0);
  assert.ok(body.slots.every((slot) =>
    slot.label.startsWith("2026/10/")
    && slot.label.match(/\s(?:13|14|15|16):00〜/)
  ));
});

test("「日の間」の日付範囲と午前のコロン時刻を同時に解析できる", async () => {
  const { response, body } = await request("/api/calendar-preview/candidates", {
    method: "POST",
    headers: { "X-Test-User-Id": `calendar-sync-test-japanese-range-morning-${randomUUID()}` },
    body: JSON.stringify({
      condition: "10月1日から7日の間で平日の9:00-12:00の間の1時間枠",
      limit: 20,
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(body.interpretation, "10月1日から10月7日まで、平日の09:00から12:00の間で60分");
  assert.ok(body.slots.length > 0);
  assert.ok(body.slots.every((slot) =>
    slot.label.startsWith("2026/10/")
    && slot.label.match(/\s(?:09|10|11):00〜/)
  ));
});

test("スラッシュ区切りの日付範囲だけでも範囲外の候補を生成しない", async () => {
  const { response, body } = await request("/api/calendar-preview/candidates", {
    method: "POST",
    headers: { "X-Test-User-Id": `calendar-sync-test-slash-default-${randomUUID()}` },
    body: JSON.stringify({
      condition: "2026/9/18-9/22",
      limit: 20,
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(body.interpretation, "9月18日から9月22日まで、毎日の19:00から24:00の間で120分");
  assert.ok(body.slots.length > 0);
  assert.ok(body.slots.every((slot) => {
    const start = new Date(slot.start);
    return start >= new Date("2026-09-18T10:00:00.000Z")
      && start < new Date("2026-09-23T00:00:00.000Z")
      && slot.label.match(/\s(?:19|20|21|22):00〜/);
  }));
});

test("時刻範囲を日本時間として守り、primaryカレンダーの予定を候補から除外する", async () => {
  const ownerUserId = `calendar-sync-test-time-range-${randomUUID()}`;
  googleFreeBusyPeriods = [{
    start: "2026-12-01T04:00:00.000Z",
    end: "2026-12-01T05:00:00.000Z",
  }];

  try {
    const { response, body } = await request("/api/calendar-preview/candidates", {
      method: "POST",
      headers: { "X-Test-User-Id": ownerUserId },
      body: JSON.stringify({
        condition: "12月1日から7日までの平日13:00から16:00の間で2時間枠",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(lastGoogleFreeBusyRequest.items, [{ id: "primary" }]);
    assert.equal(lastGoogleFreeBusyRequest.timeZone, "Asia/Tokyo");
    assert.equal(body.interpretation, "12月1日から12月7日まで、平日の13:00から16:00の間で120分");
    assert.deepEqual(body.slots.slice(0, 3).map((slot) => slot.label), [
      "2026/12/1(火) 14:00〜16:00",
      "2026/12/2(水) 13:00〜15:00",
      "2026/12/2(水) 14:00〜16:00",
    ]);
    assert.equal(body.slots[0].start, "2026-12-01T05:00:00.000Z");
    assert.equal(body.slots[0].end, "2026-12-01T07:00:00.000Z");
  } finally {
    googleFreeBusyPeriods = [];
    lastGoogleFreeBusyRequest = undefined;
  }
});

test("Googleの権限切れは再接続案内を返し、一時障害とは区別する", async () => {
  const ownerUserId = `calendar-sync-test-expired-${randomUUID()}`;
  const requestCandidates = () => request("/api/calendar-preview/candidates", {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ condition: "来週の平日19時から1時間" }),
  });

  googleFreeBusyStatus = 401;
  const expired = await requestCandidates();
  assert.equal(expired.response.status, 409);
  assert.equal(expired.body.code, "google_calendar_reconnect_required");
  assert.match(expired.body.error, /再接続/);

  googleFreeBusyStatus = 403;
  const forbidden = await requestCandidates();
  assert.equal(forbidden.response.status, 409);
  assert.equal(forbidden.body.code, "google_calendar_reconnect_required");
  assert.match(forbidden.body.error, /再接続/);

  googleFreeBusyStatus = 500;
  const temporaryFailure = await requestCandidates();
  assert.equal(temporaryFailure.response.status, 502);
  assert.equal(temporaryFailure.body.code, undefined);
  assert.doesNotMatch(temporaryFailure.body.error, /再接続/);

  googleFreeBusyStatus = 200;
});

test("確定予定の同期中に権限が切れた場合も再接続案内を返す", async () => {
  const ownerUserId = `calendar-sync-test-create-expired-${randomUUID()}`;
  const poll = await createPoll({
    candidates: ["候補A", "候補B"],
    candidateSlots: [{
      label: "候補A",
      start: "2026-09-14T01:00:00.000Z",
      end: "2026-09-14T02:00:00.000Z",
    }],
  }, ownerUserId);

  googleCreateStatus = 401;
  const confirmation = await request(`/api/polls/${poll.shareId}/confirmation`, {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ candidateId: poll.candidates[0].id }),
  });
  assert.equal(confirmation.response.status, 409);
  assert.equal(confirmation.body.code, "google_calendar_reconnect_required");
  assert.match(confirmation.body.error, /再接続/);

  const retry = await request("/api/calendar/events", {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ shareId: poll.shareId }),
  });
  assert.equal(retry.response.status, 409);
  assert.equal(retry.body.code, "google_calendar_reconnect_required");

  googleCreateStatus = 200;
});

test("カレンダー生成候補の日時を保存し、手入力候補は日時なしで返す", async () => {
  const ownerUserId = `calendar-slot-owner-${randomUUID()}`;
  const start = "2026-09-10T10:00:00.000Z";
  const end = "2026-09-10T12:00:00.000Z";
  const poll = await createPoll({
    candidates: ["生成候補", "手入力候補"],
    candidateSlots: [{ label: "生成候補", start, end }],
  }, ownerUserId);

  assert.equal(poll.candidates[0].start, start);
  assert.equal(poll.candidates[0].end, end);
  assert.equal(poll.candidates[1].start, null);
  assert.equal(poll.candidates[1].end, null);

  const { response, body } = await request(`/api/polls/${poll.shareId}`, {
    headers: { "X-Test-User-Id": ownerUserId },
  });
  assert.equal(response.status, 200);
  assert.equal(body.candidates[0].start, start);
  assert.equal(body.candidates[0].end, end);
});

test("Google同期は日時のある候補だけを同数登録する", async () => {
  const ownerUserId = `calendar-sync-test-candidates-${randomUUID()}`;
  const poll = await createPoll({
    candidates: ["候補A", "候補B", "手入力"],
    candidateSlots: [
      { label: "候補A", start: "2026-09-10T01:00:00.000Z", end: "2026-09-10T02:00:00.000Z" },
      { label: "候補B", start: "2026-09-11T01:00:00.000Z", end: "2026-09-11T02:00:00.000Z" },
    ],
  }, ownerUserId);
  const createdIds = [...googleEvents.values()]
    .filter((event) => event.extendedProperties?.private?.hidoriShareId === poll.shareId)
    .map((event) => event.id)
    .sort();
  assert.equal(createdIds.length, 2);
  assert.deepEqual(
    calendarRows(poll.shareId).map((row) => row.google_event_id).sort(),
    createdIds,
  );
  assert.ok(createdIds.every((id) => googleCreateAttempts.get(id) === 1));
});

test("calendar.events権限がなくても出欠表の作成と確定に成功する", async () => {
  const ownerUserId = `calendar-sync-test-freebusy-only-${randomUUID()}`;
  const poll = await createPoll({
    candidates: ["候補A", "候補B"],
    candidateSlots: [{
      label: "候補A",
      start: "2026-09-15T01:00:00.000Z",
      end: "2026-09-15T02:00:00.000Z",
    }],
  }, ownerUserId);

  assert.equal(calendarRows(poll.shareId).length, 0);

  const confirmation = await request(`/api/polls/${poll.shareId}/confirmation`, {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ candidateId: poll.candidates[0].id }),
  });

  assert.equal(confirmation.response.status, 200);
  assert.equal(confirmation.body.confirmedCandidateId, poll.candidates[0].id);
  assert.equal(confirmation.body.code, undefined);
  assert.equal(calendarRows(poll.shareId).length, 0);
});

test("一時的な削除・作成失敗から自動復旧し、確定予定は1件だけになる", async () => {
  const ownerUserId = `calendar-sync-test-finalize-${randomUUID()}`;
  const poll = await createPoll({
    candidates: ["候補A", "候補B", "手入力"],
    candidateSlots: [
      { label: "候補A", start: "2026-09-12T01:00:00.000Z", end: "2026-09-12T02:00:00.000Z" },
      { label: "候補B", start: "2026-09-13T01:00:00.000Z", end: "2026-09-13T02:00:00.000Z" },
    ],
  }, ownerUserId);
  const tentativeRows = calendarRows(poll.shareId);
  assert.equal(tentativeRows.length, 2);
  googleDeleteFailures.set(tentativeRows[0].google_event_id, {
    status: 500,
    deleteAnyway: true,
  });
  const confirmation = await request(`/api/polls/${poll.shareId}/confirmation`, {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ candidateId: poll.candidates[0].id }),
  });
  assert.equal(confirmation.response.status, 200);
  assert.equal(calendarRows(poll.shareId).filter((row) => row.kind === "tentative").length, 1);

  await waitUntil(() => {
    const rows = calendarRows(poll.shareId);
    return (
      rows.filter((row) => row.kind === "tentative").length === 0 &&
      rows.filter((row) => row.kind === "confirmed").length === 1 &&
      calendarSyncRow(poll.shareId)?.status === "succeeded"
    );
  });

  const rows = calendarRows(poll.shareId);
  assert.equal(rows.filter((row) => row.kind === "tentative").length, 0);
  assert.equal(rows.filter((row) => row.kind === "confirmed").length, 1);
  const pollGoogleEvents = [...googleEvents.values()].filter(
    (event) => event.extendedProperties?.private?.hidoriShareId === poll.shareId,
  );
  assert.equal(pollGoogleEvents.length, 1);
  assert.ok((googleCreateAttempts.get(rows.find((row) => row.kind === "confirmed").google_event_id) ?? 0) >= 1);
});

test("一時的な確定予定作成失敗を記録し、バックグラウンドで復旧する", async () => {
  const ownerUserId = `calendar-sync-test-create-retry-${randomUUID()}`;
  const poll = await createPoll({
    candidateSlots: [
      {
        label: "2026年9月10日",
        start: "2026-09-10T01:00:00.000Z",
        end: "2026-09-10T02:00:00.000Z",
      },
    ],
  }, ownerUserId);
  const confirmedEventId = createHash("sha256")
    .update(`hidori:${poll.id}:${poll.candidates[0].id}:confirmed`)
    .digest("hex");
  googleCreateFailures.set(confirmedEventId, { status: 503 });

  const confirmation = await request(`/api/polls/${poll.shareId}/confirmation`, {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ candidateId: poll.candidates[0].id }),
  });
  assert.equal(confirmation.response.status, 200);

  await waitUntil(() => calendarSyncRow(poll.shareId)?.status === "succeeded");
  const rows = calendarRows(poll.shareId);
  assert.equal(rows.filter((row) => row.kind === "tentative").length, 0);
  assert.equal(rows.filter((row) => row.kind === "confirmed").length, 1);
  assert.equal(googleCreateAttempts.get(confirmedEventId), 2);
});

test("Googleのレート制限403は恒久停止せず自動復旧する", async () => {
  const ownerUserId = `calendar-sync-test-rate-limit-${randomUUID()}`;
  const poll = await createPoll({
    candidateSlots: [
      {
        label: "2026年9月10日",
        start: "2026-09-10T01:00:00.000Z",
        end: "2026-09-10T02:00:00.000Z",
      },
    ],
  }, ownerUserId);
  const confirmedEventId = createHash("sha256")
    .update(`hidori:${poll.id}:${poll.candidates[0].id}:confirmed`)
    .digest("hex");
  googleCreateFailures.set(confirmedEventId, {
    status: 403,
    reason: "rateLimitExceeded",
  });

  const confirmation = await request(`/api/polls/${poll.shareId}/confirmation`, {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ candidateId: poll.candidates[0].id }),
  });
  assert.equal(confirmation.response.status, 200);
  await waitUntil(() => calendarSyncRow(poll.shareId)?.status === "succeeded");
  assert.equal(googleCreateAttempts.get(confirmedEventId), 2);
});

test("恒久的なGoogle権限エラーは自動再試行せず、主催者へ再接続を案内する", async () => {
  const ownerUserId = `calendar-sync-test-permanent-${randomUUID()}`;
  const poll = await createPoll({
    candidateSlots: [
      {
        label: "2026年9月10日",
        start: "2026-09-10T01:00:00.000Z",
        end: "2026-09-10T02:00:00.000Z",
      },
    ],
  }, ownerUserId);
  const [tentative] = calendarRows(poll.shareId);
  googleDeleteFailures.set(tentative.google_event_id, {
    status: 403,
    deleteAnyway: false,
  });

  const confirmation = await request(`/api/polls/${poll.shareId}/confirmation`, {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ candidateId: poll.candidates[0].id }),
  });
  assert.equal(confirmation.response.status, 409);
  assert.equal(confirmation.body.code, "google_calendar_reconnect_required");
  assert.match(confirmation.body.error, /再接続/);
  assert.equal(calendarSyncRow(poll.shareId).status, "permanent_failure");
  assert.equal(calendarSyncRow(poll.shareId).attempts, 1);
  await wait(350);
  assert.equal(calendarSyncRow(poll.shareId).attempts, 1);
});

test("仮予定削除の401・403は確定時と再同期時の両方で再接続案内になる", async () => {
  const ownerUserId = `calendar-sync-test-delete-auth-${randomUUID()}`;
  const poll = await createPoll({
    candidateSlots: [{
      label: "2026年9月10日",
      start: "2026-09-10T01:00:00.000Z",
      end: "2026-09-10T02:00:00.000Z",
    }],
  }, ownerUserId);
  const [tentative] = calendarRows(poll.shareId);
  googleDeleteFailures.set(tentative.google_event_id, {
    status: 401,
    deleteAnyway: false,
  });

  const confirmation = await request(`/api/polls/${poll.shareId}/confirmation`, {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ candidateId: poll.candidates[0].id }),
  });
  assert.equal(confirmation.response.status, 409);
  assert.equal(confirmation.body.code, "google_calendar_reconnect_required");
  assert.match(confirmation.body.error, /再接続/);
  assert.equal(calendarSyncRow(poll.shareId).status, "permanent_failure");

  googleDeleteFailures.set(tentative.google_event_id, {
    status: 403,
    deleteAnyway: false,
  });
  const retry = await request("/api/calendar/events", {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ shareId: poll.shareId }),
  });
  assert.equal(retry.response.status, 409);
  assert.equal(retry.body.code, "google_calendar_reconnect_required");
  assert.match(retry.body.error, /再接続/);
  assert.equal(calendarSyncRow(poll.shareId).status, "permanent_failure");
  assert.equal(calendarSyncRow(poll.shareId).attempts, 1);
});

test("既存確定予定確認の401・403は再同期時に再接続案内になる", async () => {
  const ownerUserId = `calendar-sync-test-get-auth-${randomUUID()}`;
  const poll = await createPoll({
    candidateSlots: [{
      label: "2026年9月10日",
      start: "2026-09-10T01:00:00.000Z",
      end: "2026-09-10T02:00:00.000Z",
    }],
  }, ownerUserId);
  const confirmation = await request(`/api/polls/${poll.shareId}/confirmation`, {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ candidateId: poll.candidates[0].id }),
  });
  assert.equal(confirmation.response.status, 200);
  const confirmed = calendarRows(poll.shareId).find((row) => row.kind === "confirmed");
  assert.ok(confirmed);

  for (const status of [401, 403]) {
    googleGetFailures.set(confirmed.google_event_id, { status });
    const retry = await request("/api/calendar/events", {
      method: "POST",
      headers: { "X-Test-User-Id": ownerUserId },
      body: JSON.stringify({ shareId: poll.shareId }),
    });
    assert.equal(retry.response.status, 409);
    assert.equal(retry.body.code, "google_calendar_reconnect_required");
    assert.match(retry.body.error, /再接続/);
    assert.equal(calendarSyncRow(poll.shareId).status, "permanent_failure");
    assert.equal(calendarSyncRow(poll.shareId).attempts, 1);
  }
});

test("仮予定削除の410は削除済み扱いにし、5xxだけを自動再試行する", async () => {
  const ownerUserId = `calendar-sync-test-delete-status-${randomUUID()}`;
  const poll = await createPoll({
    candidates: ["候補A", "候補B"],
    candidateSlots: [
      {
        label: "候補A",
        start: "2026-09-10T01:00:00.000Z",
        end: "2026-09-10T02:00:00.000Z",
      },
      {
        label: "候補B",
        start: "2026-09-11T01:00:00.000Z",
        end: "2026-09-11T02:00:00.000Z",
      },
    ],
  }, ownerUserId);
  const tentatives = calendarRows(poll.shareId);
  googleDeleteFailures.set(tentatives[0].google_event_id, {
    status: 410,
    deleteAnyway: true,
  });
  googleDeleteFailures.set(tentatives[1].google_event_id, {
    status: 500,
    deleteAnyway: true,
  });

  const confirmation = await request(`/api/polls/${poll.shareId}/confirmation`, {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ candidateId: poll.candidates[0].id }),
  });
  assert.equal(confirmation.response.status, 200);
  assert.equal(confirmation.body.code, undefined);
  await waitUntil(() => calendarSyncRow(poll.shareId)?.status === "succeeded");
  assert.equal(
    calendarRows(poll.shareId).filter((row) => row.kind === "tentative").length,
    0,
  );
  assert.equal(
    calendarRows(poll.shareId).filter((row) => row.kind === "confirmed").length,
    1,
  );
});

test("上限回数で停止した処理中ジョブは復旧時に追加実行しない", async () => {
  const ownerUserId = `calendar-sync-test-exhausted-${randomUUID()}`;
  const poll = await createPoll({
    candidateSlots: [
      {
        label: "2026年9月10日",
        start: "2026-09-10T01:00:00.000Z",
        end: "2026-09-10T02:00:00.000Z",
      },
    ],
  }, ownerUserId);
  await request(`/api/polls/${poll.shareId}/confirmation`, {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ candidateId: poll.candidates[0].id }),
  });
  sql(`
    UPDATE poll_calendar_syncs pcs
    SET status = 'processing',
        lease_token = 'abandoned-test-lease',
        attempts = 8,
        updated_at = now() - interval '11 minutes'
    FROM polls p
    WHERE pcs.poll_id = p.id
      AND p.share_id = '${poll.shareId.replaceAll("'", "''")}'
  `);

  await waitUntil(() => calendarSyncRow(poll.shareId)?.status === "permanent_failure");
  assert.equal(calendarSyncRow(poll.shareId).attempts, 8);
  await wait(250);
  assert.equal(calendarSyncRow(poll.shareId).attempts, 8);
});

test("Google作成後のDB保存失敗を再同期すると同じ確定イベントIDを回収する", async () => {
  const ownerUserId = `calendar-sync-test-db-recovery-${randomUUID()}`;
  const poll = await createPoll({
    candidateSlots: [
      {
        label: "2026年9月10日",
        start: "2026-09-10T01:00:00.000Z",
        end: "2026-09-10T02:00:00.000Z",
      },
    ],
  }, ownerUserId);
  sql(`
    CREATE OR REPLACE FUNCTION fail_poll_calendar_event_insert()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.kind = 'confirmed' THEN
        RAISE EXCEPTION 'injected confirmed calendar row failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER poll_calendar_events_test_failure
    BEFORE INSERT ON poll_calendar_events
    FOR EACH ROW EXECUTE FUNCTION fail_poll_calendar_event_insert();
  `);

  const confirmation = await request(`/api/polls/${poll.shareId}/confirmation`, {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ candidateId: poll.candidates[0].id }),
  });
  assert.equal(confirmation.response.status, 200);
  const orphanedConfirmed = [...googleEvents.values()].find(
    (event) =>
      event.extendedProperties?.private?.hidoriShareId === poll.shareId &&
      event.extendedProperties?.private?.hidoriKind === "confirmed",
  );
  assert.ok(orphanedConfirmed);
  assert.equal(calendarRows(poll.shareId).length, 0);

  sql("DROP TRIGGER poll_calendar_events_test_failure ON poll_calendar_events;");
  const synchronized = await request("/api/calendar/events", {
    method: "POST",
    headers: { "X-Test-User-Id": ownerUserId },
    body: JSON.stringify({ shareId: poll.shareId }),
  });
  assert.equal(synchronized.response.status, 201);
  const [recovered] = calendarRows(poll.shareId);
  assert.equal(recovered.google_event_id, orphanedConfirmed.id);
  assert.equal(recovered.kind, "confirmed");
  assert.equal(googleCreateAttempts.get(orphanedConfirmed.id), 2);
});

test("主催者のイベント履歴は本人のイベントと共有IDだけを返す", async () => {
  const ownPoll = await createPoll({ note: "一覧に表示するイベント" });
  const otherPoll = await createPoll({}, "poll-test-other-organizer");

  const unauthorized = await request("/api/polls");
  assert.equal(unauthorized.response.status, 401);

  const history = await request("/api/polls", {
    headers: { "X-Test-User-Id": "poll-test-organizer" },
  });
  assert.equal(history.response.status, 200);
  const ownSummary = history.body.find((poll) => poll.shareId === ownPoll.shareId);
  assert.ok(ownSummary);
  assert.equal(ownSummary.note, "一覧に表示するイベント");
  assert.equal(ownSummary.responseCount, 0);
  assert.equal(history.body.some((poll) => poll.shareId === otherPoll.shareId), false);
  assert.equal(history.body.some((poll) => "adminKey" in poll), false);
});

test("専用トークンで以前のイベントを現在の主催者へ一度だけ引き継げる", async () => {
  seedLegacyPoll();

  const unauthenticated = await request(`/api/polls/${legacyTestShareId}/legacy-claim`, {
    method: "POST",
    body: JSON.stringify({ claimToken: "legacy-claim-test-token-1234" }),
  });
  assert.equal(unauthenticated.response.status, 401);

  const invalidToken = await request(`/api/polls/${legacyTestShareId}/legacy-claim`, {
    method: "POST",
    headers: { "X-Test-User-Id": "legacy-owner" },
    body: JSON.stringify({ claimToken: "invalid-legacy-claim-token" }),
  });
  assert.equal(invalidToken.response.status, 403);

  const claimed = await request(`/api/polls/${legacyTestShareId}/legacy-claim`, {
    method: "POST",
    headers: { "X-Test-User-Id": "legacy-owner" },
    body: JSON.stringify({ claimToken: "legacy-claim-test-token-1234" }),
  });
  assert.equal(claimed.response.status, 200);
  assert.equal(claimed.body.canManage, true);

  const history = await request("/api/polls", {
    headers: { "X-Test-User-Id": "legacy-owner" },
  });
  assert.equal(
    history.body.some((poll) => poll.shareId === legacyTestShareId),
    true,
  );

  const otherAccount = await request(`/api/polls/${legacyTestShareId}/legacy-claim`, {
    method: "POST",
    headers: { "X-Test-User-Id": "other-owner" },
    body: JSON.stringify({ claimToken: "legacy-claim-test-token-1234" }),
  });
  assert.equal(otherAccount.response.status, 409);
});

test("主催者はタイトルと詳細を変更し、既存回答を保持して候補日を追加できる", async () => {
  const poll = await createPoll({ note: "変更前" });
  const submitted = await request(`/api/polls/${poll.shareId}/responses`, {
    method: "POST",
    body: JSON.stringify({
      name: "回答者",
      answers: ["yes", "maybe"],
      comment: "既存の回答",
    }),
  });
  assert.equal(submitted.response.status, 201);

  const updated = await request(`/api/polls/${poll.shareId}`, {
    method: "PATCH",
    headers: { "X-Test-User-Id": "poll-test-organizer" },
    body: JSON.stringify({
      title: "変更後のイベント",
      note: "変更後の詳細",
      newCandidates: ["2026年9月12日"],
    }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.title, "変更後のイベント");
  assert.equal(updated.body.note, "変更後の詳細");
  assert.deepEqual(updated.body.candidates.map((candidate) => candidate.label), [
    "2026年9月10日",
    "2026年9月11日",
    "2026年9月12日",
  ]);
  assert.deepEqual(updated.body.responses[0].answers, ["yes", "maybe"]);
  assert.equal(updated.body.candidates[0].yesCount, 1);
  assert.equal(updated.body.candidates[1].maybeCount, 1);
  assert.equal(updated.body.candidates[2].noCount, 0);
});

test("未認証ユーザーと別の主催者はイベントを編集できない", async () => {
  const poll = await createPoll();
  const body = JSON.stringify({
    title: "不正な変更",
    note: "",
    newCandidates: [],
  });

  const unauthorized = await request(`/api/polls/${poll.shareId}`, {
    method: "PATCH",
    body,
  });
  assert.equal(unauthorized.response.status, 401);

  const forbidden = await request(`/api/polls/${poll.shareId}`, {
    method: "PATCH",
    headers: { "X-Test-User-Id": "poll-test-other-organizer" },
    body,
  });
  assert.equal(forbidden.response.status, 403);
});

test("締め切られたイベントは編集できない", async () => {
  const poll = await createPoll({ deadline: "2020-01-01T00:00:00.000Z" });
  const updated = await request(`/api/polls/${poll.shareId}`, {
    method: "PATCH",
    headers: { "X-Test-User-Id": "poll-test-organizer" },
    body: JSON.stringify({
      title: "締切後の変更",
      note: "",
      newCandidates: [],
    }),
  });
  assert.equal(updated.response.status, 409);
});

test("候補日は既存分と追加分を合わせて20件までに制限する", async () => {
  const poll = await createPoll({
    candidates: Array.from({ length: 20 }, (_, index) => `候補${index + 1}`),
  });
  const updated = await request(`/api/polls/${poll.shareId}`, {
    method: "PATCH",
    headers: { "X-Test-User-Id": "poll-test-organizer" },
    body: JSON.stringify({
      title: poll.title,
      note: "",
      newCandidates: ["21件目"],
    }),
  });
  assert.equal(updated.response.status, 400);
  assert.equal(updated.body.error, "候補日は合計20件までです。");
});

test("管理キーは作成時だけ発行され、公開URLから確定できない", async () => {
  const poll = await createPoll();

  const publicPoll = await request(`/api/polls/${poll.shareId}`);
  assert.equal(publicPoll.response.status, 200);
  assert.equal("adminKey" in publicPoll.body, false);
  assert.equal(publicPoll.body.confirmedCandidateId, null);

  const withoutAdminKey = await request(
    `/api/polls/${poll.shareId}/confirmation`,
    {
      method: "POST",
      body: JSON.stringify({ candidateId: poll.candidates[0].id }),
    },
  );
  assert.equal(withoutAdminKey.response.status, 401);

  const withInvalidAdminKey = await request(
    `/api/polls/${poll.shareId}/confirmation`,
    {
      method: "POST",
      headers: { "X-Admin-Key": "invalid-admin-key-123456" },
      body: JSON.stringify({ candidateId: poll.candidates[0].id }),
    },
  );
  assert.equal(withInvalidAdminKey.response.status, 403);
});

test("作成した主催者はログイン状態で管理URLなしでも開催日を確定できる", async () => {
  const poll = await createPoll();

  const organizerView = await request(`/api/polls/${poll.shareId}`, {
    headers: { "X-Test-User-Id": "poll-test-organizer" },
  });
  assert.equal(organizerView.response.status, 200);
  assert.equal(organizerView.body.canManage, true);

  const confirmed = await request(
    `/api/polls/${poll.shareId}/confirmation`,
    {
      method: "POST",
      headers: { "X-Test-User-Id": "poll-test-organizer" },
      body: JSON.stringify({ candidateId: poll.candidates[0].id }),
    },
  );
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.confirmedCandidateId, poll.candidates[0].id);
});

test("正しい管理キーで確定すると公開結果に反映され、回答が締め切られる", async () => {
  const poll = await createPoll();
  const candidateId = poll.candidates[1].id;

  const confirmed = await request(
    `/api/polls/${poll.shareId}/confirmation`,
    {
      method: "POST",
      headers: { "X-Admin-Key": poll.adminKey },
      body: JSON.stringify({ candidateId }),
    },
  );
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.confirmedCandidateId, candidateId);
  assert.equal(confirmed.body.isClosed, true);
  assert.equal("adminKey" in confirmed.body, false);

  const publicPoll = await request(`/api/polls/${poll.shareId}`);
  assert.equal(publicPoll.response.status, 200);
  assert.equal(publicPoll.body.confirmedCandidateId, candidateId);
  assert.equal(publicPoll.body.isClosed, true);

  const responseAfterConfirmation = await request(
    `/api/polls/${poll.shareId}/responses`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "締切後の回答者",
        answers: ["yes", "maybe"],
      }),
    },
  );
  assert.equal(responseAfterConfirmation.response.status, 409);
});

test("締切日時を過ぎた出欠表への回答を拒否する", async () => {
  const poll = await createPoll({
    deadline: "2020-01-01T00:00:00.000Z",
  });

  const publicPoll = await request(`/api/polls/${poll.shareId}`);
  assert.equal(publicPoll.response.status, 200);
  assert.equal(publicPoll.body.isClosed, true);

  const responseAfterDeadline = await request(
    `/api/polls/${poll.shareId}/responses`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "期限後の回答者",
        answers: ["yes", "no"],
      }),
    },
  );
  assert.equal(responseAfterDeadline.response.status, 409);
});