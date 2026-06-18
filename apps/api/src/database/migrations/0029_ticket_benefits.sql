CREATE TYPE "public"."ticket_benefit_kind" AS ENUM('included', 'limited');--> statement-breakpoint
CREATE TYPE "public"."ticket_benefit_configuration_change_action" AS ENUM('created', 'updated', 'activated', 'deactivated', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."ticket_benefit_run_mode" AS ENUM('live', 'test');--> statement-breakpoint
CREATE TYPE "public"."ticket_benefit_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ticket_benefit_entitlement_source" AS ENUM('configuration', 'live_run', 'rollback');--> statement-breakpoint
CREATE TYPE "public"."ticket_benefit_entitlement_state" AS ENUM('active', 'inactive', 'redeemed');--> statement-breakpoint
CREATE TYPE "public"."ticket_benefit_redemption_result" AS ENUM('redeemed', 'duplicate', 'not_eligible', 'inactive', 'tampered', 'wrong_showtime');--> statement-breakpoint
CREATE TABLE "ticket_benefit_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"showtime_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_benefit_configuration_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"showtime_id" uuid NOT NULL,
	"configuration_id" uuid,
	"action" "ticket_benefit_configuration_change_action" NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason" text,
	"before_snapshot" jsonb,
	"after_snapshot" jsonb,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_benefits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"configuration_id" uuid NOT NULL,
	"identity" varchar(120) NOT NULL,
	"kind" "ticket_benefit_kind" NOT NULL,
	"display_copy" jsonb NOT NULL,
	"eligible_tier_names" jsonb NOT NULL,
	"quantity" integer,
	"selection_priority" integer,
	"mutual_exclusion_group" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_benefit_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"showtime_id" uuid NOT NULL,
	"mode" "ticket_benefit_run_mode" NOT NULL,
	"status" "ticket_benefit_run_status" DEFAULT 'running' NOT NULL,
	"configuration_snapshot" jsonb NOT NULL,
	"seed_ref" varchar(160) NOT NULL,
	"random_seed_internal" varchar(256) NOT NULL,
	"result_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_benefit_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"showtime_id" uuid NOT NULL,
	"ticket_item_id" uuid NOT NULL,
	"benefit_identity" varchar(120) NOT NULL,
	"benefit_kind" "ticket_benefit_kind" NOT NULL,
	"display_copy_snapshot" jsonb NOT NULL,
	"source" "ticket_benefit_entitlement_source" NOT NULL,
	"run_id" uuid,
	"state" "ticket_benefit_entitlement_state" DEFAULT 'active' NOT NULL,
	"inactive_reason" text,
	"redeemed_at" timestamp with time zone,
	"redeemed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_benefit_redemption_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"showtime_id" uuid NOT NULL,
	"ticket_item_id" uuid NOT NULL,
	"benefit_entitlement_id" uuid NOT NULL,
	"scanner_user_id" uuid NOT NULL,
	"device_attempt_id" varchar(120) NOT NULL,
	"redacted_token_ref" varchar(160) NOT NULL,
	"result" "ticket_benefit_redemption_result" NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_benefit_configurations" ADD CONSTRAINT "ticket_benefit_configurations_showtime_id_showtimes_id_fk" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_configurations" ADD CONSTRAINT "ticket_benefit_configurations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_configurations" ADD CONSTRAINT "ticket_benefit_configurations_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_configuration_changes" ADD CONSTRAINT "tbc_changes_showtime_id_fk" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_configuration_changes" ADD CONSTRAINT "tbc_changes_configuration_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."ticket_benefit_configurations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_configuration_changes" ADD CONSTRAINT "tbc_changes_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefits" ADD CONSTRAINT "ticket_benefits_configuration_id_ticket_benefit_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."ticket_benefit_configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_runs" ADD CONSTRAINT "ticket_benefit_runs_showtime_id_showtimes_id_fk" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_runs" ADD CONSTRAINT "ticket_benefit_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_entitlements" ADD CONSTRAINT "ticket_benefit_entitlements_showtime_id_showtimes_id_fk" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_entitlements" ADD CONSTRAINT "ticket_benefit_entitlements_ticket_item_id_ticket_items_id_fk" FOREIGN KEY ("ticket_item_id") REFERENCES "public"."ticket_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_entitlements" ADD CONSTRAINT "ticket_benefit_entitlements_run_id_ticket_benefit_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ticket_benefit_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_entitlements" ADD CONSTRAINT "ticket_benefit_entitlements_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_redemption_records" ADD CONSTRAINT "tbrr_showtime_id_fk" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_redemption_records" ADD CONSTRAINT "tbrr_ticket_item_id_fk" FOREIGN KEY ("ticket_item_id") REFERENCES "public"."ticket_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_redemption_records" ADD CONSTRAINT "tbrr_benefit_entitlement_id_fk" FOREIGN KEY ("benefit_entitlement_id") REFERENCES "public"."ticket_benefit_entitlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_benefit_redemption_records" ADD CONSTRAINT "tbrr_scanner_user_id_fk" FOREIGN KEY ("scanner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ticket_benefit_configurations_showtime_id" ON "ticket_benefit_configurations" USING btree ("showtime_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_benefits_configuration_id" ON "ticket_benefits" USING btree ("configuration_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_benefit_runs_showtime_created" ON "ticket_benefit_runs" USING btree ("showtime_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_ticket_benefit_entitlements_showtime_ticket_item" ON "ticket_benefit_entitlements" USING btree ("showtime_id","ticket_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ticket_benefit_entitlements_active_limited_ticket_item" ON "ticket_benefit_entitlements" USING btree ("ticket_item_id") WHERE "ticket_benefit_entitlements"."benefit_kind" = 'limited' AND "ticket_benefit_entitlements"."state" = 'active';--> statement-breakpoint
CREATE INDEX "idx_ticket_benefit_redemption_records_showtime_entitlement_created" ON "ticket_benefit_redemption_records" USING btree ("showtime_id","benefit_entitlement_id","created_at" DESC);--> statement-breakpoint
COMMENT ON COLUMN "ticket_benefit_runs"."random_seed_internal" IS 'Internal run seed material. API responses and CSV exports must use seed_ref instead.';--> statement-breakpoint
COMMENT ON COLUMN "ticket_benefit_redemption_records"."redacted_token_ref" IS 'Stores only a redacted QR reference. Raw QR tokens, QR URLs, payloads, cookies, auth headers, and secrets are intentionally excluded.';
