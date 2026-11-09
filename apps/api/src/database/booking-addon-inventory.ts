import { BadRequestException, ConflictException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { BookingAddonSelection, FloorAwareSeatSelection } from '@grabit/shared';
import type { DrizzleDB } from './drizzle.provider.js';

type Db = Pick<DrizzleDB, 'execute'>;
type Hold = { id: string; addon_id: string; seat_key: string; price: number; display_copy: unknown; reservation_id: string | null };

/** The caller already checked removal policy; bound allocations remain protected by their FK. */
export async function deleteUnusedBookingAddons(db: Db, performanceId: string, ids?: string[]) {
  if (ids?.length === 0) return;
  // Parent-before-product order matches configuration writes and order FKs.
  // A concurrent order either commits first (and blocks deletion by FK) or
  // waits for this removal. Never cascade-delete a bound purchase allocation.
  const scope = sql`s.performance_id = ${performanceId}${ids
    ? sql` AND s.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}`;
  await db.execute(sql`SELECT s.id FROM showtimes s WHERE ${scope} ORDER BY s.id FOR UPDATE`);
  await db.execute(sql`SELECT a.id FROM booking_addons a JOIN showtimes s ON s.id = a.showtime_id
    WHERE ${scope} ORDER BY a.id FOR UPDATE OF a`);
  await db.execute(sql`DELETE FROM booking_addon_holds h USING booking_addons a, showtimes s
    WHERE h.addon_id = a.id AND a.showtime_id = s.id AND ${scope} AND h.reservation_id IS NULL`);
  await db.execute(sql`DELETE FROM booking_addons a USING showtimes s
    WHERE a.showtime_id = s.id AND ${scope}`);
}

/** Pending provider handoffs reserve stock until their existing recovery flow resolves them. */
export const consumingAddonHold = sql`(
  (h.reservation_id IS NULL AND h.expires_at > clock_timestamp())
  OR r.status = 'PENDING_PAYMENT'
  OR (r.status = 'CONFIRMED' AND (ti.id IS NULL OR ti.status IN ('active', 'cancellation_pending')))
)`;

export async function countAddonConsumption(db: Db, addonId: string, exceptReservationId?: string) {
  const result = await db.execute(sql`
    SELECT count(*)::int AS used FROM booking_addon_holds h
    LEFT JOIN reservations r ON r.id = h.reservation_id
    LEFT JOIN ticket_items ti ON ti.reservation_id = h.reservation_id AND ti.seat_key = h.seat_key
    WHERE h.addon_id = ${addonId} AND ${consumingAddonHold}
      ${exceptReservationId ? sql`AND (h.reservation_id IS NULL OR h.reservation_id <> ${exceptReservationId})` : sql``}
  `);
  return Number(result.rows[0]?.['used'] ?? 0);
}

function selectionsMatch(rows: Hold[], selections: BookingAddonSelection[]) {
  const keys = (items: BookingAddonSelection[]) => items.map((x) => `${x.addonId}:${x.seatKey}`).sort().join('|');
  return rows.length === selections.length && keys(rows.map((r) => ({ addonId: r.addon_id, seatKey: r.seat_key }))) === keys(selections);
}

export async function releaseUnboundAddonHolds(db: DrizzleDB, userId: string, showtimeId: string, seatKey: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT a.id FROM booking_addons a WHERE a.showtime_id = ${showtimeId} ORDER BY a.id FOR UPDATE`);
    await tx.execute(sql`DELETE FROM booking_addon_holds h USING booking_addons a
      WHERE a.id = h.addon_id AND a.showtime_id = ${showtimeId} AND h.user_id = ${userId}
      AND h.seat_key = ${seatKey} AND h.reservation_id IS NULL`);
  });
}

export async function reservationAddonChoices(db: Db, reservationId: string) {
  const result = await db.execute(sql`SELECT h.addon_id, h.seat_key, h.price, h.display_copy, r.payment_deadline_at
    FROM booking_addon_holds h JOIN reservations r ON r.id = h.reservation_id WHERE h.reservation_id = ${reservationId}
    ORDER BY h.addon_id, h.seat_key`);
  return result.rows.map((r) => ({ addonId: String(r['addon_id']), seatKey: String(r['seat_key']), price: Number(r['price']),
    displayCopy: r['display_copy'] as import('@grabit/shared').BookingAddonChoice['displayCopy'],
    expiresAt: new Date(String(r['payment_deadline_at'])).toISOString() }));
}

export async function reservationAddonTotal(db: Db, reservationId: string, selections?: BookingAddonSelection[]): Promise<number> {
  const result = await db.execute(sql`SELECT id, addon_id, seat_key, price, display_copy, reservation_id
    FROM booking_addon_holds WHERE reservation_id = ${reservationId}`);
  const rows = result.rows as unknown as Hold[];
  if (selections && !selectionsMatch(rows, selections)) throw new ConflictException('기존 주문의 애드온 선택과 다릅니다.');
  return rows.reduce((total, row) => total + Number(row.price), 0);
}

