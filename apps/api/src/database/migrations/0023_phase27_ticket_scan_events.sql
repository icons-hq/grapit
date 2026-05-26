CREATE TYPE "public"."ticket_scan_result" AS ENUM('success', 'duplicate', 'tampered', 'refunded_cancelled', 'expired', 'wrong_showtime', 'already_used', 'offline_pending', 'offline_synced', 'offline_rejected', 'sync_failure');--> statement-breakpoint
CREATE TYPE "public"."ticket_scan_source" AS ENUM('online', 'offline_sync');--> statement-breakpoint
CREATE TYPE "public"."ticket_scan_sync_state" AS ENUM('not_required', 'pending', 'synced', 'rejected', 'failed');--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'field.scan.verify';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'field.scan.consume';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'field.scan.offline_sync';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'settlement.export';--> statement-breakpoint
CREATE TABLE "ticket_scan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"showtime_id" uuid NOT NULL,
	"scanner_user_id" uuid NOT NULL,
	"result" "ticket_scan_result" NOT NULL,
	"source" "ticket_scan_source" DEFAULT 'online' NOT NULL,
	"sync_state" "ticket_scan_sync_state" DEFAULT 'not_required' NOT NULL,
	"prior_scan_event_id" uuid,
	"device_attempt_id" varchar(120),
	"masked_jti" varchar(120),
	"rejection_reason" text,
	"metadata" jsonb,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_scan_events" ADD CONSTRAINT "ticket_scan_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_scan_events" ADD CONSTRAINT "ticket_scan_events_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_scan_events" ADD CONSTRAINT "ticket_scan_events_showtime_id_showtimes_id_fk" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_scan_events" ADD CONSTRAINT "ticket_scan_events_scanner_user_id_users_id_fk" FOREIGN KEY ("scanner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ticket_scan_events_showtime_id" ON "ticket_scan_events" USING btree ("showtime_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_scan_events_result" ON "ticket_scan_events" USING btree ("result");--> statement-breakpoint
CREATE INDEX "idx_ticket_scan_events_scanner_user_id" ON "ticket_scan_events" USING btree ("scanner_user_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_scan_events_device_attempt_id" ON "ticket_scan_events" USING btree ("device_attempt_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_scan_events_created_at" ON "ticket_scan_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ticket_scan_events_device_attempt_unique" ON "ticket_scan_events" USING btree ("device_attempt_id") WHERE "ticket_scan_events"."device_attempt_id" IS NOT NULL;
