import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createBuyerTicketCountReader } from './ticket-limit.js';

const key = (userId: string, performanceId: string) => JSON.stringify([userId, performanceId]);

describe('buyer ticket count burst reads', () => {
  it('returns the matching buyer/performance count even when SQL returns rows in another order', async () => {
    const counts = new Map([[key('buyer-b', 'show-a'), 2], [key('buyer-a', 'show-b'), 0], [key('buyer-a', 'show-a'), 1]]);
    const execute = vi.fn(async (statement: SQL) => {
      const { params } = new PgDialect().sqlToQuery(statement);
      const first = String(params[0]);
      if (first.startsWith('[{')) {
        const requests = JSON.parse(first) as Array<{ request_key: string }>;
        return { rows: requests.map(row => ({ request_key: row.request_key, active_ticket_count: counts.get(row.request_key) })).reverse() };
      }
      return { rows: [{ active_ticket_count: counts.get(key(first, String(params[1]))) }] };
    });
    const read = createBuyerTicketCountReader(() => ({ execute }));
    await expect(Promise.all([read('buyer-a', 'show-a'), read('buyer-a', 'show-b'), read('buyer-b', 'show-a')]))
      .resolves.toEqual([1, 0, 2]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('uses fresh results after a prior read and never combines different readers', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [{ active_ticket_count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ active_ticket_count: 2 }] });
    const read = createBuyerTicketCountReader(() => ({ execute }));
    await expect(read('buyer-a', 'show-a')).resolves.toBe(0);
    await expect(read('buyer-a', 'show-a')).resolves.toBe(2);
    expect(execute).toHaveBeenCalledTimes(2);
    const second = vi.fn().mockResolvedValue({ rows: [{ active_ticket_count: 7 }] });
    await expect(createBuyerTicketCountReader(() => ({ execute: second }))('buyer-a', 'show-a')).resolves.toBe(7);
  });

  it('fails the whole batch if any requested count is missing instead of assuming zero', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ request_key: key('buyer-a', 'show-a'), active_ticket_count: 1 }] });
    const read = createBuyerTicketCountReader(() => ({ execute }));
    const results = await Promise.allSettled([read('buyer-a', 'show-a'), read('buyer-b', 'show-a')]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
  });
});
