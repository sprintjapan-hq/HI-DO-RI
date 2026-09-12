CREATE TABLE "calendar_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"external_account_id" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "poll_candidates" ADD COLUMN "start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "poll_candidates" ADD COLUMN "end_at" timestamp with time zone;