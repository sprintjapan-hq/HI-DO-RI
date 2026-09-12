import { clerkClient } from "@clerk/express";
import { createHash, randomUUID } from "node:crypto";
import {
  calendarConnectionsTable,
  db,
  pollCalendarEventsTable,
  pollCalendarSyncsTable,
  pollCandidatesTable,
  pollsTable,
} from "@workspace/db";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { logger } from "./logger";

export const GOOGLE_CALENDAR_TIME_ZONE = "Asia/Tokyo";
export const GOOGLE_CALENDAR_RECONNECT_ERROR_CODE =
  "google_calendar_reconnect_required";
const GOOGLE_PROVIDER = "oauth_google";
const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
];
const CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
const RETRY_INTERVAL_MS =
  process.env.NODE_ENV === "test" ? 100 : 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const MAX_SYNC_ATTEMPTS = 8;
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
const SYNC_BATCH_SIZE = 10;

export type CalendarSyncResult =
  | { status: "succeeded"; event: GoogleEventResult }
  | { status: "skipped" }
  | { status: "queued" }
  | { status: "reconnect_required"; error: string }
  | { status: "permanent_failure"; error: string };

class CalendarSyncError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly reconnectRequired = false,
  ) {
    super(message);
  }
}

async function isRetryableGoogleResponse(response: Response) {
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return true;
  }
  if (response.status !== 403) return false;
  try {
    const body = (await response.clone().json()) as {
      error?: { errors?: Array<{ reason?: string }> };
    };
    return body.error?.errors?.some(({ reason }) =>
      ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "backendError"].includes(
        reason ?? "",
      ),
    ) ?? false;
  } catch {
    return false;
  }
}

async function requireGoogleResponse(
  request: Promise<Response>,
  operation: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await request;
  } catch (error) {
    throw new CalendarSyncError(
      `${operation} failed: ${error instanceof Error ? error.message : "network error"}`,
      true,
    );
  }
  if (!response.ok) {
    const retryable = await isRetryableGoogleResponse(response);
    throw new CalendarSyncError(
      `${operation} returned ${response.status}`,
      retryable,
      (response.status === 401 || response.status === 403) && !retryable,
    );
  }
  return response;
}

export async function getGoogleAccess(userId: string) {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.GOOGLE_CALENDAR_TEST_TOKEN &&
    userId.startsWith("calendar-sync-test-")
  ) {
    return {
      status: "connected" as const,
      connection: {
        userId,
        externalAccountId: "calendar-test-account",
        email: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      token: process.env.GOOGLE_CALENDAR_TEST_TOKEN,
      scopes: userId.includes("freebusy-only")
        ? ["https://www.googleapis.com/auth/calendar.freebusy"]
        : [...REQUIRED_SCOPES, CALENDAR_EVENTS_SCOPE],
    };
  }
  try {
    const connection = await db.query.calendarConnectionsTable.findFirst({
      where: eq(calendarConnectionsTable.userId, userId),
    });
    if (!connection) return { status: "disconnected" as const };
    const tokenResult = await clerkClient.users.getUserOauthAccessToken(
      userId,
      GOOGLE_PROVIDER,
    );
    const token = tokenResult.data.find(
      (item) => item.externalAccountId === connection.externalAccountId,
    );
    if (
      !token ||
      !REQUIRED_SCOPES.every((scope) => token.scopes?.includes(scope))
    ) {
      return { status: "disconnected" as const };
    }
    return {
      status: "connected" as const,
      connection,
      token: token.token,
      scopes: token.scopes ?? [],
    };
  } catch (error) {
    logger.error(
      { err: error, userId },
      "Unable to retrieve Google OAuth access token from Clerk",
    );
    return { status: "unavailable" as const };
  }
}

export async function googleRequest(
  token: string,
  path: string,
  init: RequestInit,
) {
  const baseUrl =
    process.env.NODE_ENV === "test" &&
    process.env.GOOGLE_CALENDAR_TEST_BASE_URL
      ? process.env.GOOGLE_CALENDAR_TEST_BASE_URL
      : "https://www.googleapis.com";
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
}

type GoogleEventResult = {
  id: string;
  htmlLink: string | null;
};

