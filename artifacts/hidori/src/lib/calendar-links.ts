/**
 * Participant calendar links for a confirmed poll.
 *
 * Polls store candidate instants (`start` / `end`) and a display label.
 * There is no all-day flag and no stored slot duration. Date-only values
 * (`YYYY-MM-DD`) are treated as all-day. A missing end falls back to the
 * label's end, then to `durationMinutes`, then to 60 minutes. A label with a
 * start time only (the default "9/24(水) 19:00" format) is treated as 60 minutes.
 */

const DEFAULT_DURATION_MINUTES = 60;
const TIME_ZONE = "Asia/Tokyo";

export type ParticipantCalendarInput = {
  shareId: string;
  title: string;
  shareUrl: string;
  label?: string | null;
  start?: string | Date | null;
  end?: string | Date | null;
  /** Poll `createdAt`. Yearless labels use this instant's Tokyo year. */
  referenceDate?: string | Date | null;
  /**
   * Used only when the end instant is absent from both the stored value and the label.
   * Omit to use 60 minutes. The poll schema does not store a duration.
   */
  durationMinutes?: number | null;
  /**
   * Force an all-day event. The poll schema has no such column; date-only
   * `start` values are all-day even when this is omitted.
   */
  allDay?: boolean | null;
  /** Clock used for `DTSTAMP`. Defaults to the current instant. */
  now?: Date;
};

export type ParticipantCalendarLinks = {
  allDay: boolean;
  uid: string;
  filename: string;
  googleUrl: string;
  ics: string;
};

type ResolvedEvent =
  | { allDay: true; startDate: string; endDate: string }
  | { allDay: false; start: Date; end: Date };

export function calendarEventUid(shareId: string): string {
  return `${safeToken(shareId) || "poll"}@hidori`;
}

export function icsFilename(shareId: string): string {
  return `hidori-${safeToken(shareId) || "event"}.ics`;
}

export function buildParticipantCalendarLinks(
  input: ParticipantCalendarInput,
): ParticipantCalendarLinks | null {
  const dateShapedStart = typeof input.start === "string" && looksLikeDateOnly(input.start);
  const resolved = input.allDay || dateShapedStart ? resolveAllDay(input) : resolveTimed(input);
  if (!resolved) return null;

  const now = input.now && Number.isFinite(input.now.getTime()) ? input.now : new Date();
  const uid = calendarEventUid(input.shareId);
  const description = `出欠表: ${input.shareUrl}`;
  const dates = resolved.allDay
    ? `${compactDate(resolved.startDate)}/${compactDate(resolved.endDate)}`
    : `${formatUtcStamp(resolved.start)}/${formatUtcStamp(resolved.end)}`;

  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", input.title);
  params.set("dates", dates);
  params.set("details", description);
  params.set("ctz", TIME_ZONE);

  return {
    allDay: resolved.allDay,
    uid,
    filename: icsFilename(input.shareId),
    googleUrl: `https://calendar.google.com/calendar/render?${params.toString()}`,
    ics: renderIcs({
      uid,
      title: input.title,
      description,
      resolved,
      now,
    }),
  };
}

function resolveAllDay(
  input: ParticipantCalendarInput,
): { allDay: true; startDate: string; endDate: string } | null {
  const startDateOnly = dateOnlyValue(input.start);
  if (!input.allDay && !startDateOnly) return null;

  const startDate = startDateOnly ?? tokyoDate(input.start);
  if (!startDate) return null;

  const endDate = dateOnlyValue(input.end) ?? tokyoDate(input.end);
  return {
    allDay: true,
    startDate,
    endDate: endDate && endDate > startDate ? endDate : addCalendarDays(startDate, 1),
  };
}

function resolveTimed(input: ParticipantCalendarInput): { allDay: false; start: Date; end: Date } | null {
  const storedStart = instantValue(input.start);
  const storedEnd = instantValue(input.end);
  const parsed =
    storedStart && storedEnd
      ? null
      : parseCandidateLabelTime(input.label ?? "", storedStart ?? storedEnd ?? referenceDateOf(input));
  const start = storedStart ?? parsed?.startAt ?? null;
  let end = storedEnd ?? parsed?.endAt ?? null;
  if (!start) return null;
  if (!end) {
    end = new Date(start.getTime() + durationMinutesOf(input) * 60 * 1000);
  }
  if (!Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) return null;
  return { allDay: false, start, end };
}

