CREATE TABLE "poll_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"poll_id" integer NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"poll_id" integer NOT NULL,
	"name" text NOT NULL,
	"answers" jsonb NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" serial PRIMARY KEY NOT NULL,
	"share_id" text NOT NULL,
	"admin_key" text,
	"title" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"deadline" timestamp with time zone,
	"confirmed_candidate_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "polls_share_id_unique" UNIQUE("share_id"),
	CONSTRAINT "polls_admin_key_unique" UNIQUE("admin_key")
);
--> statement-breakpoint
ALTER TABLE "poll_candidates" ADD CONSTRAINT "poll_candidates_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_responses" ADD CONSTRAINT "poll_responses_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "poll_responses_poll_name_idx" ON "poll_responses" USING btree ("poll_id","name");