/** Lock in a consistent order, then validate and bind the exact requested units in the caller's transaction. */
export async function selectAddonHoldsForOrder(db: Db, input: {
  userId: string; showtimeId: string; selections: BookingAddonSelection[];
  seats: FloorAwareSeatSelection[]; reservationId?: string; expectedTotal?: number;
}): Promise<number> {
  if (!input.selections.length) return 0;
  if (new Set(input.selections.map((s) => `${s.addonId}:${s.seatKey}`)).size !== input.selections.length) {
    throw new BadRequestException('중복된 애드온 선택입니다.');
  }
  const ids = [...new Set(input.selections.map((s) => s.addonId))].sort();
  const definitions = await db.execute(sql`SELECT * FROM booking_addons
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) ORDER BY id FOR UPDATE`);
  if (definitions.rows.length !== ids.length) throw new ConflictException('애드온을 찾을 수 없습니다.');
  const rows: Hold[] = [];
  for (const selection of input.selections) {
    const definition = definitions.rows.find((d) => d['id'] === selection.addonId)!;
    const seat = input.seats.find((s) => s.seatKey === selection.seatKey);
    const tiers = definition['eligible_tier_names'] as string[];
    if (definition['showtime_id'] !== input.showtimeId || !definition['active'] || !seat || !tiers.includes(seat.tierName)) {
      throw new ConflictException('선택한 좌석에서 구매할 수 없는 애드온입니다.');
    }
    const hold = await db.execute(sql`SELECT id, addon_id, seat_key, price, display_copy, reservation_id
      FROM booking_addon_holds WHERE addon_id = ${selection.addonId} AND seat_key = ${selection.seatKey}
      AND user_id = ${input.userId} AND reservation_id IS NULL AND expires_at > clock_timestamp() FOR UPDATE`);
    const row = hold.rows[0] as unknown as Hold | undefined;
    if (!row || Number(row.price) !== Number(definition['price'])) throw new ConflictException('애드온 선점이 만료되거나 가격이 변경되었습니다. 다시 선택해주세요.');
    rows.push(row);
  }
  const total = rows.reduce((sum, r) => sum + Number(r.price), 0);
  if (input.expectedTotal !== undefined && total !== input.expectedTotal) throw new ConflictException('애드온 금액이 변경되었습니다.');
  if (input.reservationId) {
    const updated = await db.execute(sql`UPDATE booking_addon_holds SET reservation_id = ${input.reservationId}
      WHERE id IN (${sql.join(rows.map((r) => sql`${r.id}::uuid`), sql`, `)}) AND expires_at > clock_timestamp() AND reservation_id IS NULL RETURNING id`);
    if (updated.rows.length !== rows.length) throw new ConflictException('애드온 선점이 만료되었습니다.');
  }
  return total;
}

/** Must run in the SAME payment finalization transaction as the tickets and payment. */
export async function finalizeReservationAddons(db: Db, reservationId: string): Promise<void> {
  const holdsResult = await db.execute(sql`SELECT id, addon_id, seat_key, price, display_copy, reservation_id
    FROM booking_addon_holds WHERE reservation_id = ${reservationId} ORDER BY addon_id, seat_key`);
  const holds = holdsResult.rows as unknown as Hold[];
  if (!holds.length) return;
  const ids = [...new Set(holds.map((h) => h.addon_id))].sort();
  const definitions = await db.execute(sql`SELECT id, capacity FROM booking_addons
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) ORDER BY id FOR UPDATE`);
  for (const row of definitions.rows) {
    const required = holds.filter((h) => h.addon_id === row['id']).length;
    if (await countAddonConsumption(db, String(row['id']), reservationId) + required > Number(row['capacity'])) {
      // A late provider approval after a released order cannot oversell; the existing finalizer compensates it.
      throw new ConflictException('한정 애드온 재고가 소진되었습니다.');
    }
  }
  await db.execute(sql`UPDATE ticket_items ti SET addon_amount = (
    SELECT coalesce(sum(h.price), 0)::int FROM booking_addon_holds h
    WHERE h.reservation_id = ti.reservation_id AND h.seat_key = ti.seat_key
  ) WHERE ti.reservation_id = ${reservationId}`);
  await db.execute(sql`INSERT INTO ticket_benefit_entitlements
    (showtime_id, ticket_item_id, booking_addon_hold_id, benefit_identity, benefit_kind, display_copy_snapshot, source, state)
    SELECT ti.showtime_id, ti.id, h.id, 'paid-addon-' || h.addon_id::text, 'paid', h.display_copy, 'purchase', 'active'
    FROM booking_addon_holds h JOIN ticket_items ti ON ti.reservation_id = h.reservation_id AND ti.seat_key = h.seat_key
    WHERE h.reservation_id = ${reservationId}
    ON CONFLICT (booking_addon_hold_id) DO NOTHING`);
}
