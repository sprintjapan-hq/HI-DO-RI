import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import {
  jstDayEndExclusive,
  jstDayStart,
  parseAnalyticsDateQuery,
} from "../src/lib/analytics-date-range.ts";
import {
  analyticsRangeLabel,
  previousJstCalendarDay,
} from "../../hidori/src/lib/jst-calendar.ts";

const operatorId = "analytics-date-test-operator";
const content = `v09-${randomUUID()}`;

describe("JST analytics date bounds", () => {
  test("parses omitted, blank, and real calendar days", () => {
    assert.deepEqual(parseAnalyticsDateQuery(undefined, undefined), {
      ok: true,
      start: null,
      end: null,
    });
    assert.deepEqual(parseAnalyticsDateQuery("", "  "), {
      ok: true,
      start: null,
      end: null,
    });
    assert.deepEqual(parseAnalyticsDateQuery(" 2026-11-04 ", "2026-11-05"), {
      ok: true,
      start: "2026-11-04",
      end: "2026-11-05",
    });
  });

  test("rejects impossible days, bad shapes, and reversed ranges", () => {
    for (const value of ["2026-02-29", "2026-13-01", "2026/11/05", "yesterday", "2026-11-05T00:00:00"]) {
      const parsed = parseAnalyticsDateQuery(value, undefined);
      assert.equal(parsed.ok, false);
    }
    assert.equal(parseAnalyticsDateQuery(["2026-11-05"], undefined).ok, false);
    const reversed = parseAnalyticsDateQuery("2026-11-05", "2026-11-04");
    assert.equal(reversed.ok, false);
    assert.equal(parseAnalyticsDateQuery("2024-02-29", "2024-02-29").ok, true);
  });

  test("converts calendar days to Asia/Tokyo instants, not UTC midnights", () => {
    assert.equal(jstDayStart("2026-11-05").toISOString(), "2026-11-04T15:00:00.000Z");
    assert.equal(jstDayEndExclusive("2026-11-05").toISOString(), "2026-11-05T15:00:00.000Z");
    assert.equal(jstDayStart("2026-01-01").toISOString(), "2025-12-31T15:00:00.000Z");
    assert.equal(jstDayEndExclusive("2024-02-29").toISOString(), "2024-02-29T15:00:00.000Z");
  });

  test("yesterday is the previous Asia/Tokyo calendar day", () => {
    assert.equal(previousJstCalendarDay(new Date("2026-11-05T14:59:00.000Z")), "2026-11-04");
    assert.equal(previousJstCalendarDay(new Date("2026-11-05T15:30:00.000Z")), "2026-11-05");
    assert.equal(previousJstCalendarDay(new Date("2026-03-01T00:30:00.000Z")), "2026-02-28");
    assert.equal(previousJstCalendarDay(new Date("2024-03-01T00:30:00.000Z")), "2024-02-29");
    assert.equal(previousJstCalendarDay(new Date("2026-01-01T00:30:00.000Z")), "2025-12-31");
  });

  test("active range label stays cumulative until a day is set", () => {
    assert.equal(analyticsRangeLabel("", ""), "累計（全期間）");
    assert.equal(analyticsRangeLabel("2026-11-04", "2026-11-04"), "2026年11月4日（日本時間）");
    assert.equal(
      analyticsRangeLabel("2026-11-04", "2026-11-06"),
      "2026年11月4日〜2026年11月6日（日本時間）",
    );
    assert.equal(analyticsRangeLabel("2026-11-04", ""), "2026年11月4日以降（日本時間）");
    assert.equal(analyticsRangeLabel("", "2026-11-04"), "2026年11月4日まで（日本時間）");
  });
});

