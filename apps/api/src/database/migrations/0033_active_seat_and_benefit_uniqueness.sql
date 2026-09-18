-- Keep preflight and index creation in the migration transaction. Do not repair
-- historical ownership automatically. See docs/runbooks/show-relaunch-reliability.md.
SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
LOCK TABLE ticket_items, ticket_benefit_entitlements IN SHARE MODE;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ticket_items
    WHERE status IN ('active', 'cancellation_pending')
    GROUP BY showtime_id, seat_key HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Active seat duplicates exist; reconcile ownership before migration 0033';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ticket_benefit_entitlements
    WHERE source = 'configuration' AND benefit_kind = 'included'
      AND state IN ('active', 'redeemed')
    GROUP BY ticket_item_id, benefit_identity HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Included benefit duplicates exist; reconcile redemption evidence before migration 0033';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_ticket_items_active_seat ON ticket_items (showtime_id, seat_key)
  WHERE status IN ('active', 'cancellation_pending');
--> statement-breakpoint
DROP INDEX idx_tbe_active_config_included_item_identity;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_tbe_active_config_included_item_identity
  ON ticket_benefit_entitlements (ticket_item_id, benefit_identity)
  WHERE source = 'configuration' AND benefit_kind = 'included' AND state IN ('active', 'redeemed');
