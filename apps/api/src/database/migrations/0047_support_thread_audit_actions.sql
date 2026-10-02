-- Support thread status and assignee changes were audited as support.escalate.
-- They get their own actions (already in the shared admin audit contract).
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'support.assign' AFTER 'support.escalate';--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'support.resolve' AFTER 'support.assign';
