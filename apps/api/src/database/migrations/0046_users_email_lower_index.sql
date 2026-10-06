-- Case-insensitive email lookup for login, signup duplicate checks and password reset.
-- Intentionally non-unique: existing rows may differ only by letter case and must be
-- reviewed (docs/runbooks/auth-session-operations.md) before any unique constraint.
CREATE INDEX IF NOT EXISTS "idx_users_email_lower" ON "users" USING btree (lower("email"));
