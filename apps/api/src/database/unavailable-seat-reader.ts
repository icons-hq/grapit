import { InternalServerErrorException } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { FreshReadBatcher } from '../common/fresh-read-batcher.js';
import type { DrizzleDB } from './drizzle.provider.js';
import { seatInventories } from './schema/seat-inventories.js';

type SeatIdentity = { floorKey: string; seatKey: string; seatId: string };
type UnavailableSeat = { status: 'sold' | 'held_cancelled' | 'disabled' };

/** Fresh prechecks only: Redis ownership and confirm's transaction stay authoritative. */
export function createUnavailableSeatReader(executor: () => Pick<DrizzleDB, 'select' | 'execute'>) {
  const batch = new FreshReadBatcher<string, UnavailableSeat | null>(async (keys) => {
    const requests = keys.map((requestKey) => {
      const [showtimeId, floorKey, seatKey, seatId] = JSON.parse(requestKey) as string[];
      return { request_key: requestKey, showtime_id: showtimeId!, floor_key: floorKey!, seat_key: seatKey!, seat_id: seatId! };
    });
    if (requests.length === 1) {
      const request = requests[0]!;
      const [row] = await executor().select({ status: seatInventories.status }).from(seatInventories).where(and(
        eq(seatInventories.showtimeId, request.showtime_id),
        eq(seatInventories.floorKey, request.floor_key),
        or(eq(seatInventories.seatKey, request.seat_key), and(isNull(seatInventories.seatKey), eq(seatInventories.seatId, request.seat_id))),
        or(eq(seatInventories.status, 'sold'), eq(seatInventories.status, 'held_cancelled'), eq(seatInventories.status, 'disabled')),
      ));
      return new Map([[request.request_key, row as UnavailableSeat | undefined ?? null]]);
    }
    const result = await executor().execute(sql`
      SELECT request.request_key, unavailable.status
      FROM jsonb_to_recordset(${JSON.stringify(requests)}::jsonb)
        AS request(request_key text, showtime_id uuid, floor_key text, seat_key text, seat_id text)
      LEFT JOIN LATERAL (
        SELECT inventory.status FROM seat_inventories inventory
        WHERE inventory.showtime_id = request.showtime_id AND inventory.floor_key = request.floor_key
          AND (inventory.seat_key = request.seat_key OR (inventory.seat_key IS NULL AND inventory.seat_id = request.seat_id))
          AND inventory.status IN ('sold', 'held_cancelled', 'disabled')
        LIMIT 1
      ) unavailable ON true
    `);
    const rows = new Map<string, UnavailableSeat | null>();
    for (const row of result.rows as Array<{ request_key: unknown; status: unknown }>) {
      if (typeof row.request_key !== 'string' || rows.has(row.request_key)
        || (row.status !== null && row.status !== 'sold' && row.status !== 'held_cancelled' && row.status !== 'disabled')) {
        throw new InternalServerErrorException('좌석 상태를 확인하지 못했습니다');
      }
      rows.set(row.request_key, row.status === null ? null : { status: row.status });
    }
    if (rows.size !== keys.length || keys.some(key => !rows.has(key))) {
      throw new InternalServerErrorException('좌석 상태를 확인하지 못했습니다');
    }
    return rows;
  });
  return async (showtimeId: string, seat: SeatIdentity): Promise<UnavailableSeat | null> => {
    const row = await batch.read(JSON.stringify([showtimeId, seat.floorKey, seat.seatKey, seat.seatId]));
    if (row === undefined) throw new InternalServerErrorException('좌석 상태를 확인하지 못했습니다');
    return row;
  };
}
