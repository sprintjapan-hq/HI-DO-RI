import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildParticipantCalendarLinks,
  calendarEventUid,
  icsFilename,
} from "../../hidori/src/lib/calendar-links.ts";

const now = new Date("2026-11-11T12:32:00.000Z");
const shareUrl = "https://example.com/p/share1";

function timedInput(overrides = {}) {
  return {
    shareId: "share1",
    title: "打ち合わせ,確認",
    shareUrl,
    label: "2026/11/12(木) 19:00〜20:30",
    start: "2026-11-12T19:00:00+09:00",
    end: "2026-11-12T20:30:00+09:00",
    referenceDate: "2026-11-01T00:00:00.000Z",
    now,
    ...overrides,
  };
}

function unfoldIcs(ics) {
  return ics.replaceAll("\r\n ", "").replaceAll("\r\n\t", "");
}

describe("participant calendar links", () => {
  test("encodes a Japanese title in the Google template URL and keeps JST wall time in UTC", () => {
    const links = buildParticipantCalendarLinks(timedInput());
    assert.ok(links);
    const url = new URL(links.googleUrl);
    assert.equal(url.origin + url.pathname, "https://calendar.google.com/calendar/render");
    assert.equal(url.searchParams.get("action"), "TEMPLATE");
    assert.equal(url.searchParams.get("text"), "打ち合わせ,確認");
    assert.equal(url.searchParams.get("dates"), "20261112T100000Z/20261112T113000Z");
    assert.equal(url.searchParams.get("details"), `出欠表: ${shareUrl}`);
    assert.equal(url.searchParams.get("ctz"), "Asia/Tokyo");
    assert.match(links.googleUrl, /text=%E6%89%93%E3%81%A1%E5%90%88%E3%82%8F%E3%81%9B/);
    assert.match(links.googleUrl, /%2C/);
    assert.equal(links.googleUrl.includes("text=打ち合わせ"), false);
    assert.equal(links.allDay, false);
  });

  test("converts a Tokyo morning that is still the previous UTC day", () => {
    const links = buildParticipantCalendarLinks(timedInput({
      title: "朝会",
      start: "2026-11-12T08:30:00+09:00",
      end: "2026-11-12T09:00:00+09:00",
      label: "2026/11/12(木) 08:30〜09:00",
    }));
    const url = new URL(links.googleUrl);
    assert.equal(url.searchParams.get("dates"), "20261111T233000Z/20261112T000000Z");
    assert.match(unfoldIcs(links.ics), /DTSTART:20261111T233000Z\r\nDTEND:20261112T000000Z\r\n/);
  });

  test("reads a Japanese label in Tokyo time when stored instants are missing", () => {
    const links = buildParticipantCalendarLinks(timedInput({
      start: null,
      end: null,
      label: "2026/11/2(月) 14:00〜16:00",
    }));
    const url = new URL(links.googleUrl);
    assert.equal(url.searchParams.get("dates"), "20261102T050000Z/20261102T070000Z");
  });

  test("uses the label end before the one-hour default, and one hour when no end exists", () => {
    const fromLabel = buildParticipantCalendarLinks(timedInput({
      start: "2026-11-12T19:00:00+09:00",
      end: null,
      label: "2026/11/12(木) 19:00〜20:30",
    }));
    assert.equal(
      new URL(fromLabel.googleUrl).searchParams.get("dates"),
      "20261112T100000Z/20261112T113000Z",
    );

    const oneHour = buildParticipantCalendarLinks(timedInput({
      start: "2026-11-12T19:00:00+09:00",
      end: null,
      label: "候補A",
    }));
    assert.equal(
      new URL(oneHour.googleUrl).searchParams.get("dates"),
      "20261112T100000Z/20261112T110000Z",
    );

    const ninety = buildParticipantCalendarLinks(timedInput({
      start: "2026-11-12T19:00:00+09:00",
      end: null,
      label: "候補A",
      durationMinutes: 90,
    }));
    assert.equal(
      new URL(ninety.googleUrl).searchParams.get("dates"),
      "20261112T100000Z/20261112T113000Z",
    );
  });

  test("prefers stored instants over a different label", () => {
    const links = buildParticipantCalendarLinks(timedInput({
      label: "2026/11/12(木) 09:00〜10:00",
    }));
    assert.equal(
      new URL(links.googleUrl).searchParams.get("dates"),
      "20261112T100000Z/20261112T113000Z",
    );
  });

  test("escapes commas, semicolons, backslashes, and newlines and uses CRLF", () => {
    const links = buildParticipantCalendarLinks(timedInput({
      title: "会議,A;B\\C\n次の行",
      shareUrl: "https://example.com/p/a,b;c\\d",
    }));
    const unfolded = unfoldIcs(links.ics);
    assert.match(unfolded, /SUMMARY:会議\\,A\\;B\\\\C\\n次の行\r\n/);
    assert.match(unfolded, /DESCRIPTION:出欠表: https:\/\/example.com\/p\/a\\,b\\;c\\\\d\r\n/);
    assert.match(unfolded, /UID:share1@hidori\r\n/);
    assert.match(unfolded, /DTSTAMP:20261111T123200Z\r\n/);
    assert.equal(links.ics.endsWith("\r\n"), true);
    const withoutBreaks = links.ics.replaceAll("\r\n", "");
    assert.equal(withoutBreaks.includes("\n"), false);
    assert.equal(withoutBreaks.includes("\r"), false);
  });

  test("folds long lines on CRLF and keeps the share URL intact", () => {
    const longUrl = `https://example.com/p/${"a".repeat(120)}`;
    const links = buildParticipantCalendarLinks(timedInput({ shareUrl: longUrl }));
    assert.match(links.ics, /\r\n /);
    assert.match(unfoldIcs(links.ics), new RegExp(`DESCRIPTION:出欠表: ${longUrl}\\r\\n`));
  });

  test("writes an all-day event with DATE values and a Google all-day range", () => {
    const links = buildParticipantCalendarLinks(timedInput({
      title: "終日打ち合わせ",
      label: "2026/11/12",
      start: "2026-11-12",
      end: null,
    }));
    assert.equal(links.allDay, true);
    const url = new URL(links.googleUrl);
    assert.equal(url.searchParams.get("dates"), "20261112/20261113");
    assert.equal(url.searchParams.get("ctz"), "Asia/Tokyo");
    assert.equal(url.searchParams.get("text"), "終日打ち合わせ");
    const unfolded = unfoldIcs(links.ics);
    assert.match(unfolded, /DTSTART;VALUE=DATE:20261112\r\n/);
    assert.match(unfolded, /DTEND;VALUE=DATE:20261113\r\n/);
    assert.equal(/DTSTART:\d{8}T/.test(unfolded), false);

    const span = buildParticipantCalendarLinks(timedInput({
      allDay: true,
      start: "2026-11-12T00:00:00+09:00",
      end: "2026-11-14",
    }));
    assert.equal(new URL(span.googleUrl).searchParams.get("dates"), "20261112/20261114");
    assert.match(unfoldIcs(span.ics), /DTEND;VALUE=DATE:20261114\r\n/);
  });

  test("keeps the UID stable per poll and the filename ASCII", () => {
    const first = buildParticipantCalendarLinks(timedInput());
    const renamed = buildParticipantCalendarLinks(timedInput({
      title: "別の名前",
      start: "2026-11-13T19:00:00+09:00",
      end: "2026-11-13T20:00:00+09:00",
      now: new Date("2026-12-01T00:00:00.000Z"),
    }));
    assert.equal(first.uid, renamed.uid);
    assert.equal(first.uid, calendarEventUid("share1"));
    assert.equal(first.filename, "hidori-share1.ics");
    assert.equal(icsFilename("ab/c 会議"), "hidori-abc.ics");
    assert.match(icsFilename("ab/c 会議"), /^[A-Za-z0-9._-]+$/);
    assert.equal(first.filename.includes("打ち合わせ"), false);
  });

  test("v1.0: a manually typed start-only label (no stored instants) gets a 60 minute event", () => {
    const links = buildParticipantCalendarLinks(timedInput({
      start: null,
      end: null,
      label: "9/24(水) 19:00",
      referenceDate: "2026-11-14T06:00:00.000Z",
    }));
    assert.ok(links);
    assert.equal(
      new URL(links.googleUrl).searchParams.get("dates"),
      "20260924T100000Z/20260924T110000Z",
    );
    assert.match(unfoldIcs(links.ics), /DTSTART:20260924T100000Z\r\nDTEND:20260924T110000Z\r\n/);
    const full = buildParticipantCalendarLinks(timedInput({
      start: null,
      end: null,
      label: "2026/9/24(水) 19:00",
    }));
    assert.equal(new URL(full.googleUrl).searchParams.get("dates"), "20260924T100000Z/20260924T110000Z");
    assert.equal(buildParticipantCalendarLinks(timedInput({
      start: null,
      end: null,
      label: "9/24(水) 25:00",
    })), null);
  });

  test("returns nothing when a confirmed label has no resolvable time", () => {
    assert.equal(buildParticipantCalendarLinks(timedInput({
      start: null,
      end: null,
      label: "候補A",
    })), null);
    assert.equal(buildParticipantCalendarLinks(timedInput({
      allDay: true,
      start: "2026-02-31",
      end: null,
    })), null);
  });
});
