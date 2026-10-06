-- Benefit operations hardening (audit #47, #165).
-- mutual_exclusion_group stores comma-joined benefit identities of up to 120 chars
-- each, so varchar(120) rejected three or more exclusions. varchar -> text is
-- binary coercible: PostgreSQL updates the catalog without rewriting the table.
ALTER TABLE "ticket_benefits" ALTER COLUMN "mutual_exclusion_group" SET DATA TYPE text;
--> statement-breakpoint
-- The included-benefit-repair CLI writes one admin audit row per apply and links
-- every entitlement it inserts to that row. NULL keeps meaning regular issuance.
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'benefits.included_repair.apply';
--> statement-breakpoint
ALTER TABLE "ticket_benefit_entitlements" ADD COLUMN "repair_audit_log_id" uuid;
--> statement-breakpoint
-- The column is new and therefore NULL everywhere. NOT VALID skips a full-table
-- validation scan while still checking every new or updated row.
ALTER TABLE "ticket_benefit_entitlements" ADD CONSTRAINT "tbe_repair_audit_log_fk" FOREIGN KEY ("repair_audit_log_id") REFERENCES "public"."admin_audit_logs"("id") ON DELETE restrict ON UPDATE no action NOT VALID;