async function createGoogleEvent(
  token: string,
  input: {
    eventId: string;
    summary: string;
    description: string;
    startAt: Date;
    endAt: Date;
    privateProperties: Record<string, string>;
  },
): Promise<GoogleEventResult> {
  let response: Response;
  try {
    response = await googleRequest(
    token,
    "/calendar/v3/calendars/primary/events?sendUpdates=none",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: input.eventId,
        summary: input.summary,
        description: input.description,
        start: {
          dateTime: input.startAt.toISOString(),
          timeZone: GOOGLE_CALENDAR_TIME_ZONE,
        },
        end: {
          dateTime: input.endAt.toISOString(),
          timeZone: GOOGLE_CALENDAR_TIME_ZONE,
        },
        extendedProperties: { private: input.privateProperties },
      }),
    },
    );
  } catch (error) {
    throw new CalendarSyncError(
      `Google Calendar event creation failed: ${error instanceof Error ? error.message : "network error"}`,
      true,
    );
  }
  if (response.status === 409) {
    const existing = await requireGoogleResponse(googleRequest(
      token,
      `/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`,
      { method: "GET" },
    ), "Google Calendar duplicate event lookup");
    const event = (await existing.json()) as { id?: string; htmlLink?: string };
    if (event.id) {
      return { id: event.id, htmlLink: event.htmlLink ?? null };
    }
  }
  if (!response.ok) {
    const retryable = await isRetryableGoogleResponse(response);
    throw new CalendarSyncError(
      `Google Calendar event creation returned ${response.status}`,
      retryable,
      (response.status === 401 || response.status === 403) && !retryable,
    );
  }
  const event = (await response.json()) as { id?: string; htmlLink?: string };
  if (!event.id) {
    throw new Error("Google Calendar event creation returned no event ID");
  }
  return { id: event.id, htmlLink: event.htmlLink ?? null };
}

function googleEventId(
  pollId: number,
  candidateId: number,
  kind: "tentative" | "confirmed",
) {
  return createHash("sha256")
    .update(`hidori:${pollId}:${candidateId}:${kind}`)
    .digest("hex");
}

export async function createTentativePollEvents(input: {
  pollId: number;
  ownerUserId: string;
  shareUrl: string;
}): Promise<void> {
  if (
    process.env.NODE_ENV === "test" &&
    (!process.env.GOOGLE_CALENDAR_TEST_TOKEN ||
      !input.ownerUserId.startsWith("calendar-sync-test-"))
  ) {
    return;
  }
  const access = await getGoogleAccess(input.ownerUserId);
  if (access.status !== "connected") return;
  if (!access.scopes.includes(CALENDAR_EVENTS_SCOPE)) return;

  const [poll, candidates, existing] = await Promise.all([
    db.query.pollsTable.findFirst({
      where: eq(pollsTable.id, input.pollId),
    }),
    db
      .select()
      .from(pollCandidatesTable)
      .where(eq(pollCandidatesTable.pollId, input.pollId)),
    db
      .select({ candidateId: pollCalendarEventsTable.candidateId })
      .from(pollCalendarEventsTable)
      .where(
        and(
          eq(pollCalendarEventsTable.pollId, input.pollId),
          eq(pollCalendarEventsTable.kind, "tentative"),
        ),
      ),
  ]);
  if (!poll || poll.ownerUserId !== input.ownerUserId) return;

  const existingCandidateIds = new Set(
    existing.flatMap((item) =>
      item.candidateId === null ? [] : [item.candidateId],
    ),
  );
  await Promise.all(
    candidates.map(async (candidate) => {
      if (
        existingCandidateIds.has(candidate.id) ||
        !candidate.startAt ||
        !candidate.endAt ||
        candidate.endAt <= candidate.startAt
      ) {
        return;
      }
      try {
        const event = await createGoogleEvent(access.token, {
          eventId: googleEventId(poll.id, candidate.id, "tentative"),
          summary: `[仮] ${poll.title}`,
          description: `HI-DO-RIで日程調整中の候補です。\n${input.shareUrl}`,
          startAt: candidate.startAt,
          endAt: candidate.endAt,
          privateProperties: {
            hidoriShareId: poll.shareId,
            hidoriPollId: String(poll.id),
            hidoriCandidateId: String(candidate.id),
            hidoriKind: "tentative",
          },
        });
        await db
          .insert(pollCalendarEventsTable)
          .values({
            pollId: poll.id,
            candidateId: candidate.id,
            googleEventId: event.id,
            htmlLink: event.htmlLink,
            kind: "tentative",
          })
          .onConflictDoNothing();
      } catch (error) {
        logger.error(
          { err: error, pollId: poll.id, candidateId: candidate.id },
          "Tentative Google Calendar event creation failed",
        );
      }
    }),
  );
}

