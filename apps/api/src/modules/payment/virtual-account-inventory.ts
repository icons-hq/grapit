import { and, eq, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { payments, reservations, seatInventories, ticketItems } from '../../database/schema/index.js';
import { DEPOSIT_REVERSED } from './virtual-account.js';

/** A failed issuance that Toss has refunded no longer owns any seats. */
export async function releaseCompensatedDeposit(db: DrizzleDB, reservationId: string, now: Date) {
  await db.execute(sql`WITH ended AS (
    UPDATE reservations SET status = 'FAILED', updated_at = ${now}
    WHERE id = ${reservationId} AND status IN ('PENDING_PAYMENT', 'FAILED') RETURNING id, showtime_id
  ) UPDATE seat_inventories s SET status = 'available', locked_by = NULL, locked_until = NULL
    FROM ended WHERE s.showtime_id = ended.showtime_id AND s.locked_by = ended.id AND s.status = 'locked'`);
}

/** Bank reversals can follow DONE. Keep the original seat/ticket identity for a second deposit. */
export async function suspendDepositedOrder(db: DrizzleDB, paymentId: string, reservationId: string, dueAt: Date) {
  await db.transaction(async tx => {
    const changed = await tx.update(reservations).set({ status: 'PENDING_PAYMENT', updatedAt: new Date() })
      .where(and(eq(reservations.id, reservationId), eq(reservations.status, 'CONFIRMED'))).returning({ id: reservations.id });
    if (!changed.length) return;
    await tx.execute(sql`UPDATE seat_inventories si SET status = 'locked', locked_by = ${reservationId},
      locked_until = ${dueAt}, sold_at = NULL FROM ticket_items ti WHERE ti.reservation_id = ${reservationId}
      AND ti.status = 'active' AND si.showtime_id = ti.showtime_id AND si.seat_key = ti.seat_key AND si.status = 'sold'`);
    await tx.update(ticketItems).set({ status: 'expired', cancelReason: DEPOSIT_REVERSED, updatedAt: new Date() })
      .where(and(eq(ticketItems.reservationId, reservationId), eq(ticketItems.status, 'active')));
    const suspended = await tx.execute(sql`UPDATE ticket_benefit_entitlements e SET state = 'inactive'
      WHERE e.state = 'active' AND ((e.booking_addon_hold_id IS NULL AND EXISTS (SELECT 1 FROM ticket_items ti WHERE ti.id = e.ticket_item_id
        AND ti.reservation_id = ${reservationId})) OR EXISTS (SELECT 1 FROM booking_addon_holds h
        WHERE h.id = e.booking_addon_hold_id AND h.reservation_id = ${reservationId})) RETURNING id`);
    await tx.update(payments).set({ status: 'IN_PROGRESS', paidAt: null, asyncStatus: DEPOSIT_REVERSED,
      providerMetadata: sql`${payments.providerMetadata} || jsonb_build_object('suspendedBenefitIds', ${JSON.stringify(suspended.rows.map(r => r['id']))}::jsonb)` })
      .where(eq(payments.id, paymentId));
  });
}

/** Only restore rights suspended by this bank reversal, never a separately cancelled ticket or benefit. */
export async function restoreDepositedOrder(db: DrizzleDB, paymentId: string, reservationId: string, paidAt: Date) {
  await db.transaction(async tx => {
    const restored = await tx.update(reservations).set({ status: 'CONFIRMED', updatedAt: new Date() })
      .where(and(eq(reservations.id, reservationId), eq(reservations.status, 'PENDING_PAYMENT'))).returning({ id: reservations.id });
    if (!restored.length) return;
    await tx.update(seatInventories).set({ status: 'sold', soldAt: paidAt, lockedBy: null, lockedUntil: null })
      .where(and(eq(seatInventories.lockedBy, reservationId), eq(seatInventories.status, 'locked')));
    await tx.update(ticketItems).set({ status: 'active', cancelReason: null, updatedAt: new Date() })
      .where(and(eq(ticketItems.reservationId, reservationId), eq(ticketItems.cancelReason, DEPOSIT_REVERSED),
        eq(ticketItems.status, 'expired')));
    await tx.execute(sql`UPDATE ticket_benefit_entitlements e SET state = 'active' WHERE state = 'inactive'
      AND EXISTS (SELECT 1 FROM ticket_items ti WHERE ti.id = e.ticket_item_id AND ti.status = 'active') AND e.id IN
      (SELECT jsonb_array_elements_text(provider_metadata->'suspendedBenefitIds')::uuid FROM payments WHERE id = ${paymentId})`);
    await tx.update(payments).set({ status: 'DONE', paidAt, asyncStatus: 'deposited',
      providerMetadata: sql`${payments.providerMetadata} - 'suspendedBenefitIds' - 'depositVerification'` }).where(eq(payments.id, paymentId));
  });
}
