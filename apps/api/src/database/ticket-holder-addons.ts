import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { BookingAddonSelection, TicketAddonOffer, TicketAddonOptions, TicketAddonOrder } from '@grabit/shared';
import type { DrizzleDB } from './drizzle.provider.js';
import { consumingAddonHold, countAddonConsumption } from './booking-addon-inventory.js';

type Db = Pick<DrizzleDB, 'execute'>;
type HolderTicket = {
  id: string; reservation_id: string; showtime_id: string; seat_key: string; tier_name: string;
  eligible: boolean;
};

async function readHolderTicket(db: Db, ticketId: string, userId: string, lock: boolean) {
  const result = await db.execute<HolderTicket>(sql`SELECT ti.id, ti.reservation_id, ti.showtime_id, ti.seat_key, ti.tier_name,
    (r.status = 'CONFIRMED' AND ti.status = 'active' AND ti.admission_state = 'not_entered'
      AND s.date_time > clock_timestamp() AND p.status <> 'ended') AS eligible
    FROM ticket_items ti JOIN reservations r ON r.id = ti.reservation_id
    JOIN showtimes s ON s.id = ti.showtime_id JOIN performances p ON p.id = s.performance_id
    WHERE ti.id = ${ticketId} AND r.user_id = ${userId} ${lock ? sql`FOR UPDATE OF r, ti` : sql``}`);
  if (!result.rows[0]) throw new NotFoundException('티켓을 찾을 수 없습니다.');
  return result.rows[0];
}

export async function requirePurchasableTicket(db: Db, ticketId: string, userId: string, showtimeId: string, lock = false) {
  const ticket = await readHolderTicket(db, ticketId, userId, lock);
  if (ticket.showtime_id !== showtimeId || !ticket.eligible) {
    throw new ConflictException('이 티켓에는 애드온을 추가할 수 없습니다.');
  }
  return ticket;
}

// A slot can be consumed by the original seat checkout or a later payment for the same Ticket Item.
// Cancelled/failed checkouts retain their receipt rows without occupying a slot.
function ticketOrderScope(ticket: HolderTicket) {
  return sql`(r.id = ${ticket.reservation_id} OR r.addon_ticket_item_id = ${ticket.id})
    AND r.status IN ('PENDING_PAYMENT', 'CONFIRMED') AND h.seat_key = ${ticket.seat_key}`;
}

export async function ticketAddonOptions(db: Db, ticketId: string, userId: string): Promise<TicketAddonOptions> {
  const ticket = await readHolderTicket(db, ticketId, userId, false);
  const orders = await db.execute<TicketAddonOrder & Record<string, unknown>>(sql`SELECT r.toss_order_id AS "orderId",
    r.total_amount AS amount, r.status, f.status AS "refundStatus",
    (f.provider_metadata->'cancellationQuote'->>'refundableAmount')::int AS "refundableAmount" FROM reservations r
    LEFT JOIN refunds f ON f.reservation_id = r.id WHERE r.addon_ticket_item_id = ${ticketId}
    AND (r.status IN ('PENDING_PAYMENT','CONFIRMED') OR f.id IS NOT NULL OR EXISTS
      (SELECT 1 FROM payments pay WHERE pay.reservation_id = r.id AND pay.paid_at IS NOT NULL))
    ORDER BY r.created_at DESC`);
  if (!ticket.eligible) return { seatKey: ticket.seat_key, offers: [], orders: orders.rows };
  const offers = await db.execute<TicketAddonOffer & Record<string, unknown>>(sql`SELECT a.id, a.display_copy AS "displayCopy", a.price,
    ARRAY(SELECT n FROM generate_series(1,a.max_per_ticket) n WHERE NOT EXISTS
      (SELECT 1 FROM booking_addon_holds h JOIN reservations r ON r.id = h.reservation_id
       WHERE h.addon_id = a.id AND h.unit_index = n AND ${ticketOrderScope(ticket)})) AS "remainingUnits",
    greatest(0, a.capacity - (SELECT count(*)::int FROM booking_addon_holds h
      LEFT JOIN reservations r ON r.id = h.reservation_id LEFT JOIN ticket_items ti
      ON ti.reservation_id = h.reservation_id AND ti.seat_key = h.seat_key
      WHERE h.addon_id = a.id AND ${consumingAddonHold})) AS available
    FROM booking_addons a WHERE a.showtime_id = ${ticket.showtime_id} AND a.active
    AND a.eligible_tier_names ? ${ticket.tier_name} ORDER BY a.sort_order, a.id`);
  return { seatKey: ticket.seat_key, orders: orders.rows, offers: offers.rows };
}

