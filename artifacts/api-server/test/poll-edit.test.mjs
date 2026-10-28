import { before, beforeEach, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import http from "node:http";
import net from "node:net";

const requireDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Client } = requireDb("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL });
let owner = `calendar-sync-test-edit-${randomUUID()}`;
const createdIds = [];
let server;
let google;
let base;
let deleteStatus = 204;
const deletedEvents = [];
let listStatus = 200;
let listedEvents = [];
let listPages = null;
const listRequests = [];
const googleEvents = new Map();
const createdGoogleEvents = [];

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
async function request(path, data, userId = owner, method = "POST") {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { "Content-Type": "application/json", "X-Test-User-Id": userId },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function create(withCalendar = false) {
  const candidates = ["候補A", "候補B", "候補C"];
  const { status, body } = await request("/polls", {
    title: `候補編集検証-${randomUUID()}`, candidates,
    ...(withCalendar ? {
      candidateSlots: candidates.map((label, i) => ({
        label, start: `2027-01-0${i + 1}T01:00:00Z`, end: `2027-01-0${i + 1}T02:00:00Z`,
      })),
    } : {}),
  });
  assert.equal(status, 201);
  createdIds.push(body.id);
  return body;
}
function edit(poll, changes) {
  return request(`/polls/${poll.shareId}`, {
    title: poll.title, note: poll.note, newCandidates: [],
    expectedCandidateIds: poll.candidates.map((candidate) => candidate.id),
    ...changes,
  }, owner, "PATCH");
}
before(async () => {
  await client.connect();
  const { rows: [db] } = await client.query("SELECT current_database() AS name, pg_is_in_recovery() AS replica");
  assert.equal(db.name, "heliumdb", "Integration test must use development only");
  assert.equal(db.replica, false);
  google = http.createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    if (req.method === "DELETE") {
      deletedEvents.push(req.url);
      if (deleteStatus === 204) {
        googleEvents.delete(new URL(req.url, "http://localhost").pathname.split("/").pop());
      }
      res.writeHead(deleteStatus).end();
    } else if (req.method === "GET" && new URL(req.url, "http://localhost").pathname.includes("/events/")) {
      const eventId = new URL(req.url, "http://localhost").pathname.split("/").pop();
      res.writeHead(googleEvents.has(eventId) ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(googleEvents.get(eventId) ?? { error: "missing" }));
    } else if (req.method === "GET") {
      listRequests.push(req.url);
      res.writeHead(listStatus, { "Content-Type": "application/json" });
      const pageToken = new URL(req.url, "http://localhost").searchParams.get("pageToken");
      res.end(JSON.stringify(listPages ? listPages[pageToken ?? "first"] :
        { items: [...listedEvents, ...googleEvents.values()] }));
    } else {
      res.setHeader("Content-Type", "application/json");
      const event = JSON.parse(data);
      const saved = { ...event, htmlLink: `https://calendar.test/events/${event.id}` };
      createdGoogleEvents.push(saved);
      googleEvents.set(saved.id, saved);
      res.end(JSON.stringify(saved));
    }
  });
  await new Promise((resolve) => google.listen(0, "127.0.0.1", resolve));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["--enable-source-maps", "dist/index.mjs"], {
    env: {
      ...process.env, NODE_ENV: "test", PORT: String(port),
      GOOGLE_CALENDAR_TEST_TOKEN: "local-edit-test-only",
      GOOGLE_CALENDAR_TEST_BASE_URL: `http://127.0.0.1:${google.address().port}`,
      FEATURE_REQUEST_SLACK_CHANNEL_ID: "",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try {
      const health = await fetch(`${base}/api/healthz`);
      if (health.ok && (await health.json()).status === "ok") return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Isolated API process did not start");
});
beforeEach(() => {
  owner = `calendar-sync-test-edit-${randomUUID()}`;
});
afterEach(() => {
  listStatus = 200;
  deleteStatus = 204;
  listedEvents = [];
  listPages = null;
  listRequests.length = 0;
  googleEvents.clear();
  createdGoogleEvents.length = 0;
});
after(async () => {
  server?.kill();
  if (google) await new Promise((resolve) => google.close(resolve));
  if (createdIds.length) await client.query("DELETE FROM public.polls WHERE id = ANY($1::int[])", [createdIds]);
  await client.end();
});

test("removing a middle candidate preserves other answers and updates organizer atomically", async () => {
  const poll = await create();
  await request(`/polls/${poll.shareId}/responses`, { name: "参加者", answers: ["yes", "maybe", "no"] });
  const edited = await edit(poll, {
    removedCandidateIds: [poll.candidates[1].id], newCandidates: ["追加候補"],
    organizerResponse: { name: "主催者", answers: ["no", "maybe", "yes"], comment: "自分の予定" },
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.candidates.map((c) => c.label), ["候補A", "候補C", "追加候補"]);
  assert.deepEqual(edited.body.responses.find((r) => r.name === "参加者").answers, ["yes", "no"]);
  assert.deepEqual(edited.body.responses.find((r) => r.name === "主催者").answers, ["no", "maybe", "yes"]);
  assert.equal(edited.body.candidates[2].yesCount, 1);
  assert.equal(edited.body.candidates[2].noCount, 0);
  const again = await edit(edited.body, { organizerResponse: { name: "主催者", answers: ["yes", "no", "maybe"] } });
  assert.equal(again.status, 200);
  assert.equal(again.body.responses.filter((r) => r.name === "主催者").length, 1);
  assert.deepEqual(again.body.responses.find((r) => r.name === "参加者").answers, ["yes", "no"]);
  const reloaded = await request(`/polls/${poll.shareId}`, undefined, owner, "GET");
  assert.deepEqual(reloaded.body.responses.find((r) => r.name === "主催者").answers, ["yes", "no", "maybe"]);
});

test("minimum, ownership, stale candidates and foreign candidate IDs cannot delete data", async () => {
  const poll = await create();
  assert.equal((await edit(poll, { removedCandidateIds: poll.candidates.slice(0, 2).map((c) => c.id) })).status, 400);
  assert.equal((await edit(poll, { removedCandidateIds: [-1] })).status, 400);
  assert.equal((await edit(poll, { expectedCandidateIds: [], removedCandidateIds: [poll.candidates[0].id] })).status, 409);
  const unauthorized = await request(`/polls/${poll.shareId}`, {
    title: "別人", note: "", newCandidates: [], expectedCandidateIds: poll.candidates.map((c) => c.id),
    removedCandidateIds: [poll.candidates[0].id],
  }, "another-owner", "PATCH");
  assert.equal(unauthorized.status, 403);
  const reloaded = await request(`/polls/${poll.shareId}`, undefined, owner, "GET");
  assert.equal(reloaded.body.candidates.length, 3);
  assert.equal(reloaded.body.title, poll.title);
});

test("deletion after an append keeps previously missing answers unanswered", async () => {
  const poll = await create();
  await request(`/polls/${poll.shareId}/responses`, { name: "参加者", answers: ["yes", "maybe", "no"] });
  const appended = await edit(poll, { newCandidates: ["未回答候補1", "未回答候補2"] });
  const edited = await edit(appended.body, { removedCandidateIds: [poll.candidates[0].id] });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.responses[0].answers, ["maybe", "no"]);
  assert.equal(edited.body.candidates[2].yesCount + edited.body.candidates[2].noCount + edited.body.candidates[2].maybeCount, 0);
});

test("calendar permission failure preserves data and returns reconnect code; retry removes only selected tentative event", async () => {
  const poll = await create(true);
  const removedId = poll.candidates[1].id;
  deleteStatus = 401;
  const failed = await edit(poll, { removedCandidateIds: [removedId] });
  assert.equal(failed.status, 409);
  assert.equal(failed.body.code, "google_calendar_reconnect_required");
  const unchanged = await request(`/polls/${poll.shareId}`, undefined, owner, "GET");
  assert.equal(unchanged.body.candidates.length, 3);
  const beforeCount = deletedEvents.length;
  deleteStatus = 204;
  const saved = await edit(poll, { removedCandidateIds: [removedId] });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.candidates.length, 2);
  assert.equal(deletedEvents.length - beforeCount, 1);
  const remaining = await client.query("SELECT candidate_id FROM poll_calendar_events WHERE poll_id = $1 ORDER BY candidate_id", [poll.id]);
  assert.deepEqual(remaining.rows.map((r) => r.candidate_id), [poll.candidates[0].id, poll.candidates[2].id]);
});

async function createLegacy(label) {
  const { status, body } = await request("/polls", {
    title: `ラベル候補の仮予定削除-${randomUUID()}`,
    candidates: ["待機候補A", "残す候補B", "残す候補C"],
  });
  assert.equal(status, 201);
  createdIds.push(body.id);
  await client.query("UPDATE poll_candidates SET label = $1 WHERE id = $2", [label, body.candidates[0].id]);
  body.candidates[0].label = label;
  const { rows } = await client.query(
    "SELECT start_at, end_at FROM poll_candidates WHERE id = $1", [body.candidates[0].id],
  );
  assert.equal(rows[0].start_at, null);
  assert.equal(rows[0].end_at, null);
  return body;
}
function legacyEvent(poll, overrides = {}) {
  return {
    id: `legacy-${randomUUID()}`, summary: `[仮] ${poll.title}`,
    start: { dateTime: "2026-11-02T14:00:00+09:00" },
    end: { dateTime: "2026-11-02T16:00:00+09:00" },
    ...overrides,
  };
}
for (const label of ["2026/11/2(月) 14:00〜16:00", "11/2(月) 14:00-16:00"]) {
  test(`null timestamps recover from label and delete only matching legacy tentative events: ${label}`, async () => {
    const poll = await createLegacy(label);
    // Anchor year independently of the machine's current year.
    await client.query("UPDATE polls SET created_at = $1 WHERE id = $2", ["2026-10-27T04:16:50Z", poll.id]);
    const matched = legacyEvent(poll);
    listedEvents = [
      matched,
      legacyEvent(poll, { summary: poll.title, extendedProperties: { private: { hidoriKind: "confirmed" } } }),
      legacyEvent(poll, { extendedProperties: { private: { hidoriKind: "tentative", hidoriShareId: "another-poll" } } }),
      legacyEvent(poll, { description: "https://example.com/p/another-poll" }),
      legacyEvent(poll, { start: { dateTime: "2026-11-02T15:00:00+09:00" } }),
      legacyEvent(poll, { summary: "[仮] 別のイベント" }),
    ];
    const before = deletedEvents.length;
    const edited = await edit(poll, { removedCandidateIds: [poll.candidates[0].id] });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.candidates.length, 2);
    assert.deepEqual(deletedEvents.slice(before), [`/calendar/v3/calendars/primary/events/${matched.id}?sendUpdates=none`]);
    const query = new URL(listRequests[0], "http://localhost").searchParams;
    assert.ok(new Date(query.get("timeMin")) < new Date(matched.start.dateTime));
    assert.ok(new Date(query.get("timeMax")) > new Date(matched.end.dateTime));
  });
}
for (const status of [401, 403, 500]) {
  test(`legacy calendar listing HTTP ${status} preserves candidates instead of reporting deletion success`, async () => {
    const poll = await createLegacy("2026/11/2(月) 14:00〜16:00");
    listStatus = status;
    const edited = await edit(poll, { removedCandidateIds: [poll.candidates[0].id] });
    assert.equal(edited.status, status === 500 ? 502 : 409);
    if (status !== 500) assert.equal(edited.body.code, "google_calendar_reconnect_required");
    const reloaded = await request(`/polls/${poll.shareId}`, undefined, owner, "GET");
    assert.equal(reloaded.body.candidates.length, 3);
  });
}
test("legacy calendar matching follows pagination before completing deletion", async () => {
  const poll = await createLegacy("2026/11/2(月) 14:00〜16:00");
  const matched = legacyEvent(poll);
  listPages = { first: { items: [], nextPageToken: "second-page" }, "second-page": { items: [matched] } };
  const before = deletedEvents.length;
  const edited = await edit(poll, { removedCandidateIds: [poll.candidates[0].id] });
  assert.equal(edited.status, 200);
  assert.equal(listRequests.length, 2);
  assert.ok(listRequests[1].includes("pageToken=second-page"));
  assert.deepEqual(deletedEvents.slice(before), [`/calendar/v3/calendars/primary/events/${matched.id}?sendUpdates=none`]);
});

test("edit-screen labels create tentative events, then finalize at the resolved JST time", async () => {
  const poll = await create();
  const saved = await edit(poll, { newCandidates: ["2026/11/2(月) 14:00〜16:00"] });
  assert.equal(saved.status, 200);
  const added = saved.body.candidates.at(-1);
  assert.equal(added.start, "2026-11-02T05:00:00.000Z");
  assert.equal(added.end, "2026-11-02T07:00:00.000Z");
  assert.equal(createdGoogleEvents.length, 1);
  const tentative = createdGoogleEvents[0];
  assert.equal(tentative.extendedProperties.private.hidoriKind, "tentative");
  assert.equal(tentative.start.dateTime, added.start);
  assert.equal(tentative.end.dateTime, added.end);

  const confirmed = await request(`/polls/${poll.shareId}/confirmation`, { candidateId: added.id });
  assert.equal(confirmed.status, 200);
  const rows = await client.query("SELECT candidate_id, kind FROM poll_calendar_events WHERE poll_id = $1", [poll.id]);
  assert.deepEqual(rows.rows, [{ candidate_id: added.id, kind: "confirmed" }]);
  assert.equal(googleEvents.has(tentative.id), false);
  assert.equal(createdGoogleEvents.at(-1).start.dateTime, added.start);
  assert.equal(createdGoogleEvents.at(-1).extendedProperties.private.hidoriKind, "confirmed");
});

test("legacy NULL timestamps create tentative events without rewriting the original candidate", async () => {
  const poll = await createLegacy("2026/11/2(月) 14:00〜16:00");
  const edited = await edit(poll, { newCandidates: ["残す候補D"] });
  assert.equal(edited.status, 200);
  assert.equal(createdGoogleEvents.length, 1);
  assert.equal(createdGoogleEvents[0].start.dateTime, "2026-11-02T05:00:00.000Z");
  const rows = await client.query("SELECT start_at, end_at FROM poll_candidates WHERE id = $1", [poll.candidates[0].id]);
  assert.deepEqual(rows.rows, [{ start_at: null, end_at: null }]);
});

test("five existing legacy tentative events are adopted across pages with no duplicate creation", async () => {
  const { status, body: poll } = await request("/polls", {
    title: `既存5件の取り込み-${randomUUID()}`,
    candidates: Array.from({ length: 5 }, (_, index) => `待機候補${index}`),
  });
  assert.equal(status, 201);
  createdIds.push(poll.id);
  const expectedIds = [];
  for (const [index, candidate] of poll.candidates.entries()) {
    const label = `2026/11/${index + 2}(月) 14:00〜16:00`;
    await client.query("UPDATE poll_candidates SET label = $1 WHERE id = $2", [label, candidate.id]);
    candidate.label = label;
    const event = legacyEvent(poll, {
      start: { dateTime: `2026-11-0${index + 2}T14:00:00+09:00` },
      end: { dateTime: `2026-11-0${index + 2}T16:00:00+09:00` },
    });
    listedEvents.push(event);
    expectedIds.push(event.id);
  }
  listPages = { first: { items: listedEvents.slice(0, 2), nextPageToken: "remaining" },
    remaining: { items: listedEvents.slice(2) } };
  const adopted = await edit(poll, { newCandidates: ["日程未定"] });
  assert.equal(adopted.status, 200);
  const mapped = await client.query(
    "SELECT candidate_id, google_event_id, kind FROM poll_calendar_events WHERE poll_id = $1 ORDER BY candidate_id", [poll.id],
  );
  assert.deepEqual(mapped.rows.map(row => row.google_event_id), expectedIds);
  assert.ok(mapped.rows.every(row => row.kind === "tentative"));
  assert.equal(createdGoogleEvents.length, 0);
  const again = await edit(adopted.body, { newCandidates: ["日程未定2"] });
  assert.equal(again.status, 200);
  assert.equal(createdGoogleEvents.length, 0);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM poll_calendar_events WHERE poll_id = $1", [poll.id])).rows[0].count, 5);
  await client.query("DELETE FROM poll_calendar_events WHERE poll_id = $1 AND candidate_id = $2",
    [poll.id, poll.candidates[0].id]);
  const repaired = await edit(again.body, { newCandidates: ["日程未定3"] });
  assert.equal(repaired.status, 200);
  assert.equal(createdGoogleEvents.length, 0);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM poll_calendar_events WHERE poll_id = $1", [poll.id])).rows[0].count, 5);
});

test("finalizing a NULL-timestamp candidate cleans up untracked label-matched tentative events", async () => {
  const poll = await createLegacy("2026/11/2(月) 14:00〜16:00");
  const orphan = legacyEvent(poll);
  listedEvents = [orphan];
  const before = deletedEvents.length;
  const confirmed = await request(`/polls/${poll.shareId}/confirmation`, { candidateId: poll.candidates[0].id });
  assert.equal(confirmed.status, 200);
  assert.ok(deletedEvents.slice(before).includes(`/calendar/v3/calendars/primary/events/${orphan.id}?sendUpdates=none`));
  const rows = await client.query("SELECT candidate_id, kind FROM poll_calendar_events WHERE poll_id = $1", [poll.id]);
  assert.deepEqual(rows.rows, [{ candidate_id: poll.candidates[0].id, kind: "confirmed" }]);
  assert.equal(createdGoogleEvents[0].start.dateTime, "2026-11-02T05:00:00.000Z");
  assert.equal(createdGoogleEvents[0].end.dateTime, "2026-11-02T07:00:00.000Z");
});

test("failed adoption lookup never creates duplicate tentative events", async () => {
  const poll = await createLegacy("2026/11/2(月) 14:00〜16:00");
  listStatus = 500;
  const edited = await edit(poll, { newCandidates: ["残す候補D"] });
  assert.equal(edited.status, 200);
  assert.equal(createdGoogleEvents.length, 0);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM poll_calendar_events WHERE poll_id = $1", [poll.id])).rows[0].count, 0);
});
