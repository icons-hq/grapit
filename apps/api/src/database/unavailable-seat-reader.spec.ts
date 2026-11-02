import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createUnavailableSeatReader } from './unavailable-seat-reader.js';

const seat = (floorKey: string) => ({ floorKey, seatKey: `${floorKey}:A-1`, seatId: 'A-1' });

describe('unavailable seat burst reads', () => {
  it('keeps showtime and floor identities separate, including an explicit available result', async () => {
    const execute = vi.fn(async (statement: SQL) => {
      const { params } = new PgDialect().sqlToQuery(statement);
      const requests = JSON.parse(String(params[0])) as Array<{ request_key: string; showtime_id: string; floor_key: string }>;
      return { rows: requests.map(row => ({ request_key: row.request_key,
        status: row.showtime_id === 'second' ? 'held_cancelled' : row.floor_key === '2F' ? null : 'sold',
      })).reverse() };
    });
    const read = createUnavailableSeatReader(() => ({ execute, select: vi.fn() }));
    await expect(Promise.all([read('first', seat('1F')), read('first', seat('2F')), read('second', seat('1F'))]))
      .resolves.toEqual([{ status: 'sold' }, null, { status: 'held_cancelled' }]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed on missing, duplicate or invalid status rows', async () => {
    const requestKey = JSON.stringify(['first', '1F', '1F:A-1', 'A-1']);
    for (const rows of [[], [{ request_key: requestKey, status: 'sold' }, { request_key: requestKey, status: null }],
      [{ request_key: requestKey, status: 'available' }]]) {
      const read = createUnavailableSeatReader(() => ({ execute: vi.fn().mockResolvedValue({ rows }), select: vi.fn() }));
      const results = await Promise.allSettled([read('first', seat('1F')), read('first', seat('2F'))]);
      expect(results.every(result => result.status === 'rejected')).toBe(true);
    }
  });
});
