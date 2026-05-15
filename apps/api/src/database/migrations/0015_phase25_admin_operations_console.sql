CREATE TYPE "public"."admin_allowlist_source" AS ENUM('env_bootstrap', 'db_managed', 'temporary_exception');--> statement-breakpoint
CREATE TYPE "public"."admin_allowlist_status" AS ENUM('active', 'disabled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."admin_audit_action" AS ENUM('event.publish', 'event.update', 'refund.admin_refund', 'support.escalate', 'seat.disable', 'seat.reactivate', 'seat.manual_open', 'banner.manage', 'reservations.export_raw', 'security.allowlist.update', 'security.permission.update');--> statement-breakpoint
CREATE TYPE "public"."admin_audit_status" AS ENUM('success', 'denied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."banner_device_target" AS ENUM('all', 'desktop', 'mobile');--> statement-breakpoint
CREATE TYPE "public"."banner_placement" AS ENUM('home_hero', 'home_secondary', 'performance_detail', 'operations_notice');--> statement-breakpoint
CREATE TYPE "public"."banner_status" AS ENUM('draft', 'scheduled', 'active', 'paused', 'expired');--> statement-breakpoint
CREATE TYPE "public"."performance_publish_state" AS ENUM('draft', 'review', 'publish_ready', 'published');--> statement-breakpoint
CREATE TYPE "public"."seat_operation_action" AS ENUM('seat.disable', 'seat.reactivate', 'seat.manual_open');--> statement-breakpoint
CREATE TYPE "public"."support_content_review_state" AS ENUM('draft', 'review', 'approved', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."support_message_author_type" AS ENUM('customer', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."support_message_visibility" AS ENUM('public', 'internal');--> statement-breakpoint
CREATE TYPE "public"."support_notice_category" AS ENUM('general', 'urgent', 'maintenance', 'payment', 'refund', 'signup', 'event');--> statement-breakpoint
CREATE TYPE "public"."support_notice_status" AS ENUM('draft', 'review', 'scheduled', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."support_thread_category" AS ENUM('general', 'event_info', 'booking', 'payment_error', 'refund_unprocessed', 'refund_dispute', 'signup_failure', 'account', 'ticket_delivery', 'seat_accessibility', 'abuse_fraud', 'other');--> statement-breakpoint
CREATE TYPE "public"."support_thread_escalation_state" AS ENUM('none', 'auto_escalated', 'manual_escalated', 'deescalated', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."support_thread_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."support_thread_source" AS ENUM('qna', 'cs', 'refund_dispute', 'signup_failure', 'notice_followup');--> statement-breakpoint
CREATE TYPE "public"."support_thread_status" AS ENUM('open', 'waiting_customer', 'waiting_operator', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."support_translation_use" AS ENUM('none', 'manual', 'assisted');--> statement-breakpoint
ALTER TYPE "public"."seat_status" ADD VALUE IF NOT EXISTS 'disabled';--> statement-breakpoint
CREATE TABLE "admin_access_allowlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cidr" varchar(64) NOT NULL,
	"label" varchar(120) NOT NULL,
	"source" "admin_allowlist_source" NOT NULL,
	"status" "admin_allowlist_status" DEFAULT 'active' NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid,
	"audit_log_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" "admin_audit_action" NOT NULL,
	"resource_type" varchar(80) NOT NULL,
	"resource_id" varchar(160) NOT NULL,
	"status" "admin_audit_status" NOT NULL,
	"reason" text,
	"changed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"masked_before_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"masked_after_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" varchar(45),
	"user_agent" varchar(500),
	"request_id" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seat_operation_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" "seat_operation_action" NOT NULL,
	"showtime_id" uuid NOT NULL,
	"seat_inventory_id" uuid,
	"seat_id" varchar(20) NOT NULL,
	"floor_key" varchar(20) NOT NULL,
	"seat_key" varchar(80) NOT NULL,
	"previous_status" "seat_status" NOT NULL,
	"next_status" "seat_status" NOT NULL,
	"reason" text NOT NULL,
	"audit_log_id" uuid NOT NULL,
	"reservation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_faqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "support_thread_category" NOT NULL,
	"locale" "locale" DEFAULT 'ko' NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"review_state" "support_content_review_state" DEFAULT 'draft' NOT NULL,
	"translation_use" "support_translation_use" DEFAULT 'none' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_type" "support_message_author_type" NOT NULL,
	"author_user_id" uuid,
	"locale" "locale" DEFAULT 'ko' NOT NULL,
	"body" text NOT NULL,
	"visibility" "support_message_visibility" DEFAULT 'public' NOT NULL,
	"is_internal_note" boolean DEFAULT false NOT NULL,
	"review_state" "support_content_review_state" DEFAULT 'approved' NOT NULL,
	"translation_use" "support_translation_use" DEFAULT 'none' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "support_notice_category" DEFAULT 'general' NOT NULL,
	"locale" "locale" DEFAULT 'ko' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" "support_notice_status" DEFAULT 'draft' NOT NULL,
	"priority" "support_thread_priority" DEFAULT 'normal' NOT NULL,
	"review_state" "support_content_review_state" DEFAULT 'draft' NOT NULL,
	"translation_use" "support_translation_use" DEFAULT 'none' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "support_thread_source" DEFAULT 'cs' NOT NULL,
	"category" "support_thread_category" NOT NULL,
	"status" "support_thread_status" DEFAULT 'open' NOT NULL,
	"priority" "support_thread_priority" DEFAULT 'normal' NOT NULL,
	"escalation_state" "support_thread_escalation_state" DEFAULT 'none' NOT NULL,
	"title" varchar(255) NOT NULL,
	"summary" text,
	"locale" "locale" DEFAULT 'ko' NOT NULL,
	"user_id" uuid,
	"assignee_user_id" uuid,
	"reservation_id" uuid,
	"refund_id" uuid,
	"signup_failure_email_hash" varchar(64),
	"signup_failure_phone_hash" varchar(64),
	"sla_due_at" timestamp with time zone NOT NULL,
	"first_response_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consent_audit_logs" ALTER COLUMN "language" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "consent_items" ALTER COLUMN "locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "consent_items" ALTER COLUMN "locale" SET DEFAULT 'ko'::text;--> statement-breakpoint
ALTER TABLE "support_faqs" ALTER COLUMN "locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "support_faqs" ALTER COLUMN "locale" SET DEFAULT 'ko'::text;--> statement-breakpoint
ALTER TABLE "support_messages" ALTER COLUMN "locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "support_messages" ALTER COLUMN "locale" SET DEFAULT 'ko'::text;--> statement-breakpoint
ALTER TABLE "support_notices" ALTER COLUMN "locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "support_notices" ALTER COLUMN "locale" SET DEFAULT 'ko'::text;--> statement-breakpoint
ALTER TABLE "support_threads" ALTER COLUMN "locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "support_threads" ALTER COLUMN "locale" SET DEFAULT 'ko'::text;--> statement-breakpoint
ALTER TABLE "translation_drafts" ALTER COLUMN "target_locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "translation_sources" ALTER COLUMN "source_locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "translation_sources" ALTER COLUMN "source_locale" SET DEFAULT 'ko'::text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "preferred_locale" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "preferred_locale" SET DEFAULT 'ko'::text;--> statement-breakpoint
UPDATE "consent_items"
SET
	"locale" = 'zh-TW',
	"title" = CASE "key"
		WHEN 'terms' THEN '服務條款'
		WHEN 'privacy' THEN '隱私權政策'
		WHEN 'pipa_required' THEN '必要個人資料蒐集與使用'
		WHEN 'cross_border_transfer' THEN '個人資料跨境傳輸'
		WHEN 'pdpa_notice' THEN '泰國 PDPA 通知'
		WHEN 'pipl_notice' THEN '中國 PIPL 通知'
		WHEN 'marketing' THEN '行銷接收同意'
		ELSE "title"
	END,
	"body" = CASE "key"
		WHEN 'terms' THEN '我同意 Grabit 服務條款及會員權利義務。'
		WHEN 'privacy' THEN '我同意 Grabit 依隱私權政策處理個人資料。'
		WHEN 'pipa_required' THEN '我同意為註冊、身分驗證和預訂所必要的個人資料蒐集與使用。'
		WHEN 'cross_border_transfer' THEN '我同意為提供服務所必要的個人資料跨境傳輸。'
		WHEN 'pdpa_notice' THEN '我已確認面向泰國使用者的 PDPA 隱私通知。'
		WHEN 'pipl_notice' THEN '我已確認面向中國使用者的 PIPL 隱私通知。'
		WHEN 'marketing' THEN '我同意接收演出、展覽、優惠等行銷訊息。'
		ELSE "body"
	END,
	"is_required" = CASE "key" WHEN 'marketing' THEN false ELSE true END,
	"is_active" = true,
	"updated_at" = now()
WHERE "locale" = 'ja';--> statement-breakpoint
UPDATE "consent_audit_logs" SET "language" = 'zh-TW' WHERE "language" = 'ja';--> statement-breakpoint
UPDATE "support_faqs" SET "locale" = 'zh-TW' WHERE "locale" = 'ja';--> statement-breakpoint
UPDATE "support_messages" SET "locale" = 'zh-TW' WHERE "locale" = 'ja';--> statement-breakpoint
UPDATE "support_notices" SET "locale" = 'zh-TW' WHERE "locale" = 'ja';--> statement-breakpoint
UPDATE "support_threads" SET "locale" = 'zh-TW' WHERE "locale" = 'ja';--> statement-breakpoint
UPDATE "translation_drafts" SET "target_locale" = 'zh-TW' WHERE "target_locale" = 'ja';--> statement-breakpoint
UPDATE "translation_sources" SET "source_locale" = 'zh-TW' WHERE "source_locale" = 'ja';--> statement-breakpoint
UPDATE "users" SET "preferred_locale" = 'zh-TW' WHERE "preferred_locale" = 'ja';--> statement-breakpoint
DROP TYPE "public"."locale";--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('ko', 'en', 'th', 'zh-CN', 'zh-TW');--> statement-breakpoint
ALTER TABLE "consent_audit_logs" ALTER COLUMN "language" SET DATA TYPE "public"."locale" USING "language"::"public"."locale";--> statement-breakpoint
ALTER TABLE "consent_items" ALTER COLUMN "locale" SET DEFAULT 'ko'::"public"."locale";--> statement-breakpoint
ALTER TABLE "consent_items" ALTER COLUMN "locale" SET DATA TYPE "public"."locale" USING "locale"::"public"."locale";--> statement-breakpoint
ALTER TABLE "support_faqs" ALTER COLUMN "locale" SET DEFAULT 'ko'::"public"."locale";--> statement-breakpoint
ALTER TABLE "support_faqs" ALTER COLUMN "locale" SET DATA TYPE "public"."locale" USING "locale"::"public"."locale";--> statement-breakpoint
ALTER TABLE "support_messages" ALTER COLUMN "locale" SET DEFAULT 'ko'::"public"."locale";--> statement-breakpoint
ALTER TABLE "support_messages" ALTER COLUMN "locale" SET DATA TYPE "public"."locale" USING "locale"::"public"."locale";--> statement-breakpoint
ALTER TABLE "support_notices" ALTER COLUMN "locale" SET DEFAULT 'ko'::"public"."locale";--> statement-breakpoint
ALTER TABLE "support_notices" ALTER COLUMN "locale" SET DATA TYPE "public"."locale" USING "locale"::"public"."locale";--> statement-breakpoint
ALTER TABLE "support_threads" ALTER COLUMN "locale" SET DEFAULT 'ko'::"public"."locale";--> statement-breakpoint
ALTER TABLE "support_threads" ALTER COLUMN "locale" SET DATA TYPE "public"."locale" USING "locale"::"public"."locale";--> statement-breakpoint
ALTER TABLE "translation_drafts" ALTER COLUMN "target_locale" SET DATA TYPE "public"."locale" USING "target_locale"::"public"."locale";--> statement-breakpoint
ALTER TABLE "translation_sources" ALTER COLUMN "source_locale" SET DEFAULT 'ko'::"public"."locale";--> statement-breakpoint
ALTER TABLE "translation_sources" ALTER COLUMN "source_locale" SET DATA TYPE "public"."locale" USING "source_locale"::"public"."locale";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "preferred_locale" SET DEFAULT 'ko'::"public"."locale";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "preferred_locale" SET DATA TYPE "public"."locale" USING "preferred_locale"::"public"."locale";--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "placement" "banner_placement" DEFAULT 'home_hero' NOT NULL;--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "device_target" "banner_device_target" DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "status" "banner_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "performances" ADD COLUMN "publish_state" "performance_publish_state" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "performances" ADD COLUMN "publish_review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "performances" ADD COLUMN "publish_ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "performances" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "performances" ADD COLUMN "published_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "access_notes" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "transport_summary" text;--> statement-breakpoint
ALTER TABLE "admin_access_allowlist" ADD CONSTRAINT "admin_access_allowlist_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_access_allowlist" ADD CONSTRAINT "admin_access_allowlist_audit_log_id_admin_audit_logs_id_fk" FOREIGN KEY ("audit_log_id") REFERENCES "public"."admin_audit_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_operation_history" ADD CONSTRAINT "seat_operation_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_operation_history" ADD CONSTRAINT "seat_operation_history_showtime_id_showtimes_id_fk" FOREIGN KEY ("showtime_id") REFERENCES "public"."showtimes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_operation_history" ADD CONSTRAINT "seat_operation_history_seat_inventory_id_seat_inventories_id_fk" FOREIGN KEY ("seat_inventory_id") REFERENCES "public"."seat_inventories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_operation_history" ADD CONSTRAINT "seat_operation_history_audit_log_id_admin_audit_logs_id_fk" FOREIGN KEY ("audit_log_id") REFERENCES "public"."admin_audit_logs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_operation_history" ADD CONSTRAINT "seat_operation_history_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_faqs" ADD CONSTRAINT "support_faqs_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_faqs" ADD CONSTRAINT "support_faqs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_faqs" ADD CONSTRAINT "support_faqs_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_thread_id_support_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."support_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_notices" ADD CONSTRAINT "support_notices_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_notices" ADD CONSTRAINT "support_notices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_notices" ADD CONSTRAINT "support_notices_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_access_allowlist_cidr" ON "admin_access_allowlist" USING btree ("cidr");--> statement-breakpoint
CREATE INDEX "idx_admin_access_allowlist_source_status" ON "admin_access_allowlist" USING btree ("source","status");--> statement-breakpoint
CREATE INDEX "idx_admin_access_allowlist_audit_log_id" ON "admin_access_allowlist" USING btree ("audit_log_id");--> statement-breakpoint
CREATE INDEX "idx_admin_access_allowlist_expires_at" ON "admin_access_allowlist" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_actor_user_id" ON "admin_audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_action" ON "admin_audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_resource" ON "admin_audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_status_created_at" ON "admin_audit_logs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_request_id" ON "admin_audit_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_seat_operation_history_actor_user_id" ON "seat_operation_history" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_seat_operation_history_showtime_seat_key" ON "seat_operation_history" USING btree ("showtime_id","floor_key","seat_key");--> statement-breakpoint
CREATE INDEX "idx_seat_operation_history_action_created_at" ON "seat_operation_history" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "idx_seat_operation_history_audit_log_id" ON "seat_operation_history" USING btree ("audit_log_id");--> statement-breakpoint
CREATE INDEX "idx_seat_operation_history_reservation_id" ON "seat_operation_history" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "idx_support_faqs_category_locale" ON "support_faqs" USING btree ("category","locale");--> statement-breakpoint
CREATE INDEX "idx_support_faqs_review_state" ON "support_faqs" USING btree ("review_state");--> statement-breakpoint
CREATE INDEX "idx_support_faqs_published_at" ON "support_faqs" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_support_messages_thread_id" ON "support_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_support_messages_author_user_id" ON "support_messages" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "idx_support_messages_review_state" ON "support_messages" USING btree ("review_state");--> statement-breakpoint
CREATE INDEX "idx_support_notices_status_schedule" ON "support_notices" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_support_notices_category_locale" ON "support_notices" USING btree ("category","locale");--> statement-breakpoint
CREATE INDEX "idx_support_notices_review_state" ON "support_notices" USING btree ("review_state");--> statement-breakpoint
CREATE INDEX "idx_support_notices_published_at" ON "support_notices" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_support_threads_status_sla" ON "support_threads" USING btree ("status","sla_due_at");--> statement-breakpoint
CREATE INDEX "idx_support_threads_priority_escalation" ON "support_threads" USING btree ("priority","escalation_state");--> statement-breakpoint
CREATE INDEX "idx_support_threads_category" ON "support_threads" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_support_threads_assignee_user_id" ON "support_threads" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE INDEX "idx_support_threads_refund_id" ON "support_threads" USING btree ("refund_id");--> statement-breakpoint
CREATE INDEX "idx_support_threads_reservation_id" ON "support_threads" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "idx_support_threads_signup_email_hash" ON "support_threads" USING btree ("signup_failure_email_hash");--> statement-breakpoint
CREATE INDEX "idx_support_threads_signup_phone_hash" ON "support_threads" USING btree ("signup_failure_phone_hash");--> statement-breakpoint
ALTER TABLE "performances" ADD CONSTRAINT "performances_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_banners_placement_status" ON "banners" USING btree ("placement","status");--> statement-breakpoint
CREATE INDEX "idx_banners_schedule" ON "banners" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "idx_performances_publish_state" ON "performances" USING btree ("publish_state");
