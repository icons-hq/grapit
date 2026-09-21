ALTER TABLE "reservations" ADD COLUMN "checkout_payment_method" jsonb;
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "checkout_started_at" timestamp with time zone;
