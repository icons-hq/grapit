import { sql, type SQL } from 'drizzle-orm';
import { seatInventories } from './schema/seat-inventories.js';
import { ticketItems } from './schema/ticket-items.js';

export const ACTIVE_TICKET_ITEM_STATUSES = ['active', 'cancellation_pending'] as const;

export const ACTIVE_SEAT_UNIQUE_INDEX = 'uq_ticket_items_active_seat';

/**
 * seat_inventories 해제(available/held_cancelled 전환) 전, 같은 좌석을 점유 중인
 * 유효(active/cancellation_pending) ticket_items가 없음을 보장하는 상관 조건.
 * seat_inventories를 대상으로 하는 UPDATE의 WHERE 절에서만 사용해야 한다.
 */
export function noActiveTicketItemOnSeat(): SQL {
  return sql`not exists (
    select 1 from ${ticketItems}
    where ${ticketItems.showtimeId} = ${seatInventories.showtimeId}
      and ${ticketItems.floorKey} = ${seatInventories.floorKey}
      and ${ticketItems.seatKey} = ${seatInventories.seatKey}
      and ${ticketItems.status} in ('active', 'cancellation_pending')
  )`;
}

export function isActiveSeatUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === '23505' && candidate.constraint === ACTIVE_SEAT_UNIQUE_INDEX) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
