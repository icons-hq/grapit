-- reservation_seats grows with every prepare attempt and is read by reservation_id on
-- prepare reuse, payment confirm, webhook reconciliation and My Page lists.
-- payments is looked up by toss_order_id on confirm entry and webhook matching.
-- Drizzle runs pending migrations inside one transaction, so CONCURRENTLY is not
-- available here; both builds take a SHARE lock (writes wait) for the build time.
CREATE INDEX IF NOT EXISTS "idx_reservation_seats_reservation_id" ON "reservation_seats" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payments_toss_order_id" ON "payments" USING btree ("toss_order_id");