export async function finalizePollCalendarEvents(input: {
  pollId: number;
  ownerUserId: string;
  shareUrl: string;
}): Promise<GoogleEventResult | null> {
  if (
    process.env.NODE_ENV === "test" &&
    (!process.env.GOOGLE_CALENDAR_TEST_TOKEN ||
      !input.ownerUserId.startsWith("calendar-sync-test-"))
  ) {
    return null;
  }
  const access = await getGoogleAccess(input.ownerUserId);
  if (
    access.status === "connected" &&
    !access.scopes.includes(CALENDAR_EVENTS_SCOPE)
  ) {
    return null;
  }
  if (access.status === "unavailable") {
    throw new CalendarSyncError("Google Calendar connection is temporarily unavailable", true);
  }
  if (access.status === "disconnected") {
    throw new CalendarSyncError(
      "Google Calendar needs to be reconnected",
      false,
      true,
    );
  }

  const poll = await db.query.pollsTable.findFirst({
    where: eq(pollsTable.id, input.pollId),
  });
  if (
    !poll ||
    poll.ownerUserId !== input.ownerUserId ||
    poll.confirmedCandidateId === null
  ) {
    return null;
  }
  const candidate = await db.query.pollCandidatesTable.findFirst({
    where: eq(pollCandidatesTable.id, poll.confirmedCandidateId),
  });
  if (
    !candidate ||
    candidate.pollId !== poll.id ||
    !candidate.startAt ||
    !candidate.endAt ||
    candidate.endAt <= candidate.startAt
  ) {
    return null;
  }

  const tentativeEvents = await db
    .select()
    .from(pollCalendarEventsTable)
    .where(
      and(
        eq(pollCalendarEventsTable.pollId, poll.id),
        eq(pollCalendarEventsTable.kind, "tentative"),
      ),
    );
  const deletionFailures: string[] = [];
  let deletionFailuresAreRetryable = true;
  let deletionFailureNeedsReconnect = false;
  await Promise.all(
    tentativeEvents.map(async (event) => {
       let response: Response;
       try {
         response = await googleRequest(
        access.token,
        `/calendar/v3/calendars/primary/events/${encodeURIComponent(event.googleEventId)}?sendUpdates=none`,
        { method: "DELETE" },
         );
       } catch (error) {
         throw new CalendarSyncError(
           `Tentative Google Calendar event deletion failed: ${error instanceof Error ? error.message : "network error"}`,
           true,
         );
       }
      if (
        response.ok ||
        response.status === 404 ||
        response.status === 410
      ) {
        await db
          .delete(pollCalendarEventsTable)
          .where(eq(pollCalendarEventsTable.id, event.id));
       } else {
         deletionFailures.push(event.googleEventId);
         const retryable = await isRetryableGoogleResponse(response);
         deletionFailuresAreRetryable =
           deletionFailuresAreRetryable && retryable;
         deletionFailureNeedsReconnect =
           deletionFailureNeedsReconnect ||
           ((response.status === 401 || response.status === 403) && !retryable);
        logger.error(
          {
            pollId: poll.id,
            googleEventId: event.googleEventId,
            status: response.status,
          },
          "Tentative Google Calendar event deletion failed",
        );
      }
    }),
  );
  if (deletionFailures.length > 0) {
    throw new CalendarSyncError(
      `${deletionFailures.length} tentative Google Calendar events could not be deleted`,
      deletionFailuresAreRetryable,
      deletionFailureNeedsReconnect,
    );
  }

  const [existingConfirmed] = await db
    .select()
    .from(pollCalendarEventsTable)
    .where(
      and(
        eq(pollCalendarEventsTable.pollId, poll.id),
        eq(pollCalendarEventsTable.kind, "confirmed"),
      ),
    )
    .limit(1);
  if (existingConfirmed) {
    const response = await googleRequest(
      access.token,
      `/calendar/v3/calendars/primary/events/${encodeURIComponent(existingConfirmed.googleEventId)}`,
      { method: "GET" },
    );
    if (response.ok) {
      const event = (await response.json()) as { id?: string; htmlLink?: string };
      if (event.id) {
        return { id: event.id, htmlLink: event.htmlLink ?? null };
      }
    }
    if (response.status === 404 || response.status === 410) {
      await db
        .delete(pollCalendarEventsTable)
        .where(eq(pollCalendarEventsTable.id, existingConfirmed.id));
    } else {
      const retryable = await isRetryableGoogleResponse(response);
      throw new CalendarSyncError(
        `Google Calendar confirmed event verification returned ${response.status}`,
        retryable,
        (response.status === 401 || response.status === 403) && !retryable,
      );
    }
  }

  const event = await createGoogleEvent(access.token, {
    eventId: googleEventId(poll.id, candidate.id, "confirmed"),
    summary: poll.title,
    description: `HI-DO-RIで日程調整したイベントです。\n${input.shareUrl}`,
    startAt: candidate.startAt,
    endAt: candidate.endAt,
    privateProperties: {
      hidoriShareId: poll.shareId,
      hidoriPollId: String(poll.id),
      hidoriCandidateId: String(candidate.id),
      hidoriKind: "confirmed",
    },
  });
  await db
    .insert(pollCalendarEventsTable)
    .values({
      pollId: poll.id,
      candidateId: candidate.id,
      googleEventId: event.id,
      htmlLink: event.htmlLink,
      kind: "confirmed",
    })
    .onConflictDoNothing();
  return event;
}

