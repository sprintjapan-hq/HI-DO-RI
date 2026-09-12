import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pollCandidatesTable, pollsTable } from "./polls.ts";

export const pollCalendarEventsTable = pgTable(
  "poll_calendar_events",
  {
    id: serial("id").primaryKey(),
    pollId: integer("poll_id")
      .notNull()
      .references(() => pollsTable.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id").references(() => pollCandidatesTable.id, {
      onDelete: "cascade",
    }),
    googleEventId: text("google_event_id").notNull(),
    htmlLink: text("html_link"),
    kind: text("kind").$type<"tentative" | "confirmed">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("poll_calendar_events_google_event_idx").on(table.googleEventId),
    uniqueIndex("poll_calendar_events_candidate_kind_idx").on(
      table.pollId,
      table.candidateId,
      table.kind,
    ),
    uniqueIndex("poll_calendar_events_one_confirmed_idx")
      .on(table.pollId)
      .where(sql`${table.kind} = 'confirmed'`),
    check(
      "poll_calendar_events_kind_check",
      sql`${table.kind} in ('tentative', 'confirmed')`,
    ),
  ],
);

export const pollCalendarSyncStatusEnum = pgEnum("poll_calendar_sync_status", [
  "pending",
  "processing",
  "succeeded",
  "permanent_failure",
]);

export const pollCalendarSyncsTable = pgTable(
  "poll_calendar_syncs",
  {
    pollId: integer("poll_id")
      .primaryKey()
      .references(() => pollsTable.id, { onDelete: "cascade" }),
    shareUrl: text("share_url").notNull(),
    status: pollCalendarSyncStatusEnum("status").notNull().default("pending"),
    leaseToken: text("lease_token"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("poll_calendar_syncs_due_idx").on(table.status, table.nextAttemptAt),
  ],
);

export const insertPollCalendarEventSchema = createInsertSchema(
  pollCalendarEventsTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertPollCalendarEvent = z.infer<
  typeof insertPollCalendarEventSchema
>;
export type PollCalendarEvent = typeof pollCalendarEventsTable.$inferSelect;
export type PollCalendarSync = typeof pollCalendarSyncsTable.$inferSelect;