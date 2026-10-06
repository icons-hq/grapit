import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  areAllShowtimesSalesClosed,
  mapPublicCatalogCard,
  publicCatalogNotEndedCondition,
  publicCatalogStatusCondition,
  resolveEffectivePerformanceStatus,
  resolvePublicCatalogStatus,
  withPublicCatalogStatus,
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

  it('keeps the effective status used by the admin detail read unchanged', () => {
    // findById computes the effective status for both reads; only the public
    // controller applies the booking-start rule on top (withPublicCatalogStatus).
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

// Audit: a performance whose showtimes have all started (endDate 2026-07-18,
// operator status still selling) was listed with an on-sale badge and an active
// booking CTA until the buyer reached the booking route.
describe('showtime-aware ended status', () => {
  it.each([
    ['selling', PAST, 'ended'],
    ['closing_soon', PAST, 'ended'],
    ['upcoming', PAST, 'ended'],
    // Nothing left to book even if the booking start is still ahead.
    ['selling', null, 'ended'],
  ] as const)('%s with a past booking start reads as ended once the last showtime started', (status, startsAt, expected) => {
    expect(resolvePublicCatalogStatus(status, startsAt, NOW, PAST)).toBe(expected);
  });

  it('reads as ended even with a future booking start when every showtime already started', () => {
    expect(resolvePublicCatalogStatus('selling', FUTURE, NOW, PAST)).toBe('ended');
  });

  it('closes at the last showtime start instant, like the C1 showtime sales cutoff', () => {
    const bookingStartsAt = new Date('2026-07-01T00:00:00.000Z');
    const lastShowtimeAt = new Date('2026-07-18T05:00:00.000Z');
    const justBefore = new Date(lastShowtimeAt.getTime() - 1);
    expect(resolvePublicCatalogStatus('selling', bookingStartsAt, justBefore, lastShowtimeAt)).toBe('selling');
    expect(resolvePublicCatalogStatus('selling', bookingStartsAt, lastShowtimeAt, lastShowtimeAt)).toBe('ended');
    expect(areAllShowtimesSalesClosed(lastShowtimeAt, justBefore)).toBe(false);
    expect(areAllShowtimesSalesClosed(lastShowtimeAt, lastShowtimeAt)).toBe(true);
  });

  it('keeps the existing rule while a showtime is still on sale or there is no showtime yet', () => {
    expect(resolvePublicCatalogStatus('selling', PAST, NOW, FUTURE)).toBe('selling');
    expect(resolvePublicCatalogStatus('selling', FUTURE, NOW, FUTURE)).toBe('upcoming');
    expect(resolvePublicCatalogStatus('selling', PAST, NOW, null)).toBe('selling');
    expect(resolvePublicCatalogStatus('upcoming', null, NOW, undefined)).toBe('upcoming');
    expect(areAllShowtimesSalesClosed(null, NOW)).toBe(false);
    expect(areAllShowtimesSalesClosed('not-a-date', NOW)).toBe(false);
  });

  it('accepts the last showtime as the string a raw SQL subquery may return', () => {
    expect(resolvePublicCatalogStatus('selling', PAST, NOW, '2026-07-18 05:00:00+00')).toBe('ended');
  });

  it('maps a selling card whose showtimes all started as ended', () => {
    const card = mapPublicCatalogCard({
      id: 'p1', title: 't', genre: 'artist_celebrity', posterUrl: null, status: 'selling',
      startDate: new Date('2026-07-18T00:00:00.000Z'), endDate: new Date('2026-07-18T00:00:00.000Z'),
      venueName: null, bookingStartsAt: new Date('2026-07-01T00:00:00.000Z'),
      lastShowtimeAt: new Date(Date.now() - 60_000),
    } as never);
    expect(card.status).toBe('ended');
    expect(card).not.toHaveProperty('lastShowtimeAt');

    const onSale = mapPublicCatalogCard({
      id: 'p2', title: 't', genre: 'artist_celebrity', posterUrl: null, status: 'selling',
      startDate: null, endDate: null, venueName: null, bookingStartsAt: null,
      lastShowtimeAt: new Date(Date.now() + 3_600_000),
    } as never);
    expect(onSale.status).toBe('selling');
  });

  it('reads the public detail as ended from its showtimes', () => {
    const detail = (showtimes: Date[]) => ({
      id: 'p1', status: 'selling' as const,
      bookingPolicy: { bookingStartsAt: PAST.toISOString() },
      showtimes: showtimes.map((dateTime, index) => ({ id: `s${index}`, dateTime: dateTime.toISOString() })),
    });

    expect(withPublicCatalogStatus(detail([PAST, new Date('2026-09-30T10:00:00.000Z')]), NOW).status)
      .toBe('ended');
    // One showtime still ahead keeps the performance on sale.
    expect(withPublicCatalogStatus(detail([PAST, FUTURE]), NOW).status).toBe('selling');
    expect(withPublicCatalogStatus(detail([]), NOW).status).toBe('selling');
    // Idempotent on an already ended detail.
    const ended = withPublicCatalogStatus(detail([PAST]), NOW);
    expect(withPublicCatalogStatus(ended, NOW)).toBe(ended);
  });
});

describe('publicCatalogStatusCondition', () => {
  const dialect = new PgDialect();
  const ON_SALE_EXISTS = /exists \(select 1 from "showtimes" where \("showtimes"\."performance_id" = "performances"\."id" and "showtimes"\."date_time" > \$\d+\)\)/;
  const ANY_SHOWTIME_EXISTS = /exists \(select 1 from "showtimes" where "showtimes"\."performance_id" = "performances"\."id"\)/;
  const render = (status: 'selling' | 'upcoming' | 'ended') => {
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

  it.each(['selling', 'upcoming'] as const)(
    'keeps %s rows only while a showtime is on sale or none is scheduled yet',
    (status) => {
      const { sql, params } = render(status);
      expect(sql).toMatch(ON_SALE_EXISTS);
      expect(sql).toMatch(new RegExp(`not ${ANY_SHOWTIME_EXISTS.source}`));
      expect(params).toContainEqual(NOW.toISOString());
    },
  );

  it('lists rows whose showtimes have all started as ended next to operator-ended rows', () => {
    const { sql, params } = render('ended');
    expect(sql).toMatch(/^\("performances"\."status" = \$\d+ or \(exists/);
    expect(sql).toMatch(ANY_SHOWTIME_EXISTS);
    expect(sql).toMatch(new RegExp(`not ${ON_SALE_EXISTS.source}`));
    expect(params).toEqual(expect.arrayContaining(['ended', NOW.toISOString()]));
  });

  it('hides operator-ended rows and rows whose showtimes have all started from not-ended lists', () => {
    const { sql, params } = dialect.sqlToQuery(publicCatalogNotEndedCondition(NOW));
    expect(sql).toMatch(/^\("performances"\."status" <> \$\d+ and \(exists/);
    expect(sql).toMatch(ON_SALE_EXISTS);
    expect(sql).toMatch(new RegExp(`not ${ANY_SHOWTIME_EXISTS.source}`));
    // No booking policy column: the not-joined count query of search can use it.
    expect(sql).not.toContain('booking_policies');
    expect(params).toEqual(['ended', NOW.toISOString()]);
  });
});

describe('withPublicCatalogStatus', () => {
  const detail = (status: 'upcoming' | 'selling' | 'closing_soon' | 'ended', startsAt: Date | null) => ({
    id: 'p1', status, bookingPolicy: { bookingStartsAt: startsAt?.toISOString() ?? null },
  });

  it('reads a selling detail with a future booking start as upcoming, like list cards', () => {
    const source = detail('selling', FUTURE);
    const mapped = withPublicCatalogStatus(source, NOW);
    expect(mapped.status).toBe('upcoming');
    expect(source.status).toBe('selling');
    expect(withPublicCatalogStatus({ id: 'p2', status: 'selling' as const, bookingPolicy: null }, NOW).status)
      .toBe('selling');
  });

  it.each([
    ['upcoming', FUTURE], ['upcoming', PAST], ['upcoming', null],
    ['selling', FUTURE], ['selling', PAST], ['selling', null],
    ['closing_soon', FUTURE], ['closing_soon', PAST], ['ended', FUTURE],
  ] as const)('matches the card status on top of the effective status (%s, %s)', (status, startsAt) => {
    const effective = resolveEffectivePerformanceStatus(status, startsAt, NOW);
    expect(withPublicCatalogStatus(detail(effective, startsAt), NOW).status)
      .toBe(resolvePublicCatalogStatus(status, startsAt, NOW));
  });
});
