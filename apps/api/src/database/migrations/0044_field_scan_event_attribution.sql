-- Field monitor attribution (audit #113, #114). Additive and non-destructive:
-- * requested_showtime_id stores the gate showtime the scanner selected (no FK,
--   it is unverified scanner input) so wrong-showtime and verify-stage rejections
--   are counted at the gate that saw them.
-- * ticket identity columns become nullable only for a tampered/unverifiable QR,
--   enforced by ticket_scan_events_attribution_check. Rows written by the
--   previous API release keep satisfying the first branch during rollout.
-- * Existing rows are backfilled from metadata.requestedShowtimeId, falling back
--   to the ticket showtime that the previous release always used.
ALTER TABLE "ticket_scan_events" ADD COLUMN IF NOT EXISTS "requested_showtime_id" uuid;
--> statement-breakpoint
ALTER TABLE "ticket_scan_events" ALTER COLUMN "ticket_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket_scan_events" ALTER COLUMN "reservation_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket_scan_events" ALTER COLUMN "showtime_id" DROP NOT NULL;
--> statement-breakpoint
UPDATE "ticket_scan_events"
SET "requested_showtime_id" = CASE
  WHEN "metadata"->>'requestedShowtimeId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN ("metadata"->>'requestedShowtimeId')::uuid
  ELSE "showtime_id"
END
WHERE "requested_showtime_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "ticket_scan_events" ADD CONSTRAINT "ticket_scan_events_attribution_check" CHECK (
  ("ticket_id" IS NOT NULL AND "reservation_id" IS NOT NULL AND "showtime_id" IS NOT NULL)
  OR ("result" = 'tampered' AND "requested_showtime_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ticket_scan_events_requested_showtime_id" ON "ticket_scan_events" USING btree ("requested_showtime_id");