describe("GET /api/analytics/stats date filter", () => {
  let baseUrl;
  let serverProcess;

  function sql(statement) {
    return execFileSync(
      "psql",
      [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-At", "-c", statement],
      { encoding: "utf8" },
    ).trim();
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

  async function request(path, userId) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: userId ? { "X-Test-User-Id": userId } : {},
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { response, body };
  }

  function countOf(body, event, campaign) {
    return body.eventCounts
      .filter((row) => row.event === event && row.utmCampaign === campaign && row.utmContent === content)
      .reduce((sum, row) => sum + row.count, 0);
  }

  function assertFilteredWithinCumulative(filtered, cumulative) {
    const totals = new Map();
    for (const row of cumulative.eventCounts) {
      const key = [row.event, row.utmSource, row.utmCampaign, row.utmContent].join("|");
      totals.set(key, row.count);
    }
    for (const row of filtered.eventCounts) {
      const key = [row.event, row.utmSource, row.utmCampaign, row.utmContent].join("|");
      const total = totals.get(key) ?? 0;
      assert.ok(
        row.count <= total,
        `${key}: filtered ${row.count} is above cumulative ${total}`,
      );
    }
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
        CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY || "sk_test_analytics_date_filter",
      },
      stdio: "ignore",
    });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}/api/healthz`);
        if (response.ok) break;
      } catch {
        // Server is still starting.
      }
      if (attempt === 59) throw new Error("API server did not become ready");
      await wait(50);
    }

    sql(`INSERT INTO analytics_events (created_at, event, path, utm_source, utm_campaign, utm_content)
      VALUES
        ('2026-11-04T14:59:59.999Z', 'page_view', '/p/v09', 'v09', 'v09-range', '${content}'),
        ('2026-11-04T15:00:00.000Z', 'page_view', '/p/v09', 'v09', 'v09-range', '${content}'),
        ('2026-11-05T14:59:59.999Z', 'page_view', '/p/v09', 'v09', 'v09-range', '${content}'),
        ('2026-11-05T15:00:00.000Z', 'page_view', '/p/v09', 'v09', 'v09-range', '${content}'),
        ('2026-11-05T01:00:00.000Z', 'login_start', '/p/v09', 'v09', 'v09-range', '${content}'),
        ('2026-11-04T16:00:00.000Z', 'page_view', '/p/v09', 'v09', 'hd-verify', '${content}');`);
  });

  after(() => {
    serverProcess?.kill();
    if (process.env.DATABASE_URL) {
      sql(`DELETE FROM analytics_events WHERE utm_content = '${content}';`);
    }
  });

  test("omitted dates stay cumulative and still drop hd-verify", async () => {
    const omitted = await request("/api/analytics/stats", operatorId);
    const blank = await request("/api/analytics/stats?start=&end=", operatorId);
    assert.equal(omitted.response.status, 200);
    assert.equal(blank.response.status, 200);
    assert.equal(countOf(omitted.body, "page_view", "v09-range"), 4);
    assert.equal(countOf(blank.body, "page_view", "v09-range"), 4);
    assert.equal(countOf(omitted.body, "login_start", "v09-range"), 1);
    assert.equal(countOf(omitted.body, "page_view", "hd-verify"), 0);
    assert.equal(countOf(blank.body, "page_view", "hd-verify"), 0);
    assert.ok("trackingStartedAt" in omitted.body);
    assert.ok(Array.isArray(omitted.body.eventCounts));
  });

  test("a JST calendar day includes Tokyo midnight and excludes the next midnight", async () => {
    const cumulative = await request("/api/analytics/stats", operatorId);
    const yesterday = await request(
      "/api/analytics/stats?start=2026-11-04&end=2026-11-04",
      operatorId,
    );
    const nov5 = await request(
      "/api/analytics/stats?start=2026-11-05&end=2026-11-05",
      operatorId,
    );
    assert.equal(yesterday.response.status, 200);
    assert.equal(nov5.response.status, 200);
    assert.equal(countOf(yesterday.body, "page_view", "v09-range"), 1);
    assert.equal(countOf(nov5.body, "page_view", "v09-range"), 2);
    assert.equal(countOf(nov5.body, "login_start", "v09-range"), 1);
    assert.equal(countOf(nov5.body, "page_view", "hd-verify"), 0);
    assert.equal(countOf(yesterday.body, "page_view", "hd-verify"), 0);
    assertFilteredWithinCumulative(yesterday.body, cumulative.body);
    assertFilteredWithinCumulative(nov5.body, cumulative.body);
  });

  test("one-sided bounds and include-verify stay inside the cumulative totals", async () => {
    const cumulative = await request("/api/analytics/stats?excludeVerify=false", operatorId);
    const fromNov5 = await request(
      "/api/analytics/stats?excludeVerify=false&start=2026-11-05",
      operatorId,
    );
    const throughNov4 = await request(
      "/api/analytics/stats?excludeVerify=false&end=2026-11-04",
      operatorId,
    );
    assert.equal(countOf(cumulative.body, "page_view", "hd-verify"), 1);
    assert.equal(countOf(fromNov5.body, "page_view", "v09-range"), 3);
    assert.equal(countOf(fromNov5.body, "page_view", "hd-verify"), 1);
    assert.equal(countOf(throughNov4.body, "page_view", "v09-range"), 1);
    assert.equal(countOf(throughNov4.body, "page_view", "hd-verify"), 0);
    assertFilteredWithinCumulative(fromNov5.body, cumulative.body);
    assertFilteredWithinCumulative(throughNov4.body, cumulative.body);
  });

  test("invalid dates are 400 and non-operators stay 401 or 403", async () => {
    const missingDay = await request("/api/analytics/stats?start=2026-02-29", operatorId);
    const reversed = await request(
      "/api/analytics/stats?start=2026-11-05&end=2026-11-04",
      operatorId,
    );
    const anonymous = await request("/api/analytics/stats?start=2026-11-04&end=2026-11-04");
    const stranger = await request(
      "/api/analytics/stats?start=not-a-date",
      "ordinary-user",
    );
    assert.equal(missingDay.response.status, 400);
    assert.equal(reversed.response.status, 400);
    assert.equal(anonymous.response.status, 401);
    assert.equal(stranger.response.status, 403);
  });
});
