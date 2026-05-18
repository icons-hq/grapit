ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "account_status" varchar(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "withdrawal_reason" varchar(500),
  ADD COLUMN IF NOT EXISTS "withdrawn_by_user_id" uuid,
  ADD COLUMN IF NOT EXISTS "withdrawal_source" varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_withdrawn_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_withdrawn_by_user_id_users_id_fk"
      FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_users_account_status"
  ON "users" ("account_status");

ALTER TYPE "admin_audit_action" ADD VALUE IF NOT EXISTS 'user.withdraw';
ALTER TYPE "admin_audit_action" ADD VALUE IF NOT EXISTS 'user.hard_delete';