/** Tokyo wall time, matching the server label resolver. Yearless labels use the reference year. */
function parseCandidateLabelTime(label: string, referenceDate: Date) {
  const match = label.normalize("NFKC").trim().match(
    /^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})(?:\([^)]*\))?\s+(\d{1,2}):(\d{2})(?:\s*[〜～~\-–—]\s*(\d{1,2}):(\d{2}))?$/,
  );
  if (!match || !Number.isFinite(referenceDate.getTime())) return null;
  const year = match[1]
    ? Number(match[1])
    : Number(new Intl.DateTimeFormat("en", { timeZone: TIME_ZONE, year: "numeric" }).format(referenceDate));
  const [month, day, startHour, startMinute] = match.slice(2, 6).map(Number);
  // The end time is optional: the default "9/24(水) 19:00" label has only a start.
  const hasEnd = match[6] !== undefined && match[7] !== undefined;
  const endHour = hasEnd ? Number(match[6]) : 0;
  const endMinute = hasEnd ? Number(match[7]) : 0;
  if (
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    startHour > 23 ||
    endHour > 23 ||
    startMinute > 59 ||
    endMinute > 59
  ) {
    return null;
  }
  const localDate = new Date(Date.UTC(year, month - 1, day));
  if (
    localDate.getUTCFullYear() !== year ||
    localDate.getUTCMonth() !== month - 1 ||
    localDate.getUTCDate() !== day
  ) {
    return null;
  }
  const startAt = new Date(Date.UTC(year, month - 1, day, startHour - 9, startMinute));
  if (!hasEnd) return { startAt, endAt: null as Date | null };
  const endAt = new Date(Date.UTC(year, month - 1, day, endHour - 9, endMinute));
  return endAt > startAt ? { startAt, endAt: endAt as Date | null } : null;
}

function renderIcs(input: {
  uid: string;
  title: string;
  description: string;
  resolved: ResolvedEvent;
  now: Date;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HI-DO-RI//participant-calendar//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${formatUtcStamp(input.now)}`,
  ];
  if (input.resolved.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${compactDate(input.resolved.startDate)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(input.resolved.endDate)}`);
  } else {
    lines.push(`DTSTART:${formatUtcStamp(input.resolved.start)}`);
    lines.push(`DTEND:${formatUtcStamp(input.resolved.end)}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(input.title)}`);
  lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.map(foldContentLine).join("\r\n")}\r\n`;
}

function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function foldContentLine(line: string): string {
  const encoder = new TextEncoder();
  let limit = 75;
  let octets = 0;
  let current = "";
  const parts: string[] = [];
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (current && octets + size > limit) {
      parts.push(current);
      current = char;
      octets = size;
      limit = 74;
    } else {
      current += char;
      octets += size;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function durationMinutesOf(input: ParticipantCalendarInput): number {
  const value = input.durationMinutes;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return DEFAULT_DURATION_MINUTES;
}

function referenceDateOf(input: ParticipantCalendarInput): Date {
  if (input.referenceDate instanceof Date && Number.isFinite(input.referenceDate.getTime())) {
    return input.referenceDate;
  }
  if (typeof input.referenceDate === "string") {
    const parsed = new Date(input.referenceDate);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}

function looksLikeDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateOnlyValue(value: string | Date | null | undefined): string | null {
  if (typeof value !== "string" || !looksLikeDateOnly(value)) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function instantValue(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== "string" || looksLikeDateOnly(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function tokyoDate(value: string | Date | null | undefined): string | null {
  const instant = instantValue(value);
  if (!instant) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  const nextMonth = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(utc.getUTCDate()).padStart(2, "0");
  return `${utc.getUTCFullYear()}-${nextMonth}-${nextDay}`;
}

function compactDate(isoDate: string): string {
  return isoDate.replaceAll("-", "");
}

function formatUtcStamp(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${date.getUTCFullYear()}${month}${day}T${hour}${minute}${second}Z`;
}

function safeToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
}
