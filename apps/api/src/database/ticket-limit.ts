import { NotFoundException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DEFAULT_PERFORMANCE_BOOKING_POLICY } from '@grabit/shared';
import { parseE164 } from '../modules/sms/phone.util.js';
import type { DrizzleDB } from './drizzle.provider.js';
type TicketLimitExecutor = Pick<DrizzleDB, 'execute'>;
type TicketLimitSnapshot = { performanceId: string; maxTicketsPerUser: number; activeTicketCount: number };
type BuyerTicketCountRow = {
  active_ticket_count?: unknown;
  buyer_phone?: unknown;
  buyer_phone_verified?: unknown;
  linked_phone_accounts?: unknown;
};

/*
 * The per-person ticket limit (booking_policies.max_tickets_per_user) is summed
 * over every Buyer Account that verified the same phone number (E.164). An
 * account without a verified phone keeps the account-only limit. Seat lock and
 * prepare also count seats the other accounts of that phone hold in unexpired
 * pending payments; the confirm-time snapshot counts confirmed tickets only.
 *
 * Stored phones keep the submitted format ("010-…", "+82…", "+82 0…"), so SQL
 * narrows candidates by the last 8 digits — identical for every format of one
 * number — and parseE164 decides the exact identity, the same normalization
 * the SMS verification token uses. The expression must stay byte-identical to
 * idx_users_verified_phone_suffix (migration 0039) for the index to apply.
 */
function verifiedPhoneSuffix(phoneColumn: SQL): SQL {
  return sql`right(regexp_replace(translate(${phoneColumn}, '０１２３４５６７８９', '0123456789'), '[^0-9]', '', 'g'), 8)`;
}

function confirmedTicketCount(input: {
  userId: SQL;
  performanceId: SQL;
  excludeReservationId?: string;
}): SQL {
  return sql`(
    SELECT count(*)::int
    FROM ticket_items ti
    INNER JOIN reservations r ON r.id = ti.reservation_id
    INNER JOIN showtimes ticket_showtimes ON ticket_showtimes.id = ti.showtime_id
    WHERE r.user_id = ${input.userId}
      ${input.excludeReservationId ? sql`AND r.id <> ${input.excludeReservationId}` : sql``}
      AND ticket_showtimes.performance_id = ${input.performanceId}
      AND r.status = 'CONFIRMED'
      AND ti.status IN ('active', 'cancellation_pending')
  )`;
}

/*
 * Seats another account holds in an unexpired PENDING_PAYMENT reservation. Only the
 * lock/prepare pre-checks add these for linked accounts, so a second account of the
 * same phone is stopped before payment instead of being compensation-cancelled after
 * Toss approval. The buyer's own pending orders stay excluded: Redis seat holds already
 * bound them, and a retried order must not count against itself.
 */
function unexpiredPendingSeatCount(input: { userId: SQL; performanceId: SQL }): SQL {
  return sql`(
    SELECT count(*)::int
    FROM reservation_seats pending_seats
    INNER JOIN reservations pending ON pending.id = pending_seats.reservation_id
    INNER JOIN showtimes pending_showtimes ON pending_showtimes.id = pending.showtime_id
    WHERE pending.user_id = ${input.userId}
      AND pending_showtimes.performance_id = ${input.performanceId}
      AND pending.status = 'PENDING_PAYMENT'
      AND pending.payment_deadline_at > now()
  )`;
}

function buyerPhoneColumns(input: {
  performanceId: SQL;
  excludeReservationId?: string;
  includeLinkedPendingSeats?: boolean;
}): SQL {
  return sql`
    buyer.phone AS buyer_phone,
    buyer.is_phone_verified AS buyer_phone_verified,
    (
      SELECT coalesce(json_agg(json_build_object(
        'phone', linked.phone,
        'active_ticket_count', ${confirmedTicketCount({
          userId: sql`linked.id`,
          performanceId: input.performanceId,
          excludeReservationId: input.excludeReservationId,
        })}${input.includeLinkedPendingSeats
          ? sql`,
        'pending_seat_count', ${unexpiredPendingSeatCount({
          userId: sql`linked.id`,
          performanceId: input.performanceId,
        })}`
          : sql``}
      )), '[]'::json)
      FROM users linked
      WHERE buyer.is_phone_verified = true
        AND linked.is_phone_verified = true
        AND linked.id <> buyer.id
        AND ${verifiedPhoneSuffix(sql`linked.phone`)} = ${verifiedPhoneSuffix(sql`buyer.phone`)}
    ) AS linked_phone_accounts
  `;
}

