const TIME_ZONE = "Asia/Tokyo";

function tokyoDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function tokyoOffsetDate(year: number, month: number, day: number, hour: number) {
  return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+09:00`);
}

function normalizeHour(hour: number, period?: string) {
  if ((period === "午後" || period === "夜") && hour < 12) return hour + 12;
  if (period === "午前" && hour === 12) return 0;
  return hour;
}

export function parseCondition(condition: string, now: Date) {
  const durationMatch = condition.match(/(\d+(?:\.\d+)?)\s*時間/);
  const minuteMatch = condition.match(/(\d+)\s*分/);
  const timeRangeMatch =
    condition.match(
      /(午前|午後|夜)?\s*(\d{1,2})(?::(\d{1,2}))?\s*時?\s*から\s*(午前|午後|夜)?\s*(\d{1,2})(?::(\d{1,2}))?\s*時(?!間)(?:\s*(?:まで|の間))?/,
    ) ??
    condition.match(
      /(午前|午後|夜)?\s*(\d{1,2})(?::(\d{1,2})|時)\s*[-–—〜～]\s*(午前|午後|夜)?\s*(\d{1,2})(?::(\d{1,2})|時)/,
    );
  const hourMatch = condition.match(/(午前|午後|夜)?\s*(\d{1,2})(?::(\d{1,2}))?\s*時(?!間)(?:以降|から)?/);
  
  // Improved period matching: support various forms like 午後3時間, 午前中, 午後に, 昼, 夕方, etc.
  // Match period words that are NOT immediately followed by digit+時 (but 時間 is OK)
  const periodMatch = condition.match(/(午前中?|午後|夜|昼|夕方)(?![0-9０-９]*時(?!間))/);
  
  const periodHours = periodMatch?.[1] === "午前" || periodMatch?.[1] === "午前中"
    ? { start: 9, end: 12 }
    : periodMatch?.[1] === "午後"
      ? { start: 13, end: 18 }
      : periodMatch?.[1] === "夜"
        ? { start: 18, end: 22 }
      : periodMatch?.[1] === "昼"
        ? { start: 11, end: 14 }
      : periodMatch?.[1] === "夕方"
        ? { start: 16, end: 19 }
        : null;
  const durationMinutes = durationMatch
    ? Number(durationMatch[1]) * 60
    : minuteMatch
      ? Number(minuteMatch[1])
      : 120;
  const startHour = timeRangeMatch
    ? normalizeHour(Number(timeRangeMatch[2]), timeRangeMatch[1])
    : hourMatch
      ? normalizeHour(Number(hourMatch[2]), hourMatch[1])
      : periodHours?.start ?? 19;
  const startMinute = Number(timeRangeMatch?.[3] ?? hourMatch?.[3] ?? 0);
  const endHour = timeRangeMatch
    ? normalizeHour(Number(timeRangeMatch[5]), timeRangeMatch[4])
    : periodHours?.end ?? 24;
  const endMinute = Number(timeRangeMatch?.[6] ?? 0);
  const startTimeMinutes = startHour * 60 + startMinute;
  const endTimeMinutes = endHour * 60 + endMinute;

  // Parse weekday constraints
  const weekdayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const allowedWeekdays = new Set<string>();
  const excludedWeekdays = new Set<string>();
  
  // Check for explicit exclusions: X曜を除く、X除く、X以外
  const exclusionPattern = /([月火水木金土日])曜?(?:を)?(?:除く|以外)/g;
  let exclusionMatch;
  while ((exclusionMatch = exclusionPattern.exec(condition)) !== null) {
    excludedWeekdays.add(exclusionMatch[1]);
  }
  
  // Check for weekday ranges: 月曜〜水曜、月-金
  const rangePattern = /([月火水木金土日])曜?[〜～\-–—]([月火水木金土日])曜?/g;
  let rangeMatch;
  while ((rangeMatch = rangePattern.exec(condition)) !== null) {
    const startDay = rangeMatch[1];
    const endDay = rangeMatch[2];
    const startIdx = weekdayNames.indexOf(startDay);
    const endIdx = weekdayNames.indexOf(endDay);
    if (startIdx !== -1 && endIdx !== -1) {
      // Include all days in range
      if (startIdx <= endIdx) {
        for (let i = startIdx; i <= endIdx; i++) {
          allowedWeekdays.add(weekdayNames[i]);
        }
      } else {
        // Wrap around (e.g., 金-月)
        for (let i = startIdx; i < weekdayNames.length; i++) {
          allowedWeekdays.add(weekdayNames[i]);
        }
        for (let i = 0; i <= endIdx; i++) {
          allowedWeekdays.add(weekdayNames[i]);
        }
      }
    }
  }
  
  // Check for specific weekdays: only when followed by 曜 or in runs like 月水金/火・木/火と木
  // Explicitly followed by 曜
  const explicitPattern = /([月火水木金土日])曜/g;
  let explicitMatch;
  while ((explicitMatch = explicitPattern.exec(condition)) !== null) {
    // Make sure it's not part of 曜日
    const beforeIdx = explicitMatch.index - 1;
    if (beforeIdx >= 0 && condition[beforeIdx] === '曜') continue;
    allowedWeekdays.add(explicitMatch[1]);
  }
  
  // Runs of weekday chars (月水金, 火・木, 火と木) - not preceded by digit or inside certain words
  const runPattern = /(?<![0-9０-９明来今毎曜])([月火水木金土日])(?:[・、と\s]*([月火水木金土日]))+/g;
  let runMatch;
  while ((runMatch = runPattern.exec(condition)) !== null) {
    // Extract all weekday characters from this match
    const runText = runMatch[0];
    for (const char of runText) {
      if (weekdayNames.includes(char)) {
        allowedWeekdays.add(char);
      }
    }
  }
  
  // Handle exclusions
  const excludeWeekend = condition.includes("土日を除く") || condition.includes("週末を除く");
  if (excludeWeekend) {
    excludedWeekdays.add("土");
    excludedWeekdays.add("日");
  }
  
  // Apply exclusions
  for (const day of excludedWeekdays) {
    allowedWeekdays.delete(day);
  }
  
  const dayType = condition.includes("平日") || excludeWeekend
    ? "weekday"
    : (condition.includes("土日") || condition.includes("週末")) && !excludeWeekend
      ? "weekend"
      : allowedWeekdays.size > 0
        ? "specific"
        : "all";

  const nowParts = tokyoDateParts(now);
  const currentYear = Number(nowParts.year);
  const currentMonth = Number(nowParts.month);
  const currentDay = Number(nowParts.day);

  let rangeStart: Date | null = null;
  let rangeEnd: Date | null = null;
  let invalidDateRange = false;
  let hasDateReference = false;

  const relativeMatch = condition.match(/(?:^|[、。\s])(明日|明後日|今週|来週|今月|来月)(?=$|[、。\sの])/);

  if (relativeMatch) {
    hasDateReference = true;
    const relative = relativeMatch[1];
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowParts = tokyoDateParts(tomorrow);

    if (relative === "明日") {
      rangeStart = tokyoOffsetDate(Number(tomorrowParts.year), Number(tomorrowParts.month), Number(tomorrowParts.day), 0);
      rangeEnd = new Date(rangeStart.getTime() + 24 * 60 * 60 * 1000);
    } else if (relative === "明後日") {
      const dayAfterTomorrow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      const parts = tokyoDateParts(dayAfterTomorrow);
      rangeStart = tokyoOffsetDate(Number(parts.year), Number(parts.month), Number(parts.day), 0);
      rangeEnd = new Date(rangeStart.getTime() + 24 * 60 * 60 * 1000);
    } else if (relative === "今週") {
      const weekday = ["日", "月", "火", "水", "木", "金", "土"].indexOf(nowParts.weekday);
      const daysUntilSunday = 7 - weekday;
      const nextSunday = new Date(now.getTime() + daysUntilSunday * 24 * 60 * 60 * 1000);
      const nextSundayParts = tokyoDateParts(nextSunday);
      rangeStart = tokyoOffsetDate(currentYear, currentMonth, currentDay, 0);
      rangeEnd = tokyoOffsetDate(Number(nextSundayParts.year), Number(nextSundayParts.month), Number(nextSundayParts.day), 24);
    } else if (relative === "来週") {
      const weekday = ["日", "月", "火", "水", "木", "金", "土"].indexOf(nowParts.weekday);
      const daysUntilNextMonday = weekday === 0 ? 1 : 8 - weekday;
      const nextMonday = new Date(now.getTime() + daysUntilNextMonday * 24 * 60 * 60 * 1000);
      const nextMondayParts = tokyoDateParts(nextMonday);
      rangeStart = tokyoOffsetDate(Number(nextMondayParts.year), Number(nextMondayParts.month), Number(nextMondayParts.day), 0);
      rangeEnd = new Date(rangeStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else if (relative === "今月") {
      const lastDayOfMonth = new Date(currentYear, currentMonth, 0);
      const lastDayParts = tokyoDateParts(lastDayOfMonth);
      rangeStart = tokyoOffsetDate(currentYear, currentMonth, currentDay, 0);
      rangeEnd = tokyoOffsetDate(Number(lastDayParts.year), Number(lastDayParts.month), Number(lastDayParts.day), 24);
    } else if (relative === "来月") {
      const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
      const lastDayOfNextMonth = new Date(nextYear, nextMonth, 0);
      const lastDayParts = tokyoDateParts(lastDayOfNextMonth);
      rangeStart = tokyoOffsetDate(nextYear, nextMonth, 1, 0);
      rangeEnd = tokyoOffsetDate(Number(lastDayParts.year), Number(lastDayParts.month), Number(lastDayParts.day), 24);
    }
  }

  const japaneseRangeMatch = condition.match(
    /(\d{4})?\s*年?\s*(\d{1,2})月(\d{1,2})日\s*([〜～\-–—]|から)\s*(?:(\d{4})?\s*年?\s*)?(?:(\d{1,2})月)?(\d{1,2})日?(?:\s*(?:まで|の間))?/,
  );

  if (japaneseRangeMatch && !rangeStart) {
    hasDateReference = true;
    const startYear = japaneseRangeMatch[1] ? Number(japaneseRangeMatch[1]) : currentYear;
    const startMonth = Number(japaneseRangeMatch[2]);
    const startDay = Number(japaneseRangeMatch[3]);
    // Group 4 is the separator (から, 〜, -, etc.)
    const endYear = japaneseRangeMatch[5] ? Number(japaneseRangeMatch[5]) : startYear;
    const endMonth = japaneseRangeMatch[6] ? Number(japaneseRangeMatch[6]) : startMonth;
    const endDay = Number(japaneseRangeMatch[7]);

    invalidDateRange =
      startMonth < 1 || startMonth > 12 || startDay < 1 || startDay > 31 ||
      endMonth < 1 || endMonth > 12 || endDay < 1 || endDay > 31;

    if (!invalidDateRange) {
      rangeStart = tokyoOffsetDate(startYear, startMonth, startDay, 0);
      const inclusiveRangeEnd = tokyoOffsetDate(endYear, endMonth, endDay, 0);

      // Compare by date, not timestamp, to allow ranges starting today
      const nowDateOnly = tokyoOffsetDate(currentYear, currentMonth, currentDay, 0);
      if (!japaneseRangeMatch[1] && rangeStart < nowDateOnly) {
        rangeStart = tokyoOffsetDate(currentYear + 1, startMonth, startDay, 0);
      }
      if (!japaneseRangeMatch[5] && inclusiveRangeEnd < rangeStart) {
        const adjustedRangeEnd = tokyoOffsetDate(endYear + 1, endMonth, endDay, 0);
        rangeEnd = new Date(adjustedRangeEnd.getTime() + 24 * 60 * 60 * 1000);
      } else {
        rangeEnd = new Date(inclusiveRangeEnd.getTime() + 24 * 60 * 60 * 1000);
      }

      const startParts = tokyoDateParts(rangeStart);
      const endParts = tokyoDateParts(new Date(rangeEnd.getTime() - 1));
      invalidDateRange =
        Number(startParts.month) !== startMonth || Number(startParts.day) !== startDay ||
        Number(endParts.month) !== endMonth || Number(endParts.day) !== endDay ||
        rangeEnd <= rangeStart;
    }
  }

  // Full slash range (YYYY/MM/DD-MM/DD or YYYY/MM/DD-YYYY/MM/DD)
  const fullSlashRangeMatch = condition.match(
    /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[-–—〜～]\s*(?:(\d{4})\/)?(?:(\d{1,2})\/)?(\d{1,2})/,
  );

  // Short slash range (MM/DD-MM/DD) - only if not already matched by full range
  const shortSlashRangeMatch = !fullSlashRangeMatch ? condition.match(
    /(\d{1,2})\/(\d{1,2})\s*[-–—〜～]\s*(\d{1,2})\/(\d{1,2})/,
  ) : null;

  if (fullSlashRangeMatch && !rangeStart) {
    hasDateReference = true;
    const startYear = Number(fullSlashRangeMatch[1]);
    const startMonth = Number(fullSlashRangeMatch[2]);
    const startDay = Number(fullSlashRangeMatch[3]);
    const endYear = fullSlashRangeMatch[4] ? Number(fullSlashRangeMatch[4]) : startYear;
    const endMonth = fullSlashRangeMatch[5] ? Number(fullSlashRangeMatch[5]) : startMonth;
    const endDay = Number(fullSlashRangeMatch[6]);

    invalidDateRange =
      startMonth < 1 || startMonth > 12 || startDay < 1 || startDay > 31 ||
      endMonth < 1 || endMonth > 12 || endDay < 1 || endDay > 31;

    if (!invalidDateRange) {
      rangeStart = tokyoOffsetDate(startYear, startMonth, startDay, 0);
      const inclusiveRangeEnd = tokyoOffsetDate(endYear, endMonth, endDay, 0);
      rangeEnd = new Date(inclusiveRangeEnd.getTime() + 24 * 60 * 60 * 1000);

      const startParts = tokyoDateParts(rangeStart);
      const endParts = tokyoDateParts(new Date(rangeEnd.getTime() - 1));
      invalidDateRange =
        Number(startParts.month) !== startMonth || Number(startParts.day) !== startDay ||
        Number(endParts.month) !== endMonth || Number(endParts.day) !== endDay ||
        rangeEnd <= rangeStart;
    }
  }

  if (shortSlashRangeMatch && !rangeStart) {
    hasDateReference = true;
    const startMonth = Number(shortSlashRangeMatch[1]);
    const startDay = Number(shortSlashRangeMatch[2]);
    const endMonth = Number(shortSlashRangeMatch[3]);
    const endDay = Number(shortSlashRangeMatch[4]);

    invalidDateRange =
      startMonth < 1 || startMonth > 12 || startDay < 1 || startDay > 31 ||
      endMonth < 1 || endMonth > 12 || endDay < 1 || endDay > 31;

    if (!invalidDateRange) {
      rangeStart = tokyoOffsetDate(currentYear, startMonth, startDay, 0);
      let inclusiveRangeEnd = tokyoOffsetDate(currentYear, endMonth, endDay, 0);

      // Compare by date, not timestamp, to allow ranges starting today
      const nowDateOnly = tokyoOffsetDate(currentYear, currentMonth, currentDay, 0);
      if (rangeStart < nowDateOnly) {
        rangeStart = tokyoOffsetDate(currentYear + 1, startMonth, startDay, 0);
        inclusiveRangeEnd = tokyoOffsetDate(currentYear + 1, endMonth, endDay, 0);
      }
      if (inclusiveRangeEnd < rangeStart) {
        inclusiveRangeEnd = tokyoOffsetDate(Number(tokyoDateParts(rangeStart).year) + 1, endMonth, endDay, 0);
      }
      rangeEnd = new Date(inclusiveRangeEnd.getTime() + 24 * 60 * 60 * 1000);

      const startParts = tokyoDateParts(rangeStart);
      const endParts = tokyoDateParts(new Date(rangeEnd.getTime() - 1));
      invalidDateRange =
        Number(startParts.month) !== startMonth || Number(startParts.day) !== startDay ||
        Number(endParts.month) !== endMonth || Number(endParts.day) !== endDay ||
        rangeEnd <= rangeStart;
    }
  }

  // Short single slash date (MM/DD)
  const shortSingleSlashMatch = condition.match(/^(\d{1,2})\/(\d{1,2})(?!\s*[-–—〜～])/);
  
  // Full single slash date (YYYY/MM/DD)
  const fullSingleSlashMatch = condition.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})(?!\s*[-–—〜～])/);

  const singleJapaneseDateMatch = condition.match(/(\d{4})?\s*年?\s*(\d{1,2})月(\d{1,2})日(?![〜～から\-–—])/);
  
  const singleDateMatch = singleJapaneseDateMatch || fullSingleSlashMatch || shortSingleSlashMatch;

  if (singleDateMatch && !rangeStart) {
    hasDateReference = true;
    
    let year, month, day;
    
    if (singleJapaneseDateMatch) {
      // Japanese format: YYYY年MM月DD日 or MM月DD日
      year = singleJapaneseDateMatch[1] ? Number(singleJapaneseDateMatch[1]) : currentYear;
      month = Number(singleJapaneseDateMatch[2]);
      day = Number(singleJapaneseDateMatch[3]);
    } else if (fullSingleSlashMatch) {
      // Full slash: YYYY/MM/DD
      year = Number(fullSingleSlashMatch[1]);
      month = Number(fullSingleSlashMatch[2]);
      day = Number(fullSingleSlashMatch[3]);
    } else if (shortSingleSlashMatch) {
      // Short slash: MM/DD
      year = currentYear;
      month = Number(shortSingleSlashMatch[1]);
      day = Number(shortSingleSlashMatch[2]);
    } else {
      return null;
    }

    invalidDateRange = month < 1 || month > 12 || day < 1 || day > 31;

    if (!invalidDateRange) {
      rangeStart = tokyoOffsetDate(year, month, day, 0);

      // Compare by date, not timestamp, to allow ranges starting today
      const nowDateOnly = tokyoOffsetDate(currentYear, currentMonth, currentDay, 0);
      if (!singleJapaneseDateMatch?.[1] && !fullSingleSlashMatch && rangeStart < nowDateOnly) {
        rangeStart = tokyoOffsetDate(currentYear + 1, month, day, 0);
      }

      rangeEnd = new Date(rangeStart.getTime() + 24 * 60 * 60 * 1000);

      const parts = tokyoDateParts(rangeStart);
      invalidDateRange = Number(parts.month) !== month || Number(parts.day) !== day;
    }
  }

  const horizonDays = rangeStart && rangeEnd && !invalidDateRange
    ? Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000))
    : 30;

  if (
    !Number.isFinite(durationMinutes) ||
    durationMinutes < 30 ||
    durationMinutes > 480 ||
    startHour < 0 ||
    startHour > 23 ||
    startMinute < 0 ||
    startMinute > 59 ||
    endHour < 0 ||
    endHour > 24 ||
    endMinute < 0 ||
    endMinute > 59 ||
    (endHour === 24 && endMinute !== 0) ||
    endTimeMinutes <= startTimeMinutes ||
    durationMinutes > endTimeMinutes - startTimeMinutes ||
    (rangeStart && rangeEnd && !invalidDateRange && (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())))
  ) {
    return null;
  }

  if (hasDateReference && invalidDateRange) {
    return {
      durationMinutes,
      startHour,
      startMinute,
      endTimeMinutes,
      dayType,
      allowedWeekdays: allowedWeekdays.size > 0 ? Array.from(allowedWeekdays) : undefined,
      excludedWeekdays: excludedWeekdays.size > 0 ? Array.from(excludedWeekdays) : undefined,
      horizonDays,
      rangeStart: null,
      rangeEnd: null,
      invalidDateRange: true,
    };
  }

  return {
    durationMinutes,
    startHour,
    startMinute,
    endTimeMinutes,
    dayType,
    allowedWeekdays: allowedWeekdays.size > 0 ? Array.from(allowedWeekdays) : undefined,
    excludedWeekdays: excludedWeekdays.size > 0 ? Array.from(excludedWeekdays) : undefined,
    horizonDays,
    rangeStart,
    rangeEnd,
    invalidDateRange,
  };
}

export type ParsedCondition = ReturnType<typeof parseCondition>;

export type TimeSlot = {
  year: number;
  month: number;
  day: number;
  weekday: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
};

export function generateCandidateSlots(
  parsed: ParsedCondition,
  now: Date,
  limit?: number
): TimeSlot[] {
  if (!parsed) return [];
  
  const rangeStart = parsed.rangeStart ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const rangeEnd = parsed.rangeEnd ?? new Date(now.getTime() + parsed.horizonDays * 24 * 60 * 60 * 1000);
  const slots: TimeSlot[] = [];

  for (let offset = 0; offset < parsed.horizonDays; offset += 1) {
    const probe = new Date(rangeStart.getTime() + offset * 24 * 60 * 60 * 1000);
    if (probe >= rangeEnd) break;
    const parts = tokyoDateParts(probe);
    const weekday = parts.weekday;
    
    // Apply weekday filters
    if (parsed.dayType === "weekday" && (weekday === "土" || weekday === "日")) continue;
    if (parsed.dayType === "weekend" && weekday !== "土" && weekday !== "日") continue;
    if (parsed.dayType === "specific" && parsed.allowedWeekdays && !parsed.allowedWeekdays.includes(weekday)) continue;
    if (parsed.excludedWeekdays && parsed.excludedWeekdays.includes(weekday)) continue;

    for (
      let startTimeMinutes = parsed.startHour * 60 + parsed.startMinute;
      startTimeMinutes + parsed.durationMinutes <= parsed.endTimeMinutes;
      startTimeMinutes += 60
    ) {
      const hour = Math.floor(startTimeMinutes / 60);
      const minute = startTimeMinutes % 60;
      const start = new Date(
        tokyoOffsetDate(Number(parts.year), Number(parts.month), Number(parts.day), hour).getTime()
          + minute * 60 * 1000,
      );
      const end = new Date(start.getTime() + parsed.durationMinutes * 60 * 1000);
      const endParts = tokyoDateParts(end);
      if (start <= now || endParts.day !== parts.day) continue;
      
      slots.push({
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        weekday,
        startHour: hour,
        startMinute: minute,
        endHour: Math.floor((startTimeMinutes + parsed.durationMinutes) / 60),
        endMinute: (startTimeMinutes + parsed.durationMinutes) % 60,
      });
      
      if (limit !== undefined && slots.length >= limit) {
        return slots;
      }
    }
  }

  return slots;
}
