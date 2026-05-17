ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "admin_capability_bundle" varchar(20);

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "admin_capabilities" jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE "users"
SET "admin_capability_bundle" = 'admin'
WHERE "role" = 'admin'
  AND "admin_capability_bundle" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'admin_audit_action'
      AND e.enumlabel = 'security.permission.update'
  ) THEN
    ALTER TYPE "admin_audit_action" ADD VALUE 'security.permission.update';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_users_role_admin_capability_bundle"
  ON "users" ("role", "admin_capability_bundle");
