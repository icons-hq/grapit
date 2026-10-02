ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'support.content.create' AFTER 'support.escalate';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'support.content.update' AFTER 'support.content.create';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'support.content.review' AFTER 'support.content.update';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'support.content.publish' AFTER 'support.content.review';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'support.content.archive' AFTER 'support.content.publish';--> statement-breakpoint
ALTER TABLE "support_notices" ADD COLUMN IF NOT EXISTS "translation_group_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_notices_translation_group_id" ON "support_notices" USING btree ("translation_group_id");
