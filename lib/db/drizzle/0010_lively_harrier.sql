CREATE TABLE "analytics_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" text NOT NULL,
	"path" text NOT NULL,
	"utm_source" text,
	"utm_campaign" text,
	"utm_content" text
);
--> statement-breakpoint
CREATE INDEX "analytics_events_created_at_idx" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_utm_campaign_event_idx" ON "analytics_events" USING btree ("utm_campaign","event");