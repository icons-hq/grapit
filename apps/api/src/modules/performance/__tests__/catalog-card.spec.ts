import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  mapPublicCatalogCard,
  publicCatalogStatusCondition,
  resolveEffectivePerformanceStatus,
  resolvePublicCatalogStatus,
} from '../catalog-card.js';

const NOW = new Date('2026-10-01T10:59:00.000Z');
const FUTURE = new Date('2026-10-01T11:00:00.000Z');
const PAST = new Date('2026-10-01T10:00:00.000Z');

describe('resolvePublicCatalogStatus', () => {
  it.each([
    ['upcoming', FUTURE, 'upcoming'],
    ['upcoming', PAST, 'selling'],
    ['upcoming', null, 'upcoming'],
    ['selling', FUTURE, 'upcoming'],
    ['closing_soon', FUTURE, 'upcoming'],
    ['selling', PAST, 'selling'],
    ['closing_soon', PAST, 'closing_soon'],
    ['selling', null, 'selling'],
    ['ended', FUTURE, 'ended'],
  ] as const)('%s with booking start %s reads as %s', (status, startsAt, expected) => {
    expect(resolvePublicCatalogStatus(status, startsAt, NOW)).toBe(expected);
  });

  it('keeps the effective status used by detail and admin reads unchanged', () => {
    // findById still exposes the stored selling status; the admin edit form saves it back (#145).
    expect(resolveEffectivePerformanceStatus('selling', FUTURE, NOW)).toBe('selling');
  });

  it('maps catalog cards with the buyer-facing status', () => {
    const card = mapPublicCatalogCard({
      id: 'p1', title: 't', genre: 'artist_celebrity', posterUrl: null, status: 'selling',
      startDate: null, endDate: null, venueName: null, bookingStartsAt: new Date(Date.now() + 60_000),
    } as never);
    expect(card.status).toBe('upcoming');
  });
});

describe('publicCatalogStatusCondition', () => {
  const dialect = new PgDialect();
  const render = (status: 'selling' | 'upcoming') => {
    const condition = publicCatalogStatusCondition(status, NOW);
    if (!condition) throw new Error('missing condition');
    return dialect.sqlToQuery(condition);
  };

  it('only lists selling or closing soon rows as on sale once their booking start has passed', () => {
    const { sql, params } = render('selling');
    expect(sql).toMatch(/"performances"\."status" in \(\$\d+, \$\d+\) and \("booking_policies"\."booking_starts_at" is null or "booking_policies"\."booking_starts_at" <= \$\d+\)/);
    expect(params).toEqual(expect.arrayContaining(['selling', 'closing_soon', 'upcoming']));
  });

  it('lists selling or closing soon rows with a future booking start as upcoming', () => {
    const { sql } = render('upcoming');
    expect(sql).toMatch(/"performances"\."status" in \(\$\d+, \$\d+\) and "booking_policies"\."booking_starts_at" > \$\d+/);
  });
});
