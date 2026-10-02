-- Audit #62: the per-person ticket limit sums Buyer Accounts that verified the same
-- phone. Stored phones keep their submitted format, so the API narrows candidates by
-- the last 8 digits and confirms the E.164 identity in application code. Keep this
-- expression byte-identical to apps/api/src/database/ticket-limit.ts.
CREATE INDEX IF NOT EXISTS idx_users_verified_phone_suffix
  ON users ((right(regexp_replace(translate(phone, '０１２３４５６７８９', '0123456789'), '[^0-9]', '', 'g'), 8)))
  WHERE is_phone_verified = true;
--> statement-breakpoint
-- Audit #68: queue admission tokens are cookie-only bearer values. The API no longer
-- writes or returns them. Replace the raw values kept on historical reservations with
-- a SHA-256 digest: the bearer value is gone, while a token found in logs can still be
-- correlated by hashing it. No code reads this column, and live admission state stays
-- in Valkey. The statement is idempotent; rerun it once after the rolling cutover to
-- cover rows a previous revision wrote (docs/runbooks/show-relaunch-reliability.md).
UPDATE reservations
SET admission_token = 'sha256:' || encode(sha256(convert_to(admission_token, 'UTF8')), 'hex')
WHERE admission_token IS NOT NULL AND admission_token NOT LIKE 'sha256:%';
-- Audit #62: the lock/prepare pre-check sums a linked account's unexpired pending seats
-- through reservation_seats.reservation_id, served by idx_reservation_seats_reservation_id
-- from 0038_booking_lookup_indexes (audit #59).
