CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."genre" AS ENUM('musical', 'concert', 'play', 'exhibition', 'classic', 'sports', 'kids_family', 'leisure_camping', 'artist_celebrity', 'ip_popup');--> statement-breakpoint
CREATE TYPE "public"."performance_status" AS ENUM('upcoming', 'selling', 'closing_soon', 'ended');--> statement-breakpoint
CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_url" varchar(1000) NOT NULL,
	"link_url" varchar(1000),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "castings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"performance_id" uuid NOT NULL,
	"actor_name" varchar(100) NOT NULL,
	"role_name" varchar(100),
	"photo_url" varchar(1000),
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"genre" "genre" NOT NULL,
	"subcategory" varchar(100),
	"venue_id" uuid,
	"poster_url" varchar(1000),
	"description" text,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"runtime" varchar(50),
	"age_rating" varchar(50) NOT NULL,
	"status" "performance_status" DEFAULT 'upcoming' NOT NULL,
	"sales_info" text,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"performance_id" uuid NOT NULL,
	"tier_name" varchar(50) NOT NULL,
	"price" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seat_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"performance_id" uuid NOT NULL,
	"svg_url" varchar(1000) NOT NULL,
	"seat_config" jsonb,
	"total_seats" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "showtimes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"performance_id" uuid NOT NULL,
	"date_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "castings" ADD CONSTRAINT "castings_performance_id_performances_id_fk" FOREIGN KEY ("performance_id") REFERENCES "public"."performances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performances" ADD CONSTRAINT "performances_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_performance_id_performances_id_fk" FOREIGN KEY ("performance_id") REFERENCES "public"."performances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_maps" ADD CONSTRAINT "seat_maps_performance_id_performances_id_fk" FOREIGN KEY ("performance_id") REFERENCES "public"."performances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtimes" ADD CONSTRAINT "showtimes_performance_id_performances_id_fk" FOREIGN KEY ("performance_id") REFERENCES "public"."performances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_castings_performance_id" ON "castings" USING btree ("performance_id");--> statement-breakpoint
CREATE INDEX "idx_performances_genre" ON "performances" USING btree ("genre");--> statement-breakpoint
CREATE INDEX "idx_performances_status" ON "performances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_performances_title_trgm" ON "performances" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_price_tiers_performance_id" ON "price_tiers" USING btree ("performance_id");--> statement-breakpoint
CREATE INDEX "idx_seat_maps_performance_id" ON "seat_maps" USING btree ("performance_id");--> statement-breakpoint
CREATE INDEX "idx_showtimes_performance_id" ON "showtimes" USING btree ("performance_id");--> statement-breakpoint
ALTER TABLE "performances" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("title", ''))) STORED;--> statement-breakpoint
CREATE INDEX "idx_performances_search" ON "performances" USING gin("search_vector");
