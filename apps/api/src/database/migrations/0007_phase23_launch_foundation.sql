CREATE TYPE "public"."legal_content_type" AS ENUM('legal', 'notice', 'refund', 'booking_guide');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('ko', 'en', 'th', 'zh-CN', 'zh-TW');--> statement-breakpoint
CREATE TYPE "public"."translation_status" AS ENUM('draft', 'review', 'published', 'stale');--> statement-breakpoint
CREATE TABLE "consent_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_item_id" uuid NOT NULL,
	"item_key" varchar(100) NOT NULL,
	"item_version" varchar(50) NOT NULL,
	"language" "locale" NOT NULL,
	"agreed" boolean NOT NULL,
	"agreed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" varchar(45) NOT NULL,
	"user_agent" varchar(500)
);
--> statement-breakpoint
CREATE TABLE "consent_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"version" varchar(50) NOT NULL,
	"locale" "locale" DEFAULT 'ko' NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" varchar(255) NOT NULL,
	"purpose" varchar(50) DEFAULT 'signup' NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "legal_content_type" NOT NULL,
	"slug" varchar(120) NOT NULL,
	"version" varchar(50) NOT NULL,
	"ko_title" varchar(255) NOT NULL,
	"ko_body" text NOT NULL,
	"en_title" varchar(255) NOT NULL,
	"en_body" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translation_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"target_locale" "locale" NOT NULL,
	"status" "translation_status" DEFAULT 'draft' NOT NULL,
	"translated_text" text NOT NULL,
	"source_content_hash" varchar(64) NOT NULL,
	"reviewed_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translation_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" varchar(100) NOT NULL,
	"source_locale" "locale" DEFAULT 'ko' NOT NULL,
	"source_text" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_locale" "locale" DEFAULT 'ko';--> statement-breakpoint
ALTER TABLE "consent_audit_logs" ADD CONSTRAINT "consent_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_audit_logs" ADD CONSTRAINT "consent_audit_logs_consent_item_id_consent_items_id_fk" FOREIGN KEY ("consent_item_id") REFERENCES "public"."consent_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_content" ADD CONSTRAINT "legal_content_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_drafts" ADD CONSTRAINT "translation_drafts_source_id_translation_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."translation_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_drafts" ADD CONSTRAINT "translation_drafts_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_sources" ADD CONSTRAINT "translation_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_consent_audit_logs_user" ON "consent_audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_consent_audit_logs_item" ON "consent_audit_logs" USING btree ("consent_item_id");--> statement-breakpoint
CREATE INDEX "idx_consent_audit_logs_item_version_language" ON "consent_audit_logs" USING btree ("item_key","item_version","language");--> statement-breakpoint
CREATE INDEX "idx_consent_audit_logs_agreed_at" ON "consent_audit_logs" USING btree ("agreed_at");--> statement-breakpoint
CREATE INDEX "idx_consent_audit_logs_ip" ON "consent_audit_logs" USING btree ("ip_address");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_consent_items_key_version_locale" ON "consent_items" USING btree ("key","version","locale");--> statement-breakpoint
CREATE INDEX "idx_consent_items_key_active" ON "consent_items" USING btree ("key","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_email_verification_tokens_token_hash" ON "email_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_email_verification_tokens_email_purpose_created" ON "email_verification_tokens" USING btree ("email","purpose","created_at");--> statement-breakpoint
CREATE INDEX "idx_email_verification_tokens_user_purpose_created" ON "email_verification_tokens" USING btree ("user_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "idx_email_verification_tokens_expires_at" ON "email_verification_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_legal_content_type_slug_version" ON "legal_content" USING btree ("type","slug","version");--> statement-breakpoint
CREATE INDEX "idx_legal_content_published_at" ON "legal_content" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_translation_drafts_source_locale_status" ON "translation_drafts" USING btree ("source_id","target_locale","status");--> statement-breakpoint
CREATE INDEX "idx_translation_drafts_status" ON "translation_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_translation_sources_entity_field" ON "translation_sources" USING btree ("entity_type","entity_id","field");--> statement-breakpoint
CREATE INDEX "idx_translation_sources_content_hash" ON "translation_sources" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_active_family_query" ON "refresh_tokens" USING btree ("user_id","family","revoked_at","expires_at");