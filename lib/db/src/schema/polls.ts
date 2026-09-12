import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pollsTable = pgTable("polls", {
  id: serial("id").primaryKey(),
  shareId: text("share_id").notNull().unique(),
  adminKey: text("admin_key").unique(),
  ownerUserId: text("owner_user_id"),
  title: text("title").notNull(),
  note: text("note").notNull().default(""),
  deadline: timestamp("deadline", { withTimezone: true }),
  confirmedCandidateId: integer("confirmed_candidate_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pollCandidatesTable = pgTable("poll_candidates", {
  id: serial("id").primaryKey(),
  pollId: integer("poll_id")
    .notNull()
    .references(() => pollsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  position: integer("position").notNull(),
});

export const pollResponsesTable = pgTable(
  "poll_responses",
  {
    id: serial("id").primaryKey(),
    pollId: integer("poll_id")
      .notNull()
      .references(() => pollsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    answers: jsonb("answers").$type<Array<"yes" | "maybe" | "no">>().notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("poll_responses_poll_name_idx").on(table.pollId, table.name)],
);

export const insertPollSchema = createInsertSchema(pollsTable).omit({
  id: true,
  createdAt: true,
});
export const insertPollCandidateSchema = createInsertSchema(pollCandidatesTable).omit({
  id: true,
});
export const insertPollResponseSchema = createInsertSchema(pollResponsesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPoll = z.infer<typeof insertPollSchema>;
export type Poll = typeof pollsTable.$inferSelect;
export type PollCandidate = typeof pollCandidatesTable.$inferSelect;
export type PollResponse = typeof pollResponsesTable.$inferSelect;