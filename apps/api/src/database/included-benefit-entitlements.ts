import { NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DrizzleDB } from './drizzle.provider.js';
import { ticketBenefitConfigurations, ticketBenefitEntitlements, ticketBenefits } from './schema/index.js';

type TicketItemBenefitCandidate = { id: string; tierName: string };

// Call inside the ticket-creation transaction, with active ticket items only.
export async function syncIncludedBenefitEntitlementsForTicketItems(
  db: DrizzleDB,
  showtimeId: string,
  ticketItemRows: TicketItemBenefitCandidate[],
  now: Date,
): Promise<void> {
  if (ticketItemRows.length === 0) {
    return;
  }

  await lockShowtimeForTicketIssuance(db, showtimeId);

  const [configuration] = await db
    .select({ id: ticketBenefitConfigurations.id })
    .from(ticketBenefitConfigurations)
    .where(eq(ticketBenefitConfigurations.showtimeId, showtimeId))
    .orderBy(desc(ticketBenefitConfigurations.version))
    .limit(1);

  if (!configuration) {
    return;
  }

  const includedBenefits = await db
    .select({
      identity: ticketBenefits.identity,
      kind: ticketBenefits.kind,
      displayCopy: ticketBenefits.displayCopy,
      eligibleTierNames: ticketBenefits.eligibleTierNames,
    })
    .from(ticketBenefits)
    .where(and(
      eq(ticketBenefits.configurationId, configuration.id),
      eq(ticketBenefits.kind, 'included'),
    ));

  const entitlementsToInsert = includedBenefits
    .filter((benefit) => benefit.kind === 'included')
    .flatMap((benefit) => {
      const eligibleTierNames = new Set(benefit.eligibleTierNames);
      return ticketItemRows
        .filter((ticketItem) => eligibleTierNames.has(ticketItem.tierName))
        .map((ticketItem) => ({
          showtimeId,
          ticketItemId: ticketItem.id,
          benefitIdentity: benefit.identity,
          benefitKind: 'included' as const,
          displayCopySnapshot: benefit.displayCopy,
          source: 'configuration' as const,
          runId: null,
          state: 'active' as const,
          inactiveReason: null,
          redeemedAt: null,
          redeemedByUserId: null,
          createdAt: now,
          updatedAt: now,
        }));
    });

  if (entitlementsToInsert.length === 0) {
    return;
  }

  await db
    .insert(ticketBenefitEntitlements)
    .values(entitlementsToInsert)
    .onConflictDoNothing();
}

/**
 * Ticket issuance only has to serialize with benefit configuration changes,
 * live runs, rollbacks, field redemption and the repair CLI. Those writers take
 * FOR NO KEY UPDATE on the showtime row, which conflicts with FOR SHARE, so a
 * new ticket can never miss a configuration that commits concurrently.
 * FOR SHARE is compatible with itself and with the ticket_items FK KEY SHARE,
 * so confirms for different seats of the same showtime run in parallel instead
 * of queueing behind one row lock. Never upgrade this lock later in the same
 * transaction: two share holders upgrading would deadlock.
 */
async function lockShowtimeForTicketIssuance(
  db: Pick<DrizzleDB, 'execute'>,
  showtimeId: string,
): Promise<void> {
  const result = await db.execute(sql`
    SELECT id
    FROM showtimes
    WHERE id = ${showtimeId}
    FOR SHARE
  `);

  if (Array.isArray(result) && result.length === 0) {
    throw new NotFoundException('회차를 찾을 수 없습니다');
  }

  if ('rows' in result && Array.isArray(result.rows) && result.rows.length === 0) {
    throw new NotFoundException('회차를 찾을 수 없습니다');
  }
}
