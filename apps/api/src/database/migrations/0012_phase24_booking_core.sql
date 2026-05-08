CREATE TYPE "public"."booking_operation_action" AS ENUM('manual_open');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('requested', 'sent_to_pg', 'processing_at_pg', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('active', 'revoked', 'used', 'expired');--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'IN_PROGRESS' BEFORE 'DONE';--> statement-breakpoint
ALTER TYPE "public"."seat_status" ADD VALUE 'held_cancelled' BEFORE 'sold';--> statement-breakpoint
CREATE TABLE "booking_operation_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_user_id" uuid NOT NULL,
	"action" "booking_operation_action" NOT NULL,
	"seat_key" varchar(80) NOT NULL,
	"reservation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"performance_id" uuid NOT NULL,
	"max_tickets_per_user" integer DEFAULT 1 NOT NULL,
	"change_policy_enabled" boolean DEFAULT false NOT NULL,
	"allowed_payment_methods" jsonb DEFAULT '["CARD"]'::jsonb NOT NULL,
	"payment_window_minutes" integer DEFAULT 7 NOT NULL,
	"seat_hold_minutes" integer DEFAULT 10 NOT NULL,
	"cancelled_seat_hold_min_minutes" integer DEFAULT 1 NOT NULL,
	"cancelled_seat_hold_max_minutes" integer DEFAULT 10 NOT NULL,
	"manual_open_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid,
	"reservation_id" uuid,
	"payment_key" varchar(200),
	"toss_order_id" varchar(200),
	"event_id" varchar(200) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_result_code" varchar(100),
	"processing_result_message" varchar(500)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"status" "refund_status" DEFAULT 'requested' NOT NULL,
	"provider" varchar(50) NOT NULL,
	"provider_refund_key" varchar(200),
	"result_code" varchar(100),
	"result_message" varchar(500),
	"failure_reason" varchar(500),
	"provider_metadata" jsonb,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"customer_service_cta_visible" boolean DEFAULT false NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_to_pg_at" timestamp with time zone,
	"processing_at_pg_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"expected_deposit_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"showtime_id" uuid NOT NULL,
	"qr_token_jti" varchar(200) NOT NULL,
	"secret_version" varchar(100) NOT NULL,
	"status" "ticket_status" DEFAULT 'active' NOT NULL,
	"email_job_id" varchar(200),
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"email_scheduled_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_qr_token_jti_unique" UNIQUE("qr_token_jti")
);
--> statement-breakpoint
DROP INDEX "idx_seat_inv_showtime_seat";--> statement-breakpoint
DROP INDEX "idx_seat_maps_performance_id";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider" varchar(50) DEFAULT 'CARD' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "currency" varchar(10) DEFAULT 'KRW' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "async_status" varchar(50) DEFAULT 'sync' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "pending_url" varchar(1000);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "disclaimer_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "disclaimer_version" varchar(50);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "disclaimer_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "queue_session_id" varchar(200);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "admission_token" varchar(500);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "refresh_family_id" varchar(200);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "device_slot_key" varchar(200);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "admitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "admission_active_until_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "reentry_grace_until_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "payment_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seat_inventories" ADD COLUMN "floor_key" varchar(20) DEFAULT '1F' NOT NULL;--> statement-breakpoint
ALTER TABLE "seat_inventories" ADD COLUMN "seat_key" varchar(80);--> statement-breakpoint
ALTER TABLE "seat_inventories" ADD COLUMN "reopen_hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seat_inventories" ADD COLUMN "reopen_job_id" varchar(200);--> statement-breakpoint
ALTER TABLE "seat_inventories" ADD COLUMN "held_cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seat_maps" ADD COLUMN "floor_key" varchar(20) DEFAULT '1F' NOT NULL;--> statement-breakpoint
ALTER TABLE "seat_maps" ADD COLUMN "floor_label" varchar(100) DEFAULT '1층' NOT NULL;--> statement-breakpoint
ALTER TABLE "seat_maps" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_operation_audit_logs" ADD CONSTRAINT "booking_operation_audit_logs_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_operation_audit_logs" ADD CONSTRAINT "booking_operation_audit_logs_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policies_performance_id_performances_id_fk" FOREIGN KEY ("performance_id") REFERENCES "public"."performances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_showtime_id_showtimes_id_fk" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_booking_operation_audit_logs_operator_user_id" ON "booking_operation_audit_logs" USING btree ("operator_user_id");--> statement-breakpoint
CREATE INDEX "idx_booking_operation_audit_logs_reservation_id" ON "booking_operation_audit_logs" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "idx_booking_operation_audit_logs_seat_key" ON "booking_operation_audit_logs" USING btree ("seat_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_booking_policies_performance_id" ON "booking_policies" USING btree ("performance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_webhook_events_event_id" ON "payment_webhook_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_payment_webhook_events_event_type" ON "payment_webhook_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_payment_webhook_events_received_at" ON "payment_webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "idx_payment_webhook_events_payment_key" ON "payment_webhook_events" USING btree ("payment_key");--> statement-breakpoint
CREATE INDEX "idx_payment_webhook_events_toss_order_id" ON "payment_webhook_events" USING btree ("toss_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_refunds_reservation_id" ON "refunds" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_refunds_payment_id" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "idx_refunds_status" ON "refunds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_refunds_requested_at" ON "refunds" USING btree ("requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tickets_reservation_id" ON "tickets" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tickets_payment_id" ON "tickets" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_showtime_id" ON "tickets" USING btree ("showtime_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_status" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_reservations_queue_session_id" ON "reservations" USING btree ("queue_session_id");--> statement-breakpoint
CREATE INDEX "idx_reservations_payment_deadline_at" ON "reservations" USING btree ("payment_deadline_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_seat_inv_showtime_floor_seat_key" ON "seat_inventories" USING btree ("showtime_id","floor_key","seat_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_seat_maps_performance_floor_key" ON "seat_maps" USING btree ("performance_id","floor_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_translation_drafts_one_published_per_source_locale" ON "translation_drafts" USING btree ("source_id","target_locale") WHERE "translation_drafts"."status" = 'published';