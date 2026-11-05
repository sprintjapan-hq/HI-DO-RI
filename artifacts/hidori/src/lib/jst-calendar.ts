const jstDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function jstCalendarDay(date: Date): string {
  const parts = jstDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("日本時間の日付を作れませんでした。");
  }
  return `${year}-${month}-${day}`;
}

/** Previous Asia/Tokyo calendar day relative to `now` (defaults to the current instant). */
export function previousJstCalendarDay(now: Date = new Date()): string {
  const [year, month, day] = jstCalendarDay(now).split("-").map(Number);
  const startOfTodayJst = new Date(Date.UTC(year, month - 1, day, -9, 0, 0, 0));
  return jstCalendarDay(new Date(startOfTodayJst.getTime() - 1));
}

export function formatJstDayLabel(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}

export function analyticsRangeLabel(start: string, end: string): string {
  if (!start && !end) return "累計（全期間）";
  if (start && end && start === end) return `${formatJstDayLabel(start)}（日本時間）`;
  if (start && end) {
    return `${formatJstDayLabel(start)}〜${formatJstDayLabel(end)}（日本時間）`;
  }
  if (start) return `${formatJstDayLabel(start)}以降（日本時間）`;
  return `${formatJstDayLabel(end)}まで（日本時間）`;
}
