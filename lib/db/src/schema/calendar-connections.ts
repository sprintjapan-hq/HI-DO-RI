import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const calendarConnectionsTable = pgTable("calendar_connections", {
  userId: text("user_id").primaryKey(),
  externalAccountId: text("external_account_id").notNull(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCalendarConnectionSchema = createInsertSchema(calendarConnectionsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertCalendarConnection = z.infer<typeof insertCalendarConnectionSchema>;
export type CalendarConnection = typeof calendarConnectionsTable.$inferSelect;