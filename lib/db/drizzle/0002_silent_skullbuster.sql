CREATE TYPE "public"."feature_request_notification_status" AS ENUM('pending', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "feature_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"request" text NOT NULL,
	"use_case" text,
	"notification_status" "feature_request_notification_status" DEFAULT 'pending' NOT NULL,
	"notification_attempts" integer DEFAULT 0 NOT NULL,
	"next_notification_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notification_error" text,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
