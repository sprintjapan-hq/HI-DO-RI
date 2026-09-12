import {
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const featureRequestNotificationStatusEnum = pgEnum(
  "feature_request_notification_status",
  ["pending", "sending", "sent", "failed"],
);
export const featureRequestDevelopmentStatusEnum = pgEnum(
  "feature_request_development_status",
  ["received", "approved", "in_progress", "validating", "preview_ready", "completed"],
);

export const featureRequestsTable = pgTable("feature_requests", {
  id: serial("id").primaryKey(),
  notificationKey: text("notification_key").notNull().unique(),
  name: text("name").notNull(),
  contact: text("contact"),
  request: text("request").notNull(),
  useCase: text("use_case"),
  notificationStatus: featureRequestNotificationStatusEnum("notification_status")
    .notNull()
    .default("pending"),
  notificationAttempts: integer("notification_attempts").notNull().default(0),
  nextNotificationAttemptAt: timestamp("next_notification_attempt_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
  notificationError: text("notification_error"),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  developmentStatus: featureRequestDevelopmentStatusEnum("development_status")
    .notNull()
    .default("received"),
  developmentNote: text("development_note"),
  developmentStatusUpdatedAt: timestamp("development_status_updated_at", {
    withTimezone: true,
  }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: text("completed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertFeatureRequestSchema = createInsertSchema(
  featureRequestsTable,
).omit({
  id: true,
  notificationStatus: true,
  notificationAttempts: true,
  nextNotificationAttemptAt: true,
  notificationError: true,
  notifiedAt: true,
    developmentStatus: true,
    developmentNote: true,
    developmentStatusUpdatedAt: true,
    completedAt: true,
    completedBy: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFeatureRequest = z.infer<typeof insertFeatureRequestSchema>;
export type FeatureRequest = typeof featureRequestsTable.$inferSelect;