export async function quoteTicketAddons(db: Db, showtimeId: string, selections: BookingAddonSelection[]) {
  if (!selections.length) throw new BadRequestException('구매할 애드온을 선택해주세요.');
  const requested = sql.join(selections.map(item => sql`${item.addonId}::uuid`), sql`, `);
  const result = await db.execute(sql`SELECT count(*)::int AS units, sum(a.price)::int AS total
    FROM unnest(ARRAY[${requested}]) item_id JOIN booking_addons a ON a.id = item_id
    WHERE a.showtime_id = ${showtimeId} AND a.active`);
  if (Number(result.rows[0]?.['units']) !== selections.length) throw new ConflictException('구매할 수 없는 애드온입니다.');
  return Number(result.rows[0]!['total']);
}

type Allocation = { ticketId: string; userId: string; showtimeId: string; reservationId: string; expectedTotal: number };

/** Called in the transaction which creates the pending order, and again before issuing on a late approval. */
async function validateAllocation(db: Db, input: Allocation, ticket: HolderTicket, selections: BookingAddonSelection[], preparing: boolean) {
  const ids = [...new Set(selections.map((s) => s.addonId))].sort();
  if (!ids.length) throw new BadRequestException('구매할 애드온을 선택해주세요.');
  const products = await db.execute(sql`SELECT * FROM booking_addons WHERE showtime_id = ${input.showtimeId}
    AND id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)}) ORDER BY id FOR UPDATE`);
  if (products.rows.length !== ids.length) throw new ConflictException('이 회차에서 구매할 수 없는 애드온입니다.');
  let total = 0;
  for (const product of products.rows) {
    const addonId = String(product['id']);
    const units = selections.filter(s => s.addonId === addonId);
    const slots = units.map(s => s.unitIndex ?? 1);
    const tiers = product['eligible_tier_names'] as string[];
    if ((preparing && !product['active']) || !tiers.includes(ticket.tier_name) ||
        units.some(s => s.seatKey !== ticket.seat_key) || new Set(slots).size !== slots.length ||
        slots.some(slot => !Number.isInteger(slot) || slot < 1 || slot > Number(product['max_per_ticket']))) {
      throw new ConflictException('티켓 등급 또는 구매 한도에 맞지 않는 애드온입니다.');
    }
    const occupied = await db.execute(sql`SELECT 1 FROM booking_addon_holds h JOIN reservations r ON r.id = h.reservation_id
      WHERE h.addon_id = ${addonId} AND ${ticketOrderScope(ticket)} AND r.id <> ${input.reservationId}
      AND h.unit_index IN (${sql.join(slots.map(slot => sql`${slot}`), sql`, `)}) LIMIT 1`);
    if (occupied.rows.length) throw new ConflictException('이미 구매했거나 결제 중인 애드온 수량입니다.');
    if (await countAddonConsumption(db, addonId, input.reservationId) + units.length > Number(product['capacity'])) {
      throw new ConflictException('애드온 재고가 부족합니다. 남은 수량을 다시 확인해주세요.');
    }
    if (preparing) {
      await db.execute(sql`INSERT INTO booking_addon_holds
        (addon_id,user_id,seat_key,unit_index,reservation_id,price,display_copy,expires_at)
        SELECT a.id, r.user_id, ${ticket.seat_key}, n, r.id, a.price, a.display_copy, r.payment_deadline_at
        FROM booking_addons a, reservations r, unnest(ARRAY[${sql.join(slots.map(slot => sql`${slot}::int`), sql`, `)}]) n
        WHERE a.id = ${addonId} AND r.id = ${input.reservationId}`);
    }
    total += Number(product['price']) * units.length;
  }
  if (total !== input.expectedTotal) throw new ConflictException('애드온 금액이 변경되었습니다. 다시 선택해주세요.');
}

export function reserveTicketAddons(db: Db, input: Allocation, lockedTicket: HolderTicket, selections: BookingAddonSelection[]) {
  return validateAllocation(db, input, lockedTicket, selections, true);
}

export async function issueTicketAddons(db: Db, input: Allocation) {
  const holds = await db.execute(sql`SELECT addon_id, seat_key, unit_index FROM booking_addon_holds
    WHERE reservation_id = ${input.reservationId} ORDER BY addon_id, unit_index`);
  const ticket = await requirePurchasableTicket(db, input.ticketId, input.userId, input.showtimeId, true);
  await validateAllocation(db, input, ticket, holds.rows.map(h => ({
    addonId: String(h['addon_id']), seatKey: String(h['seat_key']), unitIndex: Number(h['unit_index']),
  })), false);
  await db.execute(sql`INSERT INTO ticket_benefit_entitlements
    (showtime_id,ticket_item_id,booking_addon_hold_id,benefit_identity,benefit_kind,display_copy_snapshot,source,state)
    SELECT ${input.showtimeId}, ${input.ticketId}, h.id, 'paid-addon-' || h.addon_id::text, 'paid', h.display_copy, 'purchase', 'active'
    FROM booking_addon_holds h WHERE h.reservation_id = ${input.reservationId}
    ON CONFLICT (booking_addon_hold_id) DO NOTHING`);
}
