CREATE TABLE "reservation_payment_failure_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"payment_id" uuid,
	"toss_order_id" varchar(200),
	"diagnostic_kind" varchar(80) NOT NULL,
	"diagnostic_code" varchar(100) NOT NULL,
	"diagnostic_message" varchar(500) NOT NULL,
	"diagnostic_source" varchar(80) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_check_status" varchar(50) DEFAULT 'not_checked' NOT NULL,
	"provider_checked_at" timestamp with time zone,
	"provider_check_message" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservation_payment_failure_diagnostics" ADD CONSTRAINT "reservation_payment_failure_diagnostics_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_payment_failure_diagnostics" ADD CONSTRAINT "reservation_payment_failure_diagnostics_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_reservation_payment_failure_diagnostics_reservation_id" ON "reservation_payment_failure_diagnostics" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "idx_reservation_payment_failure_diagnostics_payment_id" ON "reservation_payment_failure_diagnostics" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "idx_reservation_payment_failure_diagnostics_toss_order_id" ON "reservation_payment_failure_diagnostics" USING btree ("toss_order_id");--> statement-breakpoint
CREATE INDEX "idx_reservation_payment_failure_diagnostics_recorded_at" ON "reservation_payment_failure_diagnostics" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_reservation_payment_failure_diagnostics_provider_check_status" ON "reservation_payment_failure_diagnostics" USING btree ("provider_check_status");
