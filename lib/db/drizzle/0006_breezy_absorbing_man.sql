CREATE TABLE "poll_calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"poll_id" integer NOT NULL,
	"candidate_id" integer,
	"google_event_id" text NOT NULL,
	"html_link" text,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "poll_calendar_events" ADD CONSTRAINT "poll_calendar_events_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_calendar_events" ADD CONSTRAINT "poll_calendar_events_candidate_id_poll_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."poll_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "poll_calendar_events_google_event_idx" ON "poll_calendar_events" USING btree ("google_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_calendar_events_candidate_kind_idx" ON "poll_calendar_events" USING btree ("poll_id","candidate_id","kind");