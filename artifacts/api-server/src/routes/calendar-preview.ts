import { clerkClient, getAuth } from "@clerk/express";
import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import { calendarConnectionsTable, db, pollCandidatesTable, pollsTable } from "@workspace/db";
import {
  CreateCalendarEventBody,
  CreateCalendarEventResponse,
  GetCalendarConnectionResponse,
  GenerateCalendarCandidatesBody,
  GenerateCalendarCandidatesResponse,
} from "@workspace/api-zod";
import {
  getGoogleAccess,
  googleRequest,
  GOOGLE_CALENDAR_RECONNECT_ERROR_CODE,
  GOOGLE_CALENDAR_TIME_ZONE,
  synchronizePollCalendarEvents,
} from "../lib/google-calendar";

const router: IRouter = Router();
const TIME_ZONE = GOOGLE_CALENDAR_TIME_ZONE;
const GOOGLE_PROVIDER = "oauth_google";
const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
];
const RECONNECT_MESSAGE =
  "Googleカレンダーの権限が切れています。Googleカレンダーを再接続してください。";

function sendReconnectRequired(res: Response) {
  res.status(409).json({
    error: RECONNECT_MESSAGE,
    code: GOOGLE_CALENDAR_RECONNECT_ERROR_CODE,
  });
}

type BusyResponse = {
  calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }>;
};

function requestUserId(req: Parameters<typeof getAuth>[0]) {
  if (process.env.NODE_ENV === "test") return req.header("X-Test-User-Id") ?? null;
  return getAuth(req).userId;
}

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

function parseCondition(condition: string, now: Date) {
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
  const excludeWeekend = condition.includes("土日を除く") || condition.includes("週末を除く");
  const weekdayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const allowedWeekdays = new Set<string>();
  
  // Check for specific weekdays: 月水金, 火曜と木曜, 毎週火木, etc.
  const specificDaysPattern = /([月火水木金土日])([曜、・と\s]*)/g;
  const specificMatches = Array.from(condition.matchAll(specificDaysPattern));
  if (specificMatches.length > 0 && !condition.includes("毎日")) {
    for (const match of specificMatches) {
      allowedWeekdays.add(match[1]);
    }
  }

  const dayType = excludeWeekend || condition.includes("平日")
    ? "weekday"
    : condition.includes("土日") || condition.includes("週末")
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
    horizonDays,
    rangeStart,
    rangeEnd,
    invalidDateRange,
  };
}

router.get("/calendar/connection", async (req, res): Promise<void> => {
  const userId = requestUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Googleカレンダーの確認にはログインが必要です。" });
    return;
  }
  const access = await getGoogleAccess(userId);
  if (access.status === "unavailable") {
    res.status(502).json({ error: "Googleカレンダーの接続情報を確認できませんでした。時間をおいて再度お試しください。" });
    return;
  }
  res.json(GetCalendarConnectionResponse.parse({
    connected: access.status === "connected",
    email: access.status === "connected" ? access.connection.email : null,
  }));
});

router.post("/calendar/connection", async (req, res): Promise<void> => {
  const userId = requestUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Googleカレンダーの接続にはログインが必要です。" });
    return;
  }
  let tokenResult;
  try {
    tokenResult = await clerkClient.users.getUserOauthAccessToken(userId, GOOGLE_PROVIDER);
  } catch (error) {
    req.log.error({ err: error }, "Unable to retrieve Google OAuth access token from Clerk");
    res.status(502).json({ error: "Googleカレンダーの接続を確認できませんでした。時間をおいて再度お試しください。" });
    return;
  }
  const token = tokenResult.data.find((item) =>
    REQUIRED_SCOPES.every((scope) => item.scopes?.includes(scope)),
  );
  if (!token) {
    res.status(409).json({ error: "Googleカレンダーへのアクセス許可が完了していません。" });
    return;
  }
  const user = await clerkClient.users.getUser(userId);
  const account = user.externalAccounts.find((item) => item.id === token.externalAccountId);
  await db.insert(calendarConnectionsTable).values({
    userId,
    externalAccountId: token.externalAccountId,
    email: account?.emailAddress ?? null,
  }).onConflictDoUpdate({
    target: calendarConnectionsTable.userId,
    set: {
      externalAccountId: token.externalAccountId,
      email: account?.emailAddress ?? null,
      updatedAt: new Date(),
    },
  });
  res.json(GetCalendarConnectionResponse.parse({
    connected: true,
    email: account?.emailAddress ?? null,
  }));
});

router.delete("/calendar/connection", async (req, res): Promise<void> => {
  const userId = requestUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Googleカレンダーの解除にはログインが必要です。" });
    return;
  }
  await db.delete(calendarConnectionsTable).where(eq(calendarConnectionsTable.userId, userId));
  res.sendStatus(204);
});

