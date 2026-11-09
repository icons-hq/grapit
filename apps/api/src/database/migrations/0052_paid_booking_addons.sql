ALTER TYPE "public"."ticket_benefit_entitlement_source" ADD VALUE 'purchase';--> statement-breakpoint
ALTER TYPE "public"."ticket_benefit_kind" ADD VALUE 'paid';--> statement-breakpoint
CREATE TABLE "booking_addon_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"addon_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seat_key" varchar(120) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reservation_id" uuid,
	"price" integer NOT NULL,
	"display_copy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_addon_hold_positive_price" CHECK ("booking_addon_holds"."price" > 0)
);
--> statement-breakpoint
CREATE TABLE "booking_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"showtime_id" uuid NOT NULL,
	"identity" varchar(80) NOT NULL,
	"display_copy" jsonb NOT NULL,
	"price" integer NOT NULL,
	"capacity" integer NOT NULL,
	"eligible_tier_names" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_addons_positive" CHECK ("booking_addons"."price" > 0 AND "booking_addons"."capacity" > 0)
);
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "addon_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_benefit_entitlements" ADD COLUMN "booking_addon_hold_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_items" ADD COLUMN "addon_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_addon_holds" ADD CONSTRAINT "booking_addon_holds_addon_id_booking_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."booking_addons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_addon_holds" ADD CONSTRAINT "booking_addon_holds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_addon_holds" ADD CONSTRAINT "booking_addon_holds_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_showtime_id_showtimes_id_fk" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_addon_open_hold" ON "booking_addon_holds" USING btree ("addon_id","user_id","seat_key") WHERE "booking_addon_holds"."reservation_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_addon_order_item" ON "booking_addon_holds" USING btree ("reservation_id","addon_id","seat_key");--> statement-breakpoint
CREATE INDEX "booking_addon_hold_capacity" ON "booking_addon_holds" USING btree ("addon_id","expires_at");--> statement-breakpoint
CREATE INDEX "booking_addon_hold_owner" ON "booking_addon_holds" USING btree ("user_id","reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_addons_showtime_identity" ON "booking_addons" USING btree ("showtime_id","identity");--> statement-breakpoint
ALTER TABLE "ticket_benefit_entitlements" ADD CONSTRAINT "ticket_benefit_entitlements_booking_addon_hold_id_booking_addon_holds_id_fk" FOREIGN KEY ("booking_addon_hold_id") REFERENCES "public"."booking_addon_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tbe_booking_addon_hold" ON "ticket_benefit_entitlements" USING btree ("booking_addon_hold_id");