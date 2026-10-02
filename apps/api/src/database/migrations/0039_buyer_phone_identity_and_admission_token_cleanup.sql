-- Audit #62: the per-person ticket limit sums Buyer Accounts that verified the same
-- phone. Stored phones keep their submitted format, so the API narrows candidates by
-- the last 8 digits and confirms the E.164 identity in application code. Keep this
-- expression byte-identical to apps/api/src/database/ticket-limit.ts.
SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_users_verified_phone_suffix
  ON users ((right(regexp_replace(translate(phone, '０１２３４５６７８９', '0123456789'), '[^0-9]', '', 'g'), 8)))
  WHERE is_phone_verified = true;
--> statement-breakpoint
-- Audit #68: queue admission tokens are cookie-only bearer values. The API no longer
-- writes or returns them; clear the raw values kept on historical reservations. No
-- code reads this column, and live admission state stays in Valkey.
UPDATE reservations SET admission_token = NULL WHERE admission_token IS NOT NULL;
