DO $$ BEGIN
  CREATE TYPE "public"."account_merge_batch_status" AS ENUM (
    'dry_run',
    'applied',
    'verified',
    'failed',
    'rolled_back'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'user.merge';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "account_merge_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" "account_merge_batch_status" NOT NULL,
  "operator_user_id" uuid,
  "reason" text NOT NULL,
  "backup_reference" varchar(255) NOT NULL,
  "dry_run_hash" varchar(128) NOT NULL,
  "allowlist_hash" varchar(128),
  "source" varchar(40) DEFAULT 'cli' NOT NULL,
  "report_path" text,
  "aggregate_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "verification_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "applied_at" timestamp with time zone,
  "verified_at" timestamp with time zone
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "account_merge_row_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "merge_group_key" varchar(255) NOT NULL,
  "table_name" varchar(120) NOT NULL,
  "row_id" varchar(160) NOT NULL,
  "source_user_id" uuid NOT NULL,
  "target_user_id" uuid NOT NULL,
  "before_snapshot" jsonb NOT NULL,
  "after_snapshot" jsonb NOT NULL,
  "expected_row_count" integer DEFAULT 1 NOT NULL,
  "actual_row_count" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "account_merge_batches"
    ADD CONSTRAINT "account_merge_batches_operator_user_id_users_id_fk"
    FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "account_merge_row_changes"
    ADD CONSTRAINT "account_merge_row_changes_batch_id_fk"
    FOREIGN KEY ("batch_id") REFERENCES "public"."account_merge_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "account_merge_row_changes"
    ADD CONSTRAINT "account_merge_row_changes_source_user_id_users_id_fk"
    FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "account_merge_row_changes"
    ADD CONSTRAINT "account_merge_row_changes_target_user_id_users_id_fk"
    FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_account_merge_batches_status_created"
  ON "account_merge_batches" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_merge_batches_operator"
  ON "account_merge_batches" USING btree ("operator_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_merge_batches_dry_run_hash"
  ON "account_merge_batches" USING btree ("dry_run_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_merge_row_changes_batch"
  ON "account_merge_row_changes" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_merge_row_changes_source_target"
  ON "account_merge_row_changes" USING btree ("source_user_id","target_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_merge_row_changes_table_row"
  ON "account_merge_row_changes" USING btree ("table_name","row_id");
