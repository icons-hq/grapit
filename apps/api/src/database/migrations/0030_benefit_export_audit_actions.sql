ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'benefits.run.live';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'benefits.run.rollback';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'benefits.run.export';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'benefits.entitlements.export';--> statement-breakpoint
