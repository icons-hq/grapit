CREATE TABLE "qr_reminder_deliveries" (
	"reservation_id" uuid PRIMARY KEY NOT NULL,
	"claim_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"first_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"provider_message_id" varchar(200),
	"attention_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qr_reminder_deliveries" ADD CONSTRAINT "qr_reminder_deliveries_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tickets_due_reminder" ON "tickets" USING btree ("email_scheduled_at","reservation_id") WHERE "tickets"."status" = 'active' AND "tickets"."email_sent_at" IS NULL;