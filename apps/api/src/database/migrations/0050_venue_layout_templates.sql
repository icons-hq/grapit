SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'venue.layout.create' AFTER 'event.delete';
--> statement-breakpoint
ALTER TABLE "venue_layout_floors" ADD COLUMN "seat_config" jsonb;--> statement-breakpoint
ALTER TABLE "venue_layouts" ADD COLUMN "is_template" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_venue_layouts_templates" ON "venue_layouts" USING btree ("venue_id","is_template","layout_name","version");
