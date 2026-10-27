import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import http from "node:http";
import net from "node:net";

const requireDb = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Client } = requireDb("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL });
const owner = `calendar-sync-test-edit-${randomUUID()}`;
const createdIds = [];
let server;
let google;
let base;
let deleteStatus = 204;
const deletedEvents = [];

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
      res.writeHead(deleteStatus).end();
    } else {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(req.method === "POST" ? { id: JSON.parse(data).id } : { items: [] }));
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
