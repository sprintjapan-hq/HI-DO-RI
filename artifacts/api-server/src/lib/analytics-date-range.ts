const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type AnalyticsDateQuery =
  | { ok: true; start: string | null; end: string | null }
  | { ok: false; error: string };

function parseCalendarDay(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const match = CALENDAR_DAY.exec(trimmed);
  if (!match) return "invalid";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return "invalid";
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseAnalyticsDateQuery(
  startRaw: unknown,
  endRaw: unknown,
): AnalyticsDateQuery {
  const start = parseCalendarDay(startRaw);
  const end = parseCalendarDay(endRaw);
  if (start === "invalid" || end === "invalid") {
    return { ok: false, error: "日付は実在する YYYY-MM-DD で指定してください。" };
  }
  if (start && end && start > end) {
    return { ok: false, error: "開始日は終了日以前にしてください。" };
  }
  return { ok: true, start, end };
}

/** Inclusive bound: 00:00:00.000 in Asia/Tokyo. */
export function jstDayStart(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, -9, 0, 0, 0));
}

/** Exclusive bound: 00:00:00.000 of the next Asia/Tokyo calendar day. */
export function jstDayEndExclusive(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, -9, 0, 0, 0));
}