function nextRetryAt(attempt: number, now: Date) {
  const delay = Math.min(
    2 ** Math.max(0, attempt - 1) * RETRY_INTERVAL_MS,
    MAX_RETRY_DELAY_MS,
  );
  return new Date(now.getTime() + delay);
}

async function processCalendarSync(
  pollId: number,
  now = new Date(),
): Promise<CalendarSyncResult | null> {
  const leaseToken = randomUUID();
  const [claimed] = await db
    .update(pollCalendarSyncsTable)
    .set({
      status: "processing",
      leaseToken,
      attempts: sql`${pollCalendarSyncsTable.attempts} + 1`,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(pollCalendarSyncsTable.pollId, pollId),
        eq(pollCalendarSyncsTable.status, "pending"),
        lte(pollCalendarSyncsTable.nextAttemptAt, now),
      ),
    )
    .returning();
  if (!claimed) return null;

  const poll = await db.query.pollsTable.findFirst({
    where: eq(pollsTable.id, pollId),
  });
  if (!poll?.ownerUserId || poll.confirmedCandidateId === null) {
    const error = "Confirmed poll owner could not be found";
    await db
      .update(pollCalendarSyncsTable)
      .set({
        status: "permanent_failure",
        leaseToken: null,
        lastError: error,
        updatedAt: now,
      })
      .where(
        and(
          eq(pollCalendarSyncsTable.pollId, pollId),
          eq(pollCalendarSyncsTable.status, "processing"),
          eq(pollCalendarSyncsTable.leaseToken, leaseToken),
        ),
      );
    return { status: "permanent_failure", error };
  }

  try {
    const event = await finalizePollCalendarEvents({
      pollId,
      ownerUserId: poll.ownerUserId,
      shareUrl: claimed.shareUrl,
    });
    if (!event) {
      await db
        .update(pollCalendarSyncsTable)
        .set({
          status: "succeeded",
          leaseToken: null,
          lastError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(pollCalendarSyncsTable.pollId, pollId),
            eq(pollCalendarSyncsTable.status, "processing"),
            eq(pollCalendarSyncsTable.leaseToken, leaseToken),
          ),
        );
      return { status: "skipped" };
    }
    await db
      .update(pollCalendarSyncsTable)
      .set({
        status: "succeeded",
        leaseToken: null,
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(pollCalendarSyncsTable.pollId, pollId),
          eq(pollCalendarSyncsTable.status, "processing"),
          eq(pollCalendarSyncsTable.leaseToken, leaseToken),
        ),
      );
    return { status: "succeeded", event };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Google Calendar error";
    const retryable =
      error instanceof CalendarSyncError ? error.retryable : true;
    const reconnectRequired =
      error instanceof CalendarSyncError && error.reconnectRequired;
    const exhausted = claimed.attempts >= MAX_SYNC_ATTEMPTS;
    await db
      .update(pollCalendarSyncsTable)
      .set(
        retryable && !exhausted
          ? {
              status: "pending",
              leaseToken: null,
              lastError: message.slice(0, 2_000),
              nextAttemptAt: nextRetryAt(claimed.attempts, now),
              updatedAt: now,
            }
          : {
              status: "permanent_failure",
              leaseToken: null,
              lastError: message.slice(0, 2_000),
              updatedAt: now,
            },
      )
      .where(
        and(
          eq(pollCalendarSyncsTable.pollId, pollId),
          eq(pollCalendarSyncsTable.status, "processing"),
          eq(pollCalendarSyncsTable.leaseToken, leaseToken),
        ),
      );
    logger.error(
      { err: error, pollId, retryable, exhausted, attempts: claimed.attempts },
      "Google Calendar synchronization failed",
    );
    return retryable && !exhausted
      ? { status: "queued" }
      : reconnectRequired
        ? { status: "reconnect_required", error: message }
        : { status: "permanent_failure", error: message };
  }
}

