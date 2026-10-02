import { describe, expect, it, vi } from 'vitest';

import {
  bookingPolicies,
  performanceSeatTiers,
  performances,
  priceTiers,
  seatMaps,
  showtimes,
} from '../../database/schema/index.js';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { readPerformancePreparation } from './performance-preparation.js';

const NOW = new Date('2026-10-01T00:00:00.000Z');

type Fixture = {
  performance?: Partial<typeof performances.$inferSelect>;
  tiers?: Array<{ tierName: string; price: number }>;
  maps?: Array<{ venueLayoutId: string | null; seatConfig: unknown }>;
  overlayTiers?: Array<{ tierName: string; price: number; assignments: number }>;
  bookingStartsAt?: Date | null;
};

function createDb(fixture: Fixture = {}) {
  const performance = {
    id: 'perf-1', title: '팬미팅', description: '상세 안내', venueId: 'venue-1', ageRating: '전체 관람가',
    startDate: new Date('2026-12-01T00:00:00.000Z'), endDate: new Date('2026-12-02T00:00:00.000Z'),
    status: 'upcoming', publishState: 'draft', updatedAt: new Date('2026-09-30T00:00:00.000Z'),
    ...fixture.performance,
  };
  const maps = fixture.maps ?? [{ venueLayoutId: 'layout-1', seatConfig: { tiers: [{ tierName: 'VIP', color: '#000', seatIds: ['A-1', 'A-2'] }] } }];
  const rowsByTable = new Map<unknown, unknown[]>([
    [performances, [performance]],
    [showtimes, [{ id: 'showtime-1' }]],
    [priceTiers, fixture.tiers ?? [{ tierName: 'VIP', price: 50000 }]],
    [seatMaps, maps],
    [bookingPolicies, [{ allowedPaymentMethods: ['CARD'],
      bookingStartsAt: fixture.bookingStartsAt === undefined ? new Date('2026-10-08T11:00:00.000Z') : fixture.bookingStartsAt }]],
    [performanceSeatTiers, fixture.overlayTiers ?? [{ tierName: 'VIP', price: 50000, assignments: 2 }]],
  ]);
  const select = vi.fn(() => {
    let rows: unknown[] = [];
    const chain: Record<string, unknown> = {};
    for (const method of ['where', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'groupBy']) chain[method] = () => chain;
    chain.from = (table: unknown) => { rows = rowsByTable.get(table) ?? []; return chain; };
    chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return chain;
  });
  const execute = vi.fn().mockResolvedValue({ rows: [{ id: 'perf-1', protected: false, reservation_count: 0 }] });
  return { select, execute } as unknown as DrizzleDB;
}

const check = (preparation: Awaited<ReturnType<typeof readPerformancePreparation>>, key: string) =>
  preparation.checks.find((item) => item.key === key)!;

describe('readPerformancePreparation sale opening gate', () => {
  it('keeps a published-upcoming performance without a start time publishable but says sales will not open on their own', async () => {
    const preparation = await readPerformancePreparation(createDb({ bookingStartsAt: null }), 'perf-1', NOW);

    expect(preparation.saleOpening).toEqual({ mode: 'manual', at: null, startElapsed: false });
    expect(check(preparation, 'sales').ready).toBe(true);
    expect(check(preparation, 'sales').detail).toContain('자동으로 열리지 않습니다');
  });

  it('reports a future start as the actual KST sale opening', async () => {
    const preparation = await readPerformancePreparation(createDb(), 'perf-1', NOW);

    expect(preparation.saleOpening.mode).toBe('scheduled');
    expect(check(preparation, 'sales').detail).toContain('2026-10-08 20:00 KST');
    expect(check(preparation, 'sales').ready).toBe(true);
    expect(check(preparation, 'seats').ready).toBe(true);
  });

  it('blocks publishing an unpublished performance whose stored start already passed', async () => {
    const preparation = await readPerformancePreparation(createDb({ bookingStartsAt: new Date('2025-10-01T11:00:00.000Z') }), 'perf-1', NOW);

    expect(preparation.saleOpening).toMatchObject({ mode: 'immediate', startElapsed: true });
    expect(check(preparation, 'sales').ready).toBe(false);
    expect(check(preparation, 'sales').detail).toContain('이미 지났습니다');
  });

  it('does not flag an elapsed start once the performance is already public', async () => {
    const preparation = await readPerformancePreparation(createDb({ bookingStartsAt: new Date('2026-09-01T11:00:00.000Z'),
      performance: { publishState: 'published' } }), 'perf-1', NOW);

    expect(check(preparation, 'sales').ready).toBe(true);
  });

  it('flags that an open sale status without a start time sells as soon as it is published', async () => {
    const preparation = await readPerformancePreparation(createDb({ bookingStartsAt: null, performance: { status: 'selling' } }), 'perf-1', NOW);

    expect(preparation.saleOpening.mode).toBe('immediate');
    expect(check(preparation, 'sales').detail).toContain('공개하는 즉시 판매가 열립니다');
  });
});

describe('readPerformancePreparation seat and price gate', () => {
  it('blocks publication while any price tier is 0', async () => {
    const preparation = await readPerformancePreparation(createDb({
      tiers: [{ tierName: 'VIP', price: 50000 }, { tierName: 'R', price: 0 }],
    }), 'perf-1', NOW);

    expect(check(preparation, 'seats').ready).toBe(false);
    expect(check(preparation, 'seats').detail).toContain('0원 가격 등급: R');
  });

  it('blocks publication when the sellable overlay lost a tier\'s seat assignments', async () => {
    // 'VIP ' was matched raw against a trimmed overlay tier, so no assignment was created.
    const preparation = await readPerformancePreparation(createDb({
      tiers: [{ tierName: 'VIP ', price: 50000 }],
      maps: [{ venueLayoutId: 'layout-1', seatConfig: { tiers: [{ tierName: 'VIP ', color: '#000', seatIds: ['A-1', 'A-2'] }] } }],
      overlayTiers: [{ tierName: 'VIP', price: 50000, assignments: 0 }],
    }), 'perf-1', NOW);

    expect(check(preparation, 'seats').ready).toBe(false);
    expect(check(preparation, 'seats').detail).toContain('좌석맵을 다시 저장');
  });

  it('blocks publication when the charged overlay price differs from the displayed tier price', async () => {
    const preparation = await readPerformancePreparation(createDb({
      tiers: [{ tierName: 'VIP', price: 120000 }],
      overlayTiers: [{ tierName: 'VIP ', price: 100000, assignments: 2 }],
    }), 'perf-1', NOW);

    expect(check(preparation, 'seats').ready).toBe(false);
  });

  it('accepts trimmed-equal names when every seat is assigned at the displayed price', async () => {
    const preparation = await readPerformancePreparation(createDb({
      tiers: [{ tierName: 'VIP ', price: 50000 }],
      overlayTiers: [{ tierName: 'VIP', price: 50000, assignments: 2 }],
    }), 'perf-1', NOW);

    expect(check(preparation, 'seats').ready).toBe(true);
  });

  it('requires exact names for legacy seat maps that checkout prices from price tiers directly', async () => {
    const preparation = await readPerformancePreparation(createDb({
      tiers: [{ tierName: 'VIP', price: 50000 }],
      maps: [{ venueLayoutId: null, seatConfig: { tiers: [{ tierName: 'VIP ', color: '#000', seatIds: ['A-1'] }] } }],
      overlayTiers: [],
    }), 'perf-1', NOW);

    expect(check(preparation, 'seats').ready).toBe(false);
  });
});