router.post(["/calendar/candidates", "/calendar-preview/candidates"], async (req, res): Promise<void> => {
  const userId = requestUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Googleカレンダーの利用にはログインが必要です。" });
    return;
  }
  const body = GenerateCalendarCandidatesBody.safeParse(req.body);
  const now = new Date();
  const parsed = body.success ? parseCondition(body.data.condition, now) : null;
  if (!body.success || !parsed) {
    res.status(400).json({ error: "条件を読み取れませんでした。例を参考に入力してください。" });
    return;
  }

  const rangeStart = parsed.rangeStart ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const rangeEnd = parsed.rangeEnd ?? new Date(now.getTime() + parsed.horizonDays * 24 * 60 * 60 * 1000);
  const access = await getGoogleAccess(userId);
  if (access.status === "unavailable") {
    res.status(502).json({ error: "Googleカレンダーの接続情報を確認できませんでした。時間をおいて再度お試しください。" });
    return;
  }
  if (access.status === "disconnected") {
    res.status(409).json({ error: "Googleカレンダーを接続してください。" });
    return;
  }
  if (parsed.invalidDateRange) {
    res.json(GenerateCalendarCandidatesResponse.parse({
      slots: [],
      interpretation: "",
    }));
    return;
  }
  const response = await googleRequest(access.token, "/calendar/v3/freeBusy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      timeZone: TIME_ZONE,
      items: [{ id: "primary" }],
    }),
  });
  if (!response.ok) {
    req.log.error({ status: response.status }, "Google Calendar free/busy request failed");
    if (response.status === 401 || response.status === 403) {
      sendReconnectRequired(res);
      return;
    }
    res.status(502).json({ error: "Googleカレンダーの空き時間を確認できませんでした。" });
    return;
  }
  const calendar = ((await response.json()) as BusyResponse).calendars?.primary;
  if (!calendar || calendar.errors?.length) {
    res.status(502).json({ error: "Googleカレンダーの空き時間を確認できませんでした。" });
    return;
  }
  const busy = calendar.busy ?? [];
  const limit = body.data.limit ?? 10;
  const slots: Array<{ label: string; start: string; end: string }> = [];

  for (let offset = 0; offset < parsed.horizonDays && slots.length < limit; offset += 1) {
    const probe = new Date(rangeStart.getTime() + offset * 24 * 60 * 60 * 1000);
    if (probe >= rangeEnd) break;
    const parts = tokyoDateParts(probe);
    const weekday = parts.weekday;
    
    // Apply weekday filters
    if (parsed.dayType === "weekday" && (weekday === "土" || weekday === "日")) continue;
    if (parsed.dayType === "weekend" && weekday !== "土" && weekday !== "日") continue;
    if (parsed.dayType === "specific" && parsed.allowedWeekdays && !parsed.allowedWeekdays.includes(weekday)) continue;

    for (
      let startTimeMinutes = parsed.startHour * 60 + parsed.startMinute;
      startTimeMinutes + parsed.durationMinutes <= parsed.endTimeMinutes && slots.length < limit;
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
      const overlaps = busy.some((period) => new Date(period.start) < end && new Date(period.end) > start);
      if (overlaps) continue;
      slots.push({
        label: `${parts.year}/${parts.month}/${parts.day}(${weekday}) ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}〜${new Intl.DateTimeFormat("ja-JP", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(end)}`,
        start: start.toISOString(),
        end: end.toISOString(),
      });
    }
  }

  const dayLabel = parsed.dayType === "weekday" 
    ? "平日" 
    : parsed.dayType === "weekend" 
      ? "土日" 
      : parsed.dayType === "specific" && parsed.allowedWeekdays
        ? parsed.allowedWeekdays.map(d => `${d}曜`).join("・")
        : "毎日";
  const rangeLabel = parsed.rangeStart && parsed.rangeEnd
    ? `${tokyoDateParts(parsed.rangeStart).month}月${tokyoDateParts(parsed.rangeStart).day}日から${tokyoDateParts(new Date(parsed.rangeEnd.getTime() - 1)).month}月${tokyoDateParts(new Date(parsed.rangeEnd.getTime() - 1)).day}日まで`
    : `今後${parsed.horizonDays}日以内`;
  res.json(GenerateCalendarCandidatesResponse.parse({
    slots,
    interpretation: `${rangeLabel}、${dayLabel}の${String(parsed.startHour).padStart(2, "0")}:${String(parsed.startMinute).padStart(2, "0")}から${String(Math.floor(parsed.endTimeMinutes / 60)).padStart(2, "0")}:${String(parsed.endTimeMinutes % 60).padStart(2, "0")}の間で${parsed.durationMinutes}分`,
  }));
});

router.post(["/calendar/events", "/calendar-preview/events"], async (req, res): Promise<void> => {
  const userId = requestUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Googleカレンダーの利用にはログインが必要です。" });
    return;
  }
  const body = CreateCalendarEventBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "カレンダーへ登録するイベントが正しくありません。" });
    return;
  }
  const poll = await db.query.pollsTable.findFirst({
    where: eq(pollsTable.shareId, body.data.shareId),
  });
  if (!poll || poll.ownerUserId !== userId) {
    res.status(403).json({ error: "このイベントをカレンダーへ登録する権限がありません。" });
    return;
  }
  if (poll.confirmedCandidateId === null) {
    res.status(400).json({ error: "開催日を確定してからカレンダーへ登録してください。" });
    return;
  }
  const shareUrl = `${req.protocol}://${req.get("host")}/p/${encodeURIComponent(poll.shareId)}`;
  const sync = await synchronizePollCalendarEvents({
    pollId: poll.id,
    shareUrl,
  });
  if (sync.status === "reconnect_required") {
    sendReconnectRequired(res);
    return;
  }
  if (sync.status !== "succeeded" || !sync.event.htmlLink) {
    res.status(502).json({
      error:
        sync.status === "queued"
          ? "Googleカレンダーの一時的なエラーのため再試行中です。しばらくしてから確認してください。"
          : "Googleカレンダーへ同期できませんでした。接続状態を確認して再試行してください。",
    });
    return;
  }
  res.status(201).json(CreateCalendarEventResponse.parse({ eventId: sync.event.id, htmlLink: sync.event.htmlLink }));
});

export default router;