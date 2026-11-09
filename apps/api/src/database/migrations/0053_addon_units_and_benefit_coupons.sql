DROP INDEX "booking_addon_open_hold";--> statement-breakpoint
DROP INDEX "booking_addon_order_item";--> statement-breakpoint
ALTER TABLE "ticket_benefit_redemption_records" ADD COLUMN "redemption_channel" varchar(24) DEFAULT 'scanner_qr' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_addon_holds" ADD COLUMN "unit_index" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_addons" ADD COLUMN "max_per_ticket" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_addon_open_hold" ON "booking_addon_holds" USING btree ("addon_id","user_id","seat_key","unit_index") WHERE "booking_addon_holds"."reservation_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_addon_order_item" ON "booking_addon_holds" USING btree ("reservation_id","addon_id","seat_key","unit_index");--> statement-breakpoint
ALTER TABLE "ticket_benefit_redemption_records" ADD CONSTRAINT "tbrr_redemption_channel_check" CHECK ("ticket_benefit_redemption_records"."redemption_channel" IN ('scanner_qr', 'buyer_device'));--> statement-breakpoint
ALTER TABLE "booking_addon_holds" ADD CONSTRAINT "booking_addon_hold_unit_index" CHECK ("booking_addon_holds"."unit_index" BETWEEN 1 AND 10);--> statement-breakpoint
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_max_per_ticket" CHECK ("booking_addons"."max_per_ticket" BETWEEN 1 AND 10);