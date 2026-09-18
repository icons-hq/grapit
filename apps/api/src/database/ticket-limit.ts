import { NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DEFAULT_PERFORMANCE_BOOKING_POLICY } from '@grabit/shared';
import type { DrizzleDB } from './drizzle.provider.js';
type TicketLimitExecutor = Pick<DrizzleDB, 'execute'>;
type TicketLimitSnapshot = { performanceId: string; maxTicketsPerUser: number; activeTicketCount: number };

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
      (
        SELECT count(*)::int
        FROM ticket_items ti
        INNER JOIN reservations r ON r.id = ti.reservation_id
        INNER JOIN showtimes ticket_showtimes ON ticket_showtimes.id = ti.showtime_id
        WHERE r.user_id = ${userId}
          AND r.id <> ${reservationId}
          AND ticket_showtimes.performance_id = s.performance_id
          AND r.status = 'CONFIRMED'
          AND ti.status IN ('active', 'cancellation_pending')
      ) AS active_ticket_count
    FROM showtimes s
    LEFT JOIN booking_policies bp ON bp.performance_id = s.performance_id
    WHERE s.id = ${showtimeId}
  `);
  const row = result.rows[0] as
    | {
      performance_id?: unknown;
      max_tickets_per_user?: unknown;
      active_ticket_count?: unknown;
    }
    | undefined;

  if (!row) {
    throw new NotFoundException('회차를 찾을 수 없습니다');
  }

  return {
    performanceId: String(row.performance_id),
    maxTicketsPerUser: Number(row.max_tickets_per_user ?? 0),
    activeTicketCount: Number(row.active_ticket_count ?? 0),
  };
}

export async function lockTicketLimitScope(
  executor: TicketLimitExecutor,
  userId: string,
  performanceId: string,
): Promise<void> {
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`ticket-limit:${userId}:${performanceId}`}, 0)
    )
  `);
}
