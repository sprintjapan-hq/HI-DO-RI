/** Legacy labels use Tokyo time. Use the poll's creation year, not the cleanup year. */
export function parseCandidateLabelTime(label: string, referenceDate: Date) {
  const normalized = label.normalize("NFKC").trim();
  
  // Pattern 1: Full range with start and end time (e.g., "12/1(火) 15:00〜16:00")
  const fullMatch = normalized.match(
    /^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})(?:\([^)]*\))?\s+(\d{1,2}):(\d{2})\s*[〜～~\-–—]\s*(\d{1,2}):(\d{2})$/,
  );
  
  if (fullMatch) {
    if (!Number.isFinite(referenceDate.getTime())) return null;
    const year = fullMatch[1] ? Number(fullMatch[1]) : Number(
      new Intl.DateTimeFormat("en", { timeZone: "Asia/Tokyo", year: "numeric" }).format(referenceDate),
    );
    const [month, day, startHour, startMinute, endHour, endMinute] = fullMatch.slice(2).map(Number);
    if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31 ||
      startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null;
    const localDate = new Date(Date.UTC(year, month - 1, day));
    if (localDate.getUTCFullYear() !== year || localDate.getUTCMonth() !== month - 1 ||
      localDate.getUTCDate() !== day) return null;
    const startAt = new Date(Date.UTC(year, month - 1, day, startHour - 9, startMinute));
    const endAt = new Date(Date.UTC(year, month - 1, day, endHour - 9, endMinute));
    return endAt > startAt ? { startAt, endAt } : null;
  }
  
  // Pattern 2: Only start time (e.g., "12/1(火) 15:00"), default to 60 minutes duration
  const startOnlyMatch = normalized.match(
    /^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})(?:\([^)]*\))?\s+(\d{1,2}):(\d{2})$/,
  );
  
  if (startOnlyMatch) {
    if (!Number.isFinite(referenceDate.getTime())) return null;
    const year = startOnlyMatch[1] ? Number(startOnlyMatch[1]) : Number(
      new Intl.DateTimeFormat("en", { timeZone: "Asia/Tokyo", year: "numeric" }).format(referenceDate),
    );
    const [month, day, startHour, startMinute] = startOnlyMatch.slice(2).map(Number);
    if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31 ||
      startHour > 23 || startMinute > 59) return null;
    const localDate = new Date(Date.UTC(year, month - 1, day));
    if (localDate.getUTCFullYear() !== year || localDate.getUTCMonth() !== month - 1 ||
      localDate.getUTCDate() !== day) return null;
    const startAt = new Date(Date.UTC(year, month - 1, day, startHour - 9, startMinute));
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000); // Default 60 minutes
    return { startAt, endAt };
  }
  
  return null;
}

export function resolveCandidateTime(
  candidate: { label: string; startAt: Date | null; endAt: Date | null },
  referenceDate: Date,
) {
  const parsed = candidate.startAt && candidate.endAt ? null :
    parseCandidateLabelTime(candidate.label, candidate.startAt ?? candidate.endAt ?? referenceDate);
  const startAt = candidate.startAt ?? parsed?.startAt;
  const endAt = candidate.endAt ?? parsed?.endAt;
  return startAt && endAt && Number.isFinite(startAt.getTime()) &&
    Number.isFinite(endAt.getTime()) && endAt > startAt ? { startAt, endAt } : null;
}