function toCount(value: unknown): number {
  const count = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function toE164OrNull(phone: unknown): string | null {
  if (typeof phone !== 'string' || phone.length === 0) {
    return null;
  }
  try {
    return parseE164(phone);
  } catch {
    return null;
  }
}

/**
 * Buyer's own confirmed tickets plus those of accounts sharing the verified phone, and
 * those accounts' unexpired pending seats when the query selected them.
 */
function sumBuyerIdentityTickets(row: BuyerTicketCountRow): number {
  const ownCount = toCount(row.active_ticket_count);
  const buyerPhone = row.buyer_phone_verified === true ? toE164OrNull(row.buyer_phone) : null;
  if (!buyerPhone || !Array.isArray(row.linked_phone_accounts)) {
    return ownCount;
  }

  return row.linked_phone_accounts.reduce<number>((total, account) => {
    const linked = account as {
      phone?: unknown;
      active_ticket_count?: unknown;
      pending_seat_count?: unknown;
    };
    return toE164OrNull(linked.phone) === buyerPhone
      ? total + toCount(linked.active_ticket_count) + toCount(linked.pending_seat_count)
      : total;
  }, ownCount);
}

/**
 * Seat lock / prepare pre-check count for the buyer's verified phone identity: confirmed
 * active tickets of every account of that phone, plus seats the other accounts hold in
 * unexpired pending payments. The confirm-time snapshot counts confirmed tickets only.
 */
export async function countBuyerActiveTicketsForPerformance(
  executor: TicketLimitExecutor,
  userId: string,
  performanceId: string,
): Promise<number> {
  const result = await executor.execute(sql`
    SELECT
      ${confirmedTicketCount({ userId: sql`${userId}`, performanceId: sql`${performanceId}` })} AS active_ticket_count,
      ${buyerPhoneColumns({ performanceId: sql`${performanceId}`, includeLinkedPendingSeats: true })}
    FROM (SELECT 1) AS anchor
    LEFT JOIN users buyer ON buyer.id = ${userId}
  `);

  return sumBuyerIdentityTickets((result.rows[0] ?? {}) as BuyerTicketCountRow);
}

export async function getTicketLimitSnapshot(
  executor: TicketLimitExecutor,
  userId: string,
  reservationId: string,
  showtimeId: string,
): Promise<TicketLimitSnapshot> {
  const result = await executor.execute(sql`
    SELECT
      s.performance_id,
      coalesce(
        bp.max_tickets_per_user,
        ${DEFAULT_PERFORMANCE_BOOKING_POLICY.maxTicketsPerUser}
      )::int AS max_tickets_per_user,
      ${confirmedTicketCount({
        userId: sql`${userId}`,
        performanceId: sql`s.performance_id`,
        excludeReservationId: reservationId,
      })} AS active_ticket_count,
      ${buyerPhoneColumns({ performanceId: sql`s.performance_id`, excludeReservationId: reservationId })}
    FROM showtimes s
    LEFT JOIN booking_policies bp ON bp.performance_id = s.performance_id
    LEFT JOIN users buyer ON buyer.id = ${userId}
    WHERE s.id = ${showtimeId}
  `);
  const row = result.rows[0] as
    | (BuyerTicketCountRow & {
      performance_id?: unknown;
      max_tickets_per_user?: unknown;
    })
    | undefined;

  if (!row) {
    throw new NotFoundException('회차를 찾을 수 없습니다');
  }

  return {
    performanceId: String(row.performance_id),
    maxTicketsPerUser: Number(row.max_tickets_per_user ?? 0),
    activeTicketCount: sumBuyerIdentityTickets(row),
  };
}

/**
 * Serializes limit checks of one buyer identity for a performance. Accounts
 * with a verified phone share the phone-suffix scope — a superset of the exact
 * E.164 identity, so every account of that phone takes the same lock.
 */
export async function lockTicketLimitScope(
  executor: TicketLimitExecutor,
  userId: string,
  performanceId: string,
): Promise<void> {
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        'ticket-limit:'
          || coalesce(
            (
              SELECT 'phone:' || ${verifiedPhoneSuffix(sql`buyer.phone`)}
              FROM users buyer
              WHERE buyer.id = ${userId}
                AND buyer.is_phone_verified = true
                AND ${verifiedPhoneSuffix(sql`buyer.phone`)} <> ''
            ),
            ${userId}
          )
          || ':'
          || ${performanceId},
        0
      )
    )
  `);
}
