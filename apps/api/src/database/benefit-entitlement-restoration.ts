import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleDB } from './drizzle.provider.js';
import {
  ticketBenefitConfigurations,
  ticketBenefitEntitlements,
  ticketBenefitRuns,
  ticketBenefits,
  ticketItems,
} from './schema/index.js';
import { syncIncludedBenefitEntitlementsForTicketItems } from './included-benefit-entitlements.js';

export const CANCELLATION_PENDING_INACTIVE_REASON = 'cancellation_pending';
export const LIMITED_BENEFIT_REPLACED_REASON = 'replaced_by_live_run';
export const INCLUDED_BENEFIT_CONFIGURATION_CHANGED_REASON = 'configuration_changed';

/**
 * Re-activates the Benefit Entitlements a rejected cancellation revoked, but
 * only those still valid now. While Ticket Items were `cancellation_pending`,
 * live runs, rollbacks and configuration saves skipped them (they only touch
 * active items), so stored rights may belong to a replaced run or a removed
 * included benefit:
 * - a limited right returns only when its run is still the showtime's latest
 *   completed live run; otherwise it stays inactive as replaced;
 * - an included right returns only when the current configuration still
 *   includes that identity for the item's tier;
 * - included rights added meanwhile are created for the restored items.
 *
 * Call inside the restoring transaction after the Ticket Items are active
 * again. Serializes with benefit mutations through the showtime row lock.
 */
export async function restoreCancellationPendingBenefitEntitlements(
  db: DrizzleDB,
  ticketItemIds: string[],
  now: Date,
): Promise<void> {
  if (ticketItemIds.length === 0) {
    return;
  }

  const restoredItems = await db
    .select({
      id: ticketItems.id,
      showtimeId: ticketItems.showtimeId,
      tierName: ticketItems.tierName,
    })
    .from(ticketItems)
    .where(and(inArray(ticketItems.id, ticketItemIds), eq(ticketItems.status, 'active')));

  const itemsByShowtime = new Map<string, { id: string; tierName: string }[]>();
  for (const item of restoredItems) {
    const items = itemsByShowtime.get(item.showtimeId) ?? [];
    items.push({ id: item.id, tierName: item.tierName });
    itemsByShowtime.set(item.showtimeId, items);
  }

  for (const showtimeId of [...itemsByShowtime.keys()].sort()) {
    await restoreShowtimeEntitlements(db, showtimeId, itemsByShowtime.get(showtimeId)!, now);
  }
}

async function restoreShowtimeEntitlements(
  db: DrizzleDB,
  showtimeId: string,
  items: { id: string; tierName: string }[],
  now: Date,
): Promise<void> {
  // Same row lock as runLive/rollback/configuration saves (FOR NO KEY UPDATE).
  await db.execute(sql`SELECT id FROM showtimes WHERE id = ${showtimeId} FOR NO KEY UPDATE`);

  const pendingEntitlements = await db
    .select({
      id: ticketBenefitEntitlements.id,
      ticketItemId: ticketBenefitEntitlements.ticketItemId,
      benefitIdentity: ticketBenefitEntitlements.benefitIdentity,
      benefitKind: ticketBenefitEntitlements.benefitKind,
      source: ticketBenefitEntitlements.source,
      runId: ticketBenefitEntitlements.runId,
    })
    .from(ticketBenefitEntitlements)
    .where(and(
      inArray(ticketBenefitEntitlements.ticketItemId, items.map((item) => item.id)),
      eq(ticketBenefitEntitlements.state, 'inactive'),
      eq(ticketBenefitEntitlements.inactiveReason, CANCELLATION_PENDING_INACTIVE_REASON),
    ));

  if (pendingEntitlements.length > 0) {
    const [latestLiveRun] = await db
      .select({ id: ticketBenefitRuns.id })
      .from(ticketBenefitRuns)
      .where(and(
        eq(ticketBenefitRuns.showtimeId, showtimeId),
        eq(ticketBenefitRuns.mode, 'live'),
        eq(ticketBenefitRuns.status, 'completed'),
      ))
      .orderBy(desc(ticketBenefitRuns.createdAt), desc(ticketBenefitRuns.id))
      .limit(1);
    const includedBenefits = await loadCurrentIncludedBenefits(db, showtimeId);
    const tierByItemId = new Map(items.map((item) => [item.id, item.tierName]));

    for (const entitlement of pendingEntitlements) {
      if (entitlement.benefitKind === 'limited') {
        const stillCurrent = latestLiveRun !== undefined && entitlement.runId === latestLiveRun.id;
        await db
          .update(ticketBenefitEntitlements)
          .set(stillCurrent
            ? { state: 'active', inactiveReason: null, updatedAt: now }
            : { inactiveReason: LIMITED_BENEFIT_REPLACED_REASON, updatedAt: now })
          .where(eq(ticketBenefitEntitlements.id, entitlement.id));
        continue;
      }

      const benefit = includedBenefits.get(entitlement.benefitIdentity);
      const tierName = tierByItemId.get(entitlement.ticketItemId);
      const stillIncluded = entitlement.source === 'configuration'
        && benefit !== undefined
        && tierName !== undefined
        && benefit.eligibleTierNames.includes(tierName);
      await db
        .update(ticketBenefitEntitlements)
        .set(stillIncluded
          ? {
              state: 'active',
              inactiveReason: null,
              displayCopySnapshot: benefit.displayCopy,
              updatedAt: now,
            }
          : { inactiveReason: INCLUDED_BENEFIT_CONFIGURATION_CHANGED_REASON, updatedAt: now })
        .where(eq(ticketBenefitEntitlements.id, entitlement.id));
    }
  }

  // Creates included rights the current configuration added while the items were pending.
  await syncIncludedBenefitEntitlementsForTicketItems(db, showtimeId, items, now);
}

async function loadCurrentIncludedBenefits(
  db: DrizzleDB,
  showtimeId: string,
): Promise<Map<string, { eligibleTierNames: string[]; displayCopy: typeof ticketBenefits.$inferSelect['displayCopy'] }>> {
  const [configuration] = await db
    .select({ id: ticketBenefitConfigurations.id })
    .from(ticketBenefitConfigurations)
    .where(eq(ticketBenefitConfigurations.showtimeId, showtimeId))
    .orderBy(desc(ticketBenefitConfigurations.version))
    .limit(1);
  if (!configuration) {
    return new Map();
  }

  const rows = await db
    .select({
      identity: ticketBenefits.identity,
      eligibleTierNames: ticketBenefits.eligibleTierNames,
      displayCopy: ticketBenefits.displayCopy,
    })
    .from(ticketBenefits)
    .where(and(
      eq(ticketBenefits.configurationId, configuration.id),
      eq(ticketBenefits.kind, 'included'),
    ));

  return new Map(rows.map((row) => [row.identity, {
    eligibleTierNames: row.eligibleTierNames,
    displayCopy: row.displayCopy,
  }]));
}
