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
  syncOpenOwnerPollsTentativeEvents,
} from "../lib/google-calendar";
import { parseCondition, generateCandidateSlots, selectFreeSlots } from "./condition-parser";

const router: IRouter = Router();
const TIME_ZONE = GOOGLE_CALENDAR_TIME_ZONE;
const GOOGLE_PROVIDER = "oauth_google";
const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
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
  
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  syncOpenOwnerPollsTentativeEvents(userId, baseUrl).catch((error) => {
    req.log.error({ err: error, userId }, "Failed to sync open polls on calendar connection");
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

  const access = await getGoogleAccess(userId);
  if (access.status === "unavailable") {
    res.status(502).json({ error: "Googleカレンダーの接続情報を確認できませんでした。時間をおいて再度お試しください。" });
    return;
  }
  if (access.status === "disconnected" || access.status === "needs_reconnect") {
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
  
  const rangeStart = parsed.rangeStart ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const rangeEnd = parsed.rangeEnd ?? new Date(now.getTime() + parsed.horizonDays * 24 * 60 * 60 * 1000);
  
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
  
  // Generate all candidate slots (without limit)
  const candidateSlots = generateCandidateSlots(parsed, now);
  
  // Filter out busy slots and take first 'limit' slots
  const freeSlots = selectFreeSlots(candidateSlots, busy, parsed.durationMinutes, limit);
  
  const slots: Array<{ label: string; start: string; end: string }> = freeSlots.map(slot => {
    const start = tokyoOffsetDate(slot.year, slot.month, slot.day, slot.startHour);
    const startWithMinutes = new Date(start.getTime() + slot.startMinute * 60 * 1000);
    const end = new Date(startWithMinutes.getTime() + parsed.durationMinutes * 60 * 1000);
    
    return {
      label: `${slot.year}/${slot.month}/${slot.day}(${slot.weekday}) ${String(slot.startHour).padStart(2, "0")}:${String(slot.startMinute).padStart(2, "0")}〜${String(slot.endHour).padStart(2, "0")}:${String(slot.endMinute).padStart(2, "0")}`,
      start: startWithMinutes.toISOString(),
      end: end.toISOString(),
    };
  });

  const dayLabel = parsed.dayType === "weekday" 
    ? "平日" 
    : parsed.dayType === "weekend" 
      ? "土日" 
      : parsed.dayType === "specific" && parsed.allowedWeekdays
        ? parsed.allowedWeekdays.map(d => `${d}曜`).join("・")
        : parsed.excludedWeekdays && parsed.excludedWeekdays.length > 0
          ? `毎日（${parsed.excludedWeekdays.map(d => `${d}曜`).join("・")}を除く）`
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