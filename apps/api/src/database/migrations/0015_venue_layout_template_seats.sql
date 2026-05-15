ALTER TYPE "public"."seat_status" ADD VALUE IF NOT EXISTS 'disabled' BEFORE 'sold';--> statement-breakpoint
CREATE TYPE "public"."performance_seat_sale_status" AS ENUM('available', 'blocked');--> statement-breakpoint
CREATE TABLE "venue_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"layout_name" varchar(255) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"source_svg_url" varchar(1000),
	"normalized_svg_url" varchar(1000),
	"stage_position" varchar(20) DEFAULT 'top' NOT NULL,
	"viewport" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_layout_floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layout_id" uuid NOT NULL,
	"floor_key" varchar(20) NOT NULL,
	"floor_label" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"svg_url" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_layout_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid NOT NULL,
	"section_key" varchar(80) NOT NULL,
	"section_label" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_layout_seats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layout_id" uuid NOT NULL,
	"floor_id" uuid NOT NULL,
	"section_id" uuid,
	"seat_key" varchar(120) NOT NULL,
	"source_seat_id" varchar(120) NOT NULL,
	"row_label" varchar(50),
	"seat_number" varchar(50),
	"x" integer,
	"y" integer,
	"is_accessible" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_seat_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"performance_id" uuid NOT NULL,
	"tier_name" varchar(50) NOT NULL,
	"color" varchar(20) NOT NULL,
	"price" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_seat_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"performance_id" uuid NOT NULL,
	"layout_seat_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"sale_status" "performance_seat_sale_status" DEFAULT 'available' NOT NULL,
	"block_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seat_inventories" ADD COLUMN "layout_seat_id" uuid;--> statement-breakpoint
ALTER TABLE "seat_inventories" ADD COLUMN "performance_seat_assignment_id" uuid;--> statement-breakpoint
ALTER TABLE "seat_maps" ADD COLUMN "venue_layout_id" uuid;--> statement-breakpoint
ALTER TABLE "seat_inventories" ALTER COLUMN "seat_id" TYPE varchar(120);--> statement-breakpoint
ALTER TABLE "seat_inventories" ALTER COLUMN "seat_key" TYPE varchar(120);--> statement-breakpoint
ALTER TABLE "reservation_seats" ALTER COLUMN "seat_id" TYPE varchar(120);--> statement-breakpoint
ALTER TABLE "reservation_seats" ALTER COLUMN "row" TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "reservation_seats" ALTER COLUMN "number" TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "booking_operation_audit_logs" ALTER COLUMN "seat_key" TYPE varchar(120);--> statement-breakpoint
ALTER TABLE "venue_layouts" ADD CONSTRAINT "venue_layouts_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_layout_floors" ADD CONSTRAINT "venue_layout_floors_layout_id_venue_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."venue_layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_layout_sections" ADD CONSTRAINT "venue_layout_sections_floor_id_venue_layout_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."venue_layout_floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_layout_seats" ADD CONSTRAINT "venue_layout_seats_layout_id_venue_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."venue_layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_layout_seats" ADD CONSTRAINT "venue_layout_seats_floor_id_venue_layout_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."venue_layout_floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_layout_seats" ADD CONSTRAINT "venue_layout_seats_section_id_venue_layout_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."venue_layout_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_seat_tiers" ADD CONSTRAINT "performance_seat_tiers_performance_id_performances_id_fk" FOREIGN KEY ("performance_id") REFERENCES "public"."performances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_seat_assignments" ADD CONSTRAINT "performance_seat_assignments_performance_id_performances_id_fk" FOREIGN KEY ("performance_id") REFERENCES "public"."performances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_seat_assignments" ADD CONSTRAINT "performance_seat_assignments_layout_seat_id_venue_layout_seats_id_fk" FOREIGN KEY ("layout_seat_id") REFERENCES "public"."venue_layout_seats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_seat_assignments" ADD CONSTRAINT "performance_seat_assignments_tier_id_performance_seat_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."performance_seat_tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_inventories" ADD CONSTRAINT "seat_inventories_layout_seat_id_venue_layout_seats_id_fk" FOREIGN KEY ("layout_seat_id") REFERENCES "public"."venue_layout_seats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_inventories" ADD CONSTRAINT "seat_inventories_performance_seat_assignment_id_performance_seat_assignments_id_fk" FOREIGN KEY ("performance_seat_assignment_id") REFERENCES "public"."performance_seat_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_maps" ADD CONSTRAINT "seat_maps_venue_layout_id_venue_layouts_id_fk" FOREIGN KEY ("venue_layout_id") REFERENCES "public"."venue_layouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_venue_layouts_venue_name_version" ON "venue_layouts" USING btree ("venue_id","layout_name","version");--> statement-breakpoint
CREATE INDEX "idx_venue_layouts_venue_active" ON "venue_layouts" USING btree ("venue_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_venue_layout_floors_layout_floor" ON "venue_layout_floors" USING btree ("layout_id","floor_key");--> statement-breakpoint
CREATE INDEX "idx_venue_layout_floors_layout_sort" ON "venue_layout_floors" USING btree ("layout_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_venue_layout_sections_floor_section" ON "venue_layout_sections" USING btree ("floor_id","section_key");--> statement-breakpoint
CREATE INDEX "idx_venue_layout_sections_floor_sort" ON "venue_layout_sections" USING btree ("floor_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_venue_layout_seats_layout_seat_key" ON "venue_layout_seats" USING btree ("layout_id","seat_key");--> statement-breakpoint
CREATE INDEX "idx_venue_layout_seats_floor_sort" ON "venue_layout_seats" USING btree ("floor_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_venue_layout_seats_source_seat_id" ON "venue_layout_seats" USING btree ("source_seat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_performance_seat_tiers_performance_name" ON "performance_seat_tiers" USING btree ("performance_id","tier_name");--> statement-breakpoint
CREATE INDEX "idx_performance_seat_tiers_performance_sort" ON "performance_seat_tiers" USING btree ("performance_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_performance_seat_assignments_performance_seat" ON "performance_seat_assignments" USING btree ("performance_id","layout_seat_id");--> statement-breakpoint
CREATE INDEX "idx_performance_seat_assignments_tier" ON "performance_seat_assignments" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "idx_performance_seat_assignments_sale_status" ON "performance_seat_assignments" USING btree ("sale_status");--> statement-breakpoint
CREATE INDEX "idx_seat_maps_venue_layout_id" ON "seat_maps" USING btree ("venue_layout_id");
