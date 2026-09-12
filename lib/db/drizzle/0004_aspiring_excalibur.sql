CREATE TYPE "public"."feature_request_development_status" AS ENUM('received', 'approved', 'in_progress', 'validating', 'preview_ready', 'completed');--> statement-breakpoint
ALTER TABLE "feature_requests" ADD COLUMN "development_status" "feature_request_development_status" DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_requests" ADD COLUMN "development_note" text;--> statement-breakpoint
ALTER TABLE "feature_requests" ADD COLUMN "development_status_updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_requests" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feature_requests" ADD COLUMN "completed_by" text;