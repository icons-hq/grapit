-- The held-cancelled seat recovery sweep (audit #24) runs every 5 minutes on each background-processing
-- instance. Only held seats carry a reopen hold, so this partial index stays tiny and keeps the sweep from
-- scanning the whole seat inventory table. The predicate avoids the seat_status enum literal on purpose:
-- on a fresh database every migration runs in one transaction, where the enum value added by an earlier
-- migration is not yet committed and cannot be used (55P04).
CREATE INDEX IF NOT EXISTS "idx_seat_inv_reopen_hold_until" ON "seat_inventories" USING btree ("reopen_hold_until") WHERE "seat_inventories"."reopen_hold_until" IS NOT NULL;
