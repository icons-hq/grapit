import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../database/drizzle.provider.js';
import { ticketBenefitEntitlements } from '../database/schema/index.js';
type BenefitDisplayCopy = typeof ticketBenefitEntitlements.$inferInsert.displayCopySnapshot;

type MissingBenefit = { ticket_item_id: string; tier_name: string; benefit_identity: string;
  configuration_id: string; display_copy: BenefitDisplayCopy };

/** Dry-run is read-only. Apply requires the exact hash of the reviewed candidate set. */
export async function repairIncludedBenefits(db: DrizzleDB, showtimeId: string, expectedHash?: string) {
  return db.transaction(async (tx) => {
    // Apply serializes with configuration changes; dry-run remains read-only.
    const showtime = await tx.execute(sql`SELECT id FROM showtimes WHERE id = ${showtimeId}
      ${expectedHash ? sql`FOR NO KEY UPDATE` : sql``}`);
    if (showtime.rows.length === 0) throw new Error('BENEFIT_REPAIR_SHOWTIME_NOT_FOUND');
    if (expectedHash) {
      await tx.execute(sql`SELECT id FROM ticket_items WHERE showtime_id = ${showtimeId} ORDER BY id FOR UPDATE`);
    }
    const missing = await tx.execute<MissingBenefit>(sql`
      WITH latest AS (
        SELECT id FROM ticket_benefit_configurations WHERE showtime_id = ${showtimeId}
        ORDER BY version DESC LIMIT 1
      )
      SELECT ti.id AS ticket_item_id, ti.tier_name, b.identity AS benefit_identity,
        b.configuration_id, b.display_copy
      FROM ticket_items ti
      JOIN reservations r ON r.id = ti.reservation_id AND r.status = 'CONFIRMED'
      JOIN payments p ON p.id = ti.payment_id AND p.status = 'DONE'
      JOIN ticket_benefits b ON b.configuration_id = (SELECT id FROM latest)
        AND b.kind = 'included' AND b.eligible_tier_names ? ti.tier_name
      WHERE ti.showtime_id = ${showtimeId} AND ti.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM ticket_benefit_entitlements e
          WHERE e.ticket_item_id = ti.id AND e.benefit_identity = b.identity
            AND e.source = 'configuration' AND e.benefit_kind = 'included'
            AND e.state IN ('active', 'redeemed')
        )
      ORDER BY ti.id, b.identity
    `);
    const candidates = missing.rows;
    const hash = createHash('sha256').update(JSON.stringify({ showtimeId, candidates })).digest('hex');
    const items = [...new Map(candidates.map((c) => [c.ticket_item_id,
      { id: c.ticket_item_id, tierName: c.tier_name }])).values()];
    if (expectedHash && expectedHash !== hash) throw new Error('BENEFIT_REPAIR_CANDIDATES_CHANGED');
    let appliedEntitlements = 0;
    if (expectedHash && candidates.length > 0) {
      const inserted = await tx.insert(ticketBenefitEntitlements).values(candidates.map((c) => ({
        showtimeId, ticketItemId: c.ticket_item_id, benefitIdentity: c.benefit_identity,
        benefitKind: 'included' as const, displayCopySnapshot: c.display_copy,
        source: 'configuration' as const, state: 'active' as const,
      }))).returning({ id: ticketBenefitEntitlements.id });
      appliedEntitlements = inserted.length;
      if (appliedEntitlements !== candidates.length) throw new Error('BENEFIT_REPAIR_COUNT_MISMATCH');
    }
    return { mode: expectedHash ? 'apply' : 'dry-run', showtimeId, hash,
      missingTickets: items.length, missingEntitlements: candidates.length,
      appliedEntitlements };
  }, expectedHash ? undefined : { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