export async function synchronizePollCalendarEvents(input: {
  pollId: number;
  shareUrl: string;
}): Promise<CalendarSyncResult> {
  const now = new Date();
  await db
    .insert(pollCalendarSyncsTable)
    .values({
      pollId: input.pollId,
      shareUrl: input.shareUrl,
      status: "pending",
      nextAttemptAt: now,
    })
    .onConflictDoUpdate({
      target: pollCalendarSyncsTable.pollId,
      set: {
        shareUrl: input.shareUrl,
        status: sql`case when ${pollCalendarSyncsTable.status} = 'processing' then ${pollCalendarSyncsTable.status} else 'pending'::poll_calendar_sync_status end`,
        leaseToken: sql`case when ${pollCalendarSyncsTable.status} = 'processing' then ${pollCalendarSyncsTable.leaseToken} else null end`,
        attempts: sql`case when ${pollCalendarSyncsTable.status} = 'processing' then ${pollCalendarSyncsTable.attempts} else 0 end`,
        nextAttemptAt: sql`case when ${pollCalendarSyncsTable.status} = 'processing' then ${pollCalendarSyncsTable.nextAttemptAt} else ${now} end`,
        lastError: sql`case when ${pollCalendarSyncsTable.status} = 'processing' then ${pollCalendarSyncsTable.lastError} else null end`,
        updatedAt: now,
      },
    });
  return (await processCalendarSync(input.pollId, now)) ?? { status: "queued" };
}

export async function retryDueCalendarSyncs(now = new Date()): Promise<void> {
  await db
    .update(pollCalendarSyncsTable)
    .set({
      status: "pending",
      leaseToken: null,
      nextAttemptAt: now,
      lastError: "Calendar synchronization attempt timed out",
      updatedAt: now,
    })
    .where(
      and(
        eq(pollCalendarSyncsTable.status, "processing"),
        lte(
          pollCalendarSyncsTable.updatedAt,
          new Date(now.getTime() - PROCESSING_TIMEOUT_MS),
        ),
        sql`${pollCalendarSyncsTable.attempts} < ${MAX_SYNC_ATTEMPTS}`,
      ),
    );
  await db
    .update(pollCalendarSyncsTable)
    .set({
      status: "permanent_failure",
      leaseToken: null,
      lastError: "Calendar synchronization retry limit reached",
      updatedAt: now,
    })
    .where(
      and(
        eq(pollCalendarSyncsTable.status, "processing"),
        lte(
          pollCalendarSyncsTable.updatedAt,
          new Date(now.getTime() - PROCESSING_TIMEOUT_MS),
        ),
        sql`${pollCalendarSyncsTable.attempts} >= ${MAX_SYNC_ATTEMPTS}`,
      ),
    );
  const due = await db
    .select({ pollId: pollCalendarSyncsTable.pollId })
    .from(pollCalendarSyncsTable)
    .where(
      and(
        inArray(pollCalendarSyncsTable.status, ["pending"]),
        lte(pollCalendarSyncsTable.nextAttemptAt, now),
      ),
    )
    .limit(SYNC_BATCH_SIZE);
  await Promise.all(due.map(({ pollId }) => processCalendarSync(pollId, now)));
}

export function startCalendarSyncWorker(): NodeJS.Timeout {
  void retryDueCalendarSyncs().catch((error) => {
    logger.error({ err: error }, "Google Calendar retry worker failed");
  });
  const timer = setInterval(() => {
    void retryDueCalendarSyncs().catch((error) => {
      logger.error({ err: error }, "Google Calendar retry worker failed");
    });
  }, RETRY_INTERVAL_MS);
  timer.unref();
  return timer;
}