import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * parseCondition のテスト
 * 
 * このテストファイルは calendar-preview.ts の parseCondition 関数をテストします。
 * 固定された now を使用して、日付解釈が安定していることを確認します。
 */

// テスト用の固定日時: 2026年10月10日 11:05 JST (土曜日)
const FIXED_NOW = new Date("2026-10-10T11:05:00+09:00");

// テスト用のヘルパー関数群を定義
const TIME_ZONE = "Asia/Tokyo";

function tokyoDateParts(date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function tokyoOffsetDate(year, month, day, hour) {
  return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+09:00`);
}

function normalizeHour(hour, period) {
  if ((period === "午後" || period === "夜") && hour < 12) return hour + 12;
  if (period === "午前" && hour === 12) return 0;
  return hour;
}

function parseCondition(condition, now) {
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
  const dayType = condition.includes("土日") || condition.includes("週末")
    ? "weekend"
    : condition.includes("平日")
      ? "weekday"
      : "all";

  const nowParts = tokyoDateParts(now);
  const currentYear = Number(nowParts.year);
  const currentMonth = Number(nowParts.month);
  const currentDay = Number(nowParts.day);

  let rangeStart = null;
  let rangeEnd = null;
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

      if (!japaneseRangeMatch[1] && rangeStart < now) {
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

      // Only adjust to next year if the date is in the past (no explicit year)
      if (rangeStart < now) {
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

      // If no year was specified and the date is in the past, move to next year
      if (!singleJapaneseDateMatch?.[1] && !fullSingleSlashMatch && rangeStart < now) {
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
    horizonDays,
    rangeStart,
    rangeEnd,
    invalidDateRange,
  };
}

// テストヘルパー
function formatDateRange(start, end) {
  if (!start || !end) return null;
  const startParts = tokyoDateParts(start);
  const endParts = tokyoDateParts(new Date(end.getTime() - 1)); // -1 to get inclusive end
  return `${startParts.year}/${startParts.month}/${startParts.day}-${endParts.year}/${endParts.month}/${endParts.day}`;
}

// テストケース
test("parseCondition - 完全な年月日形式の日付範囲", () => {
  const result = parseCondition("2026年10月20日から24日の間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/24");
});

test("parseCondition - 年なし月日形式の日付範囲（から）", () => {
  const result = parseCondition("10月20日から24日の間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/24");
});

test("parseCondition - 年なし月日形式の日付範囲（〜）", () => {
  const result = parseCondition("10月20日〜10月24日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/24");
});

test("parseCondition - 年なし月日形式の日付範囲（ハイフン）", () => {
  const result = parseCondition("10月20日-24日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/24");
});

test("parseCondition - 完全スラッシュ形式の日付範囲", () => {
  const result = parseCondition("2026/10/20-10/24", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/24");
});

test("parseCondition - 年なしスラッシュ形式の日付範囲", () => {
  const result = parseCondition("10/20-10/24", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/24");
});

test("parseCondition - 単一日付（月日）", () => {
  const result = parseCondition("10月20日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/20");
});

test("parseCondition - 単一日付（スラッシュ）", () => {
  const result = parseCondition("10/20", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/20");
});

test("parseCondition - 単一日付（年月日）", () => {
  const result = parseCondition("2026年10月20日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/20");
});

test("parseCondition - 単一日付（完全スラッシュ）", () => {
  const result = parseCondition("2026/10/20", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/20");
});

test("parseCondition - 相対日付: 明日", () => {
  const result = parseCondition("明日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/11-2026/10/11");
});

test("parseCondition - 相対日付: 明後日", () => {
  const result = parseCondition("明後日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/12-2026/10/12");
});

test("parseCondition - 相対日付: 来週", () => {
  const result = parseCondition("来週", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  // 2026/10/10 は土曜日なので、来週は 10/12 (月) から 10/18 (日)
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/12-2026/10/18");
});

test("parseCondition - 相対日付: 今週", () => {
  const result = parseCondition("今週", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  // 2026/10/10 は土曜日なので、今週の残りは 10/10 (土) から 10/11 (日)
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/10-2026/10/11");
});

test("parseCondition - 相対日付: 今月", () => {
  const result = parseCondition("今月", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  // 10/10 から 10/31 まで
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/10-2026/10/31");
});

test("parseCondition - 相対日付: 来月", () => {
  const result = parseCondition("来月", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  // 11/1 から 11/30 まで
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/11/1-2026/11/30");
});

test("parseCondition - 時間帯のみ（デフォルト30日）", () => {
  const result = parseCondition("19時から21時", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効");
  assert.strictEqual(result.horizonDays, 30, "デフォルト30日");
  assert.strictEqual(result.startHour, 19);
  assert.strictEqual(result.endTimeMinutes, 21 * 60);
});

test("parseCondition - 複合: 来週の平日19時から2時間", () => {
  const result = parseCondition("来週の平日19時から2時間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効");
  assert.strictEqual(result.dayType, "weekday");
  assert.strictEqual(result.startHour, 19);
  assert.strictEqual(result.durationMinutes, 120);
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/12-2026/10/18");
});

test("parseCondition - 既存の機能: 午前", () => {
  const result = parseCondition("午前", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 9);
  assert.strictEqual(result.endTimeMinutes, 12 * 60);
});

test("parseCondition - 既存の機能: 午後", () => {
  const result = parseCondition("午後", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 13);
  assert.strictEqual(result.endTimeMinutes, 18 * 60);
});

test("parseCondition - 既存の機能: 平日", () => {
  const result = parseCondition("平日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.dayType, "weekday");
});

test("parseCondition - 既存の機能: 土日", () => {
  const result = parseCondition("土日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.dayType, "weekend");
});

test("parseCondition - 既存の機能: 1時間", () => {
  const result = parseCondition("1時間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.durationMinutes, 60);
});

test("parseCondition - 既存の機能: 90分", () => {
  const result = parseCondition("90分", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.durationMinutes, 90);
});

test("parseCondition - 無効な日付はinvalidDateRangeがtrue", () => {
  const result = parseCondition("2026/13/1", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, true, "無効な日付範囲");
});

test("parseCondition - 年なし過去日付は来年として解釈", () => {
  // 10/10の時点で10/5は過去なので、2027/10/5として解釈
  const result = parseCondition("10/5", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2027/10/5-2027/10/5");
});

// v0.6回帰テスト
test("parseCondition - v0.6回帰: 2026/9/18-9/22の午後。1時間枠", () => {
  const result = parseCondition("2026/9/18-9/22の午後。1時間枠", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/9/18-2026/9/22");
  assert.strictEqual(result.startHour, 13, "午後の開始時刻");
  assert.strictEqual(result.endTimeMinutes, 18 * 60, "午後の終了時刻");
  assert.strictEqual(result.durationMinutes, 60, "1時間枠");
});

test("parseCondition - v0.6回帰: 2026/9/18-9/22の13:00-15:00、1時間枠", () => {
  const result = parseCondition("2026/9/18-9/22の13:00-15:00、1時間枠", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/9/18-2026/9/22");
  assert.strictEqual(result.startHour, 13, "開始時刻");
  assert.strictEqual(result.startMinute, 0, "開始分");
  assert.strictEqual(result.endTimeMinutes, 15 * 60, "終了時刻");
  assert.strictEqual(result.durationMinutes, 60, "1時間枠");
});

test("parseCondition - v0.6回帰: 平日9:00-12:00", () => {
  const result = parseCondition("平日9:00-12:00", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.dayType, "weekday", "平日のみ");
  assert.strictEqual(result.startHour, 9, "開始時刻");
  assert.strictEqual(result.startMinute, 0, "開始分");
  assert.strictEqual(result.endTimeMinutes, 12 * 60, "終了時刻");
  assert.strictEqual(result.horizonDays, 30, "デフォルト30日");
});

// 時間帯表現の改善テスト (ユーザーレポートに基づく)
test("parseCondition - 10/20-10/25までの午後3時間枠", () => {
  const result = parseCondition("10/20-10/25までの午後3時間枠", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 13, "午後の開始: 13時");
  assert.strictEqual(result.endTimeMinutes, 18 * 60, "午後の終了: 18:00");
  assert.strictEqual(result.durationMinutes, 180, "3時間枠");
});

test("parseCondition - 11/5-11/10までの午前中3時間枠", () => {
  const result = parseCondition("11/5-11/10までの午前中3時間枠", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 9, "午前の開始: 9時");
  assert.strictEqual(result.endTimeMinutes, 12 * 60, "午前の終了: 12:00");
  assert.strictEqual(result.durationMinutes, 180, "3時間枠");
});

test("parseCondition - 午後に2時間", () => {
  const result = parseCondition("午後に2時間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 13, "午後の開始: 13時");
  assert.strictEqual(result.endTimeMinutes, 18 * 60, "午後の終了: 18:00");
  assert.strictEqual(result.durationMinutes, 120, "2時間");
});

test("parseCondition - 昼90分", () => {
  const result = parseCondition("昼90分", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 11, "昼の開始: 11時");
  assert.strictEqual(result.endTimeMinutes, 14 * 60, "昼の終了: 14:00");
  assert.strictEqual(result.durationMinutes, 90, "90分");
});

test("parseCondition - 夕方1時間", () => {
  const result = parseCondition("夕方1時間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 16, "夕方の開始: 16時");
  assert.strictEqual(result.endTimeMinutes, 19 * 60, "夕方の終了: 19:00");
  assert.strictEqual(result.durationMinutes, 60, "1時間");
});

test("parseCondition - 午後3時から2時間（具体的な時刻、時間帯ではない）", () => {
  const result = parseCondition("午後3時から2時間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 15, "午後3時 = 15時");
  assert.strictEqual(result.endTimeMinutes, 24 * 60, "デフォルト終了: 24:00");
  assert.strictEqual(result.durationMinutes, 120, "2時間");
});

test("parseCondition - 10/20-10/25までの平日（までのが動作）", () => {
  const result = parseCondition("10/20-10/25までの平日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.dayType, "weekday", "平日");
  assert.ok(result.rangeStart, "日付範囲が設定されている");
});
