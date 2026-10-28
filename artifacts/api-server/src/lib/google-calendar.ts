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
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import { resolveCandidateTime } from "./candidate-label-time";

export const GOOGLE_CALENDAR_TIME_ZONE = "Asia/Tokyo";
export const GOOGLE_CALENDAR_RECONNECT_ERROR_CODE =
  "google_calendar_reconnect_required";
const GOOGLE_PROVIDER = "oauth_google";
export const CALENDAR_FREEBUSY_SCOPE =
  "https://www.googleapis.com/auth/calendar.freebusy";
export const CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

/** Resolve stored timestamps or a legacy Japanese label, always in JST. */
export function resolveCandidateTimeRange(
  candidate: { label: string; startAt: Date | null; endAt: Date | null },
  referenceDate: Date = new Date(),
): { startAt: Date; endAt: Date } | null {
  return resolveCandidateTime(candidate, referenceDate);
}

/** Remove external events before their candidate references are deleted. */
export async function removeCandidateCalendarEvents(
  ownerUserId: string,
  pollId: number,
  events: Array<{ googleEventId: string }>,
  removedCandidates: Array<{
    id: number;
    pollId: number;
    label: string;
    startAt: Date | null;
    endAt: Date | null;
    position: number;
  }>,
): Promise<{ status: "ok" | "reconnect_required" | "unavailable" }> {
  const [poll] = removedCandidates.length > 0 ? await db
    .select({ shareId: pollsTable.shareId, title: pollsTable.title, createdAt: pollsTable.createdAt })
    .from(pollsTable)
    .where(eq(pollsTable.id, pollId))
    .limit(1) : [];
  const candidatesWithTime = removedCandidates.flatMap((candidate) => {
    const time = poll ? resolveCandidateTimeRange(candidate, poll.createdAt) : null;
    return time ? [{ ...candidate, ...time }] : [];
  });

  if (events.length === 0 && candidatesWithTime.length === 0) {
    return { status: "ok" };
  }

  const access = await getGoogleAccess(ownerUserId);
  if (access.status === "unavailable") return { status: "unavailable" };
  
  if (events.length === 0 && access.status === "disconnected") {
    return { status: "ok" };
  }
  
  if (access.status !== "connected" || !access.scopes.includes(CALENDAR_EVENTS_SCOPE)) {
    return { status: "reconnect_required" };
  }

  const trackedEventIds = new Set(events.map((e) => e.googleEventId));

  for (const event of events) {
    try {
      const response = await googleRequest(
        access.token,
        `/calendar/v3/calendars/primary/events/${encodeURIComponent(event.googleEventId)}?sendUpdates=none`,
        { method: "DELETE" },
      );
      if (response.status === 401 || response.status === 403) return { status: "reconnect_required" };
      if (!response.ok && response.status !== 404 && response.status !== 410) return { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  }

  if (candidatesWithTime.length > 0) {
    if (poll) {
      try {
        const allStartTimes = candidatesWithTime.map((c) => c.startAt!.getTime());
        const allEndTimes = candidatesWithTime.map((c) => c.endAt!.getTime());
        const timeMin = new Date(Math.min(...allStartTimes) - 24 * 60 * 60 * 1000);
        const timeMax = new Date(Math.max(...allEndTimes) + 24 * 60 * 60 * 1000);

        let nextPageToken: string | undefined;
        do {
          const response = await googleRequest(
            access.token,
            `/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}&singleEvents=true${nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : ""}`,
            { method: "GET" },
          );

          if (response.status === 401 || response.status === 403) return { status: "reconnect_required" };
          if (!response.ok) return { status: "unavailable" };
          const data = (await response.json()) as {
            nextPageToken?: string;
            items?: Array<{
              id?: string;
              summary?: string;
              description?: string;
              start?: { dateTime?: string };
              end?: { dateTime?: string };
              extendedProperties?: { private?: Record<string, string> };
            }>;
          };
          nextPageToken = data.nextPageToken;

          const expectedSummary = `[仮] ${poll.title}`;
          const shareUrlFragment = `/p/${poll.shareId}`;

          for (const item of data.items ?? []) {
            if (!item.id || !item.start?.dateTime || !item.end?.dateTime) continue;
            if (trackedEventIds.has(item.id)) continue;

            const hidoriKind = item.extendedProperties?.private?.hidoriKind;
            if (hidoriKind === "confirmed") continue;

            const itemShareId = item.extendedProperties?.private?.hidoriShareId;
            if (itemShareId && itemShareId !== poll.shareId) continue;

            const itemDescription = item.description ?? "";
            if (itemDescription.includes("/p/") && !itemDescription.includes(shareUrlFragment)) {
              continue;
            }

            const matchesSummary = item.summary === expectedSummary;
            const matchesShareId = itemShareId === poll.shareId;
            const matchesDescription = itemDescription.includes(shareUrlFragment);

            const isTentative = hidoriKind === "tentative" || item.summary?.startsWith("[仮] ");
            if (!isTentative) continue;

            if (!matchesSummary && !matchesShareId && !matchesDescription) continue;

            const eventStart = new Date(item.start.dateTime).getTime();
            const eventEnd = new Date(item.end.dateTime).getTime();

            const matchingCandidate = candidatesWithTime.find(
              (c) =>
                c.startAt!.getTime() === eventStart && c.endAt!.getTime() === eventEnd,
            );

            if (matchingCandidate) {
              try {
                const deleteResponse = await googleRequest(
                  access.token,
                  `/calendar/v3/calendars/primary/events/${encodeURIComponent(item.id)}?sendUpdates=none`,
                  { method: "DELETE" },
                );
                if (deleteResponse.status === 401 || deleteResponse.status === 403) {
                  return { status: "reconnect_required" };
                }
                if (
                  !deleteResponse.ok &&
                  deleteResponse.status !== 404 &&
                  deleteResponse.status !== 410
                ) {
                  return { status: "unavailable" };
                }
              } catch {
                return { status: "unavailable" };
              }
            }
          }
        } while (nextPageToken);
      } catch (error) {
        logger.warn(
          { err: error, pollId },
          "Failed to query and clean up untracked tentative events during candidate deletion",
        );
        return { status: "unavailable" };
      }
    }
  }

  return { status: "ok" };
}
const REQUIRED_SCOPES = [
  CALENDAR_FREEBUSY_SCOPE,
  CALENDAR_EVENTS_SCOPE,
];
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
    const scopes = userId.includes("freebusy-only")
      ? [CALENDAR_FREEBUSY_SCOPE]
      : [...REQUIRED_SCOPES, CALENDAR_EVENTS_SCOPE];
    
    const hasAllRequiredScopes = REQUIRED_SCOPES.every((scope) =>
      scopes.includes(scope),
    );
    
    if (!hasAllRequiredScopes) {
      return { status: "needs_reconnect" as const };
    }
    
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
      scopes,
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
      !token.token ||
      !REQUIRED_SCOPES.every((scope) => token.scopes?.includes(scope))
    ) {
      return { status: "needs_reconnect" as const };
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
  
  const candidatesWithTime = candidates.flatMap((candidate) => {
    if (existingCandidateIds.has(candidate.id)) return [];
    const time = resolveCandidateTimeRange(candidate, poll.createdAt);
    return time ? [{ ...candidate, ...time }] : [];
  });
  
  if (candidatesWithTime.length === 0) return;
  
  let existingGoogleEvents: Map<number, { id: string; htmlLink: string | null }> = new Map();
  
  try {
    const allStartTimes = candidatesWithTime.map(c => c.startAt!.getTime());
    const allEndTimes = candidatesWithTime.map(c => c.endAt!.getTime());
    const timeMin = new Date(Math.min(...allStartTimes));
    const timeMax = new Date(Math.max(...allEndTimes));
    
    let nextPageToken: string | undefined;
    do {
      const response = await googleRequest(
        access.token,
        `/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}&singleEvents=true${nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : ""}`,
        { method: "GET" },
      );
    
      if (!response.ok) {
        logger.warn({ pollId: poll.id, status: response.status },
          "Cannot verify existing tentative events; skipping creation to prevent duplicates");
        return;
      }
      const data = (await response.json()) as {
        nextPageToken?: string;
        items?: Array<{
          id?: string;
          htmlLink?: string;
          summary?: string;
          description?: string;
          start?: { dateTime?: string };
          end?: { dateTime?: string };
          extendedProperties?: { private?: Record<string, string> };
        }>;
      };
      nextPageToken = data.nextPageToken;
      
      const expectedSummary = `[仮] ${poll.title}`;
      const shareUrlFragment = `/p/${poll.shareId}`;
      
      for (const item of data.items ?? []) {
        if (!item.id || !item.start?.dateTime || !item.end?.dateTime) continue;
        
        const hidoriKind = item.extendedProperties?.private?.hidoriKind;
        if (hidoriKind === "confirmed") continue;

        const itemShareId = item.extendedProperties?.private?.hidoriShareId;
        if (itemShareId && itemShareId !== poll.shareId) continue;

        const itemDescription = item.description ?? "";
        if (itemDescription.includes("/p/") && !itemDescription.includes(shareUrlFragment)) {
          continue;
        }

        const matchesSummary = item.summary === expectedSummary;
        const matchesShareId = itemShareId === poll.shareId;
        const matchesDescription = itemDescription.includes(shareUrlFragment);

        const isTentative = hidoriKind === "tentative" || item.summary?.startsWith("[仮] ");
        if (!isTentative) continue;

        if (!matchesSummary && !matchesShareId && !matchesDescription) continue;
        
        const eventStart = new Date(item.start.dateTime).getTime();
        const eventEnd = new Date(item.end.dateTime).getTime();
        
        const matchingCandidate = candidatesWithTime.find(
          (c) =>
            c.startAt!.getTime() === eventStart &&
            c.endAt!.getTime() === eventEnd,
        );
        
        if (matchingCandidate) {
          existingGoogleEvents.set(matchingCandidate.id, {
            id: item.id,
            htmlLink: item.htmlLink ?? null,
          });
        }
      }
    } while (nextPageToken);
  } catch (error) {
    logger.warn(
      { err: error, pollId: poll.id },
      "Failed to query existing Google Calendar events; skipping creation to prevent duplicates",
    );
    return;
  }
  
  await Promise.all(
    candidatesWithTime.map(async (candidate) => {
      try {
        const existingEvent = existingGoogleEvents.get(candidate.id);
        
        let event: GoogleEventResult;
        
        if (existingEvent) {
          event = existingEvent;
          logger.info(
            { pollId: poll.id, candidateId: candidate.id, googleEventId: existingEvent.id },
            "Adopted existing Google Calendar tentative event",
          );
        } else {
          event = await createGoogleEvent(access.token, {
            eventId: googleEventId(poll.id, candidate.id, "tentative"),
            summary: `[仮] ${poll.title}`,
            description: `HI-DO-RIで日程調整中の候補です。\n${input.shareUrl}`,
            startAt: candidate.startAt!,
            endAt: candidate.endAt!,
            privateProperties: {
              hidoriShareId: poll.shareId,
              hidoriPollId: String(poll.id),
              hidoriCandidateId: String(candidate.id),
              hidoriKind: "tentative",
            },
          });
        }
        
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
  if (access.status === "unavailable") {
    throw new CalendarSyncError("Google Calendar connection is temporarily unavailable", true);
  }
  if (access.status === "needs_reconnect" || access.status === "disconnected") {
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
  const candidateTime = candidate ? resolveCandidateTimeRange(candidate, poll.createdAt) : null;
  if (
    !candidate ||
    candidate.pollId !== poll.id ||
    !candidateTime
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

  try {
    const allCandidates = await db
      .select()
      .from(pollCandidatesTable)
      .where(eq(pollCandidatesTable.pollId, poll.id));

    const candidatesWithTime = allCandidates.flatMap((candidate) => {
      const time = resolveCandidateTimeRange(candidate, poll.createdAt);
      return time ? [{ ...candidate, ...time }] : [];
    });

    if (candidatesWithTime.length > 0) {
      const allStartTimes = candidatesWithTime.map((c) => c.startAt!.getTime());
      const allEndTimes = candidatesWithTime.map((c) => c.endAt!.getTime());
      const timeMin = new Date(Math.min(...allStartTimes) - 24 * 60 * 60 * 1000);
      const timeMax = new Date(Math.max(...allEndTimes) + 24 * 60 * 60 * 1000);

      const response = await googleRequest(
        access.token,
        `/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}&singleEvents=true`,
        { method: "GET" },
      );

      if (response.ok) {
        const data = (await response.json()) as {
          items?: Array<{
            id?: string;
            summary?: string;
            description?: string;
            start?: { dateTime?: string };
            end?: { dateTime?: string };
            extendedProperties?: { private?: Record<string, string> };
          }>;
        };

        const expectedSummary = `[仮] ${poll.title}`;
        const shareUrlFragment = `/p/${poll.shareId}`;
        const deletedEventIds = new Set(tentativeEvents.map((e) => e.googleEventId));

        for (const item of data.items ?? []) {
          if (!item.id) continue;
          if (deletedEventIds.has(item.id)) continue;

          const hidoriKind = item.extendedProperties?.private?.hidoriKind;
          if (hidoriKind === "confirmed") continue;

          const itemShareId = item.extendedProperties?.private?.hidoriShareId;
          if (itemShareId && itemShareId !== poll.shareId) continue;

          const itemDescription = item.description ?? "";
          if (itemDescription.includes("/p/") && !itemDescription.includes(shareUrlFragment)) {
            continue;
          }

          const matchesSummary = item.summary === expectedSummary;
          const matchesShareId = itemShareId === poll.shareId;
          const matchesDescription = itemDescription.includes(shareUrlFragment);

          const isTentative = hidoriKind === "tentative" || item.summary?.startsWith("[仮] ");
          if (!isTentative) continue;

          if (matchesSummary || matchesShareId || matchesDescription) {
            try {
              const deleteResponse = await googleRequest(
                access.token,
                `/calendar/v3/calendars/primary/events/${encodeURIComponent(item.id)}?sendUpdates=none`,
                { method: "DELETE" },
              );
              if (
                deleteResponse.ok ||
                deleteResponse.status === 404 ||
                deleteResponse.status === 410
              ) {
                logger.info(
                  { pollId: poll.id, googleEventId: item.id },
                  "Cleaned up untracked tentative event during poll finalization",
                );
              }
            } catch (error) {
              logger.warn(
                { err: error, pollId: poll.id, googleEventId: item.id },
                "Failed to delete untracked tentative event during finalization",
              );
            }
          }
        }
      }
    }
  } catch (error) {
    logger.warn(
      { err: error, pollId: poll.id },
      "Failed to clean up untracked tentative events during poll finalization",
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
    startAt: candidateTime.startAt,
    endAt: candidateTime.endAt,
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

export async function syncOpenOwnerPollsTentativeEvents(
  ownerUserId: string,
  baseUrl = "https://hi-do-ri.replit.app",
): Promise<void> {
  if (
    process.env.NODE_ENV === "test" &&
    (!process.env.GOOGLE_CALENDAR_TEST_TOKEN ||
      !ownerUserId.startsWith("calendar-sync-test-"))
  ) {
    return;
  }
  try {
    const now = new Date();
    const openPolls = await db
      .select({
        id: pollsTable.id,
        shareId: pollsTable.shareId,
        title: pollsTable.title,
        createdAt: pollsTable.createdAt,
      })
      .from(pollsTable)
      .where(
        and(
          eq(pollsTable.ownerUserId, ownerUserId),
          isNull(pollsTable.confirmedCandidateId),
          or(isNull(pollsTable.deadline), gt(pollsTable.deadline, now)),
        ),
      );
    
    for (const poll of openPolls) {
      const candidates = await db
        .select()
        .from(pollCandidatesTable)
        .where(eq(pollCandidatesTable.pollId, poll.id));
      
      if (!candidates.some(candidate => resolveCandidateTimeRange(candidate, poll.createdAt))) {
        continue;
      }
      
      await createTentativePollEvents({
        pollId: poll.id,
        ownerUserId,
        shareUrl: `${baseUrl}/p/${encodeURIComponent(poll.shareId)}`,
      });
    }
  } catch (error) {
    logger.error(
      { err: error, ownerUserId },
      "Failed to sync open polls tentative events",
    );
  }
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