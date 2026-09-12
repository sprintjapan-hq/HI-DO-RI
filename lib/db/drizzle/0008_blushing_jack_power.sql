CREATE TYPE "public"."poll_calendar_sync_status" AS ENUM('pending', 'processing', 'succeeded', 'permanent_failure');--> statement-breakpoint
CREATE TABLE "poll_calendar_syncs" (
	"poll_id" integer PRIMARY KEY NOT NULL,
	"share_url" text NOT NULL,
	"status" "poll_calendar_sync_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "poll_calendar_syncs" ADD CONSTRAINT "poll_calendar_syncs_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poll_calendar_syncs_due_idx" ON "poll_calendar_syncs" USING btree ("status","next_attempt_at");