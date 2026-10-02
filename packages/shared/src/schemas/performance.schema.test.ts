import { describe, expect, it } from 'vitest';
import {
  PERFORMANCE_QUERY_MAX_PAGE,
  PERFORMANCE_QUERY_SUB_MAX_LENGTH,
  createPerformanceSchema,
  performanceBookingPolicySchema,
  performanceQuerySchema,
  searchQuerySchema,
  seatMapConfigSchema,
  updatePerformanceSchema,
} from './performance.schema';
import { resolvePerformanceSaleOpening } from './performance-preparation.schema';

describe('performance query schema', () => {
  it('parses ended query strings without JavaScript truthiness coercion', () => {
    expect(performanceQuerySchema.parse({ ended: 'false' }).ended).toBe(false);
    expect(performanceQuerySchema.parse({ ended: 'true' }).ended).toBe(true);
    expect(performanceQuerySchema.parse({}).ended).toBe(false);
    expect(performanceQuerySchema.parse({ ended: '' }).ended).toBe(false);
    expect(() => performanceQuerySchema.parse({ ended: 'yes' })).toThrow();
  });

  it('bounds the unthrottled catalog inputs that reach the list cache key', () => {
    expect(performanceQuerySchema.parse({ sub: '팬미팅' }).sub).toBe('팬미팅');
    expect(performanceQuerySchema.parse({ sub: '' }).sub).toBeUndefined();
    expect(performanceQuerySchema.parse({ sub: 'x'.repeat(PERFORMANCE_QUERY_SUB_MAX_LENGTH) }).sub)
      .toHaveLength(PERFORMANCE_QUERY_SUB_MAX_LENGTH);
    expect(() => performanceQuerySchema.parse({
      sub: 'x'.repeat(PERFORMANCE_QUERY_SUB_MAX_LENGTH + 1),
    })).toThrow();
    expect(() => performanceQuerySchema.parse({ sub: 'x'.repeat(8_000) })).toThrow();

    expect(performanceQuerySchema.parse({ page: String(PERFORMANCE_QUERY_MAX_PAGE) }).page)
      .toBe(PERFORMANCE_QUERY_MAX_PAGE);
    expect(() => performanceQuerySchema.parse({ page: String(PERFORMANCE_QUERY_MAX_PAGE + 1) }))
      .toThrow();
    expect(() => performanceQuerySchema.parse({ page: '987654321' })).toThrow();
  });
});

describe('search query schema', () => {
  it('parses ended query strings without JavaScript truthiness coercion', () => {
    expect(searchQuerySchema.parse({ q: 'fanmeet', ended: 'false' }).ended)
      .toBe(false);
    expect(searchQuerySchema.parse({ q: 'fanmeet', ended: 'true' }).ended)
      .toBe(true);
    expect(searchQuerySchema.parse({ q: 'fanmeet' }).ended).toBe(false);
    expect(searchQuerySchema.parse({ q: 'fanmeet', ended: '' }).ended).toBe(false);
    expect(() => searchQuerySchema.parse({ q: 'fanmeet', ended: 'yes' })).toThrow();
  });
});

describe('performance floor and booking policy schema', () => {
  it('defaults performance copy visibility to public on create payloads', () => {
    const parsed = createPerformanceSchema.parse({
      title: '2026 걸룰스 팬미팅',
      genre: 'artist_celebrity',
      venueName: '동해문화예술관 대극장',
      description: '운영자가 입력한 상세정보',
      salesInfo: '운영자가 입력한 판매정보',
      startDate: '2026-07-18T14:00:00.000Z',
      endDate: '2026-07-18T16:00:00.000Z',
      ageRating: '전체 관람가',
      priceTiers: [
        { tierName: 'VIP', price: 88000, sortOrder: 0 },
      ],
    });

    expect(parsed.descriptionVisible).toBe(true);
    expect(parsed.salesInfoVisible).toBe(true);
  });

  it('accepts explicit hidden copy flags on partial update payloads', () => {
    const parsed = updatePerformanceSchema.parse({
      descriptionVisible: false,
      salesInfoVisible: false,
    });

    expect(parsed).toEqual({
      descriptionVisible: false,
      salesInfoVisible: false,
    });
  });

  it('defaults new performances to upcoming and accepts explicit open status', () => {
    const basePayload = {
      title: '2026 걸룰스 팬미팅',
      genre: 'artist_celebrity',
      venueName: '동해문화예술관 대극장',
      startDate: '2026-07-18T14:00:00.000Z',
      endDate: '2026-07-18T16:00:00.000Z',
      ageRating: '전체 관람가',
      priceTiers: [
        { tierName: 'VIP', price: 88000, sortOrder: 0 },
      ],
    };

    expect(createPerformanceSchema.parse(basePayload).status).toBe('upcoming');
    expect(
      createPerformanceSchema.parse({
        ...basePayload,
        status: 'selling',
      }).status,
    ).toBe('selling');
  });

  it('keeps floor-aware seatMaps and bookingPolicy in create payloads', () => {
    const parsed = createPerformanceSchema.parse({
      title: '2026 걸룰스 팬미팅',
      genre: 'artist_celebrity',
      venueName: '동해문화예술관 대극장',
      venueAddress: '강원도 동해시',
      posterUrl: 'https://cdn.example.com/poster.jpg',
      description: '팬미팅 상세 정보',
      startDate: '2026-07-18T14:00:00.000Z',
      endDate: '2026-07-18T16:00:00.000Z',
      runtime: '120분',
      ageRating: '전체 관람가',
      salesInfo: '오픈 예정',
      detailImages: [
        {
          imageUrl: 'https://cdn.example.com/detail/seat-guide.jpg',
          altText: '좌석 안내',
          sortOrder: 0,
        },
        {
          imageUrl: 'https://cdn.example.com/detail/benefits.jpg',
          sortOrder: 1,
        },
      ],
      priceTiers: [
        { tierName: 'VIP', price: 88000, sortOrder: 0 },
      ],
      showtimes: [],
      castings: [],
      seatMaps: [
        {
          floorKey: '1F',
          floorLabel: '1층',
          sortOrder: 0,
          svgUrl: 'https://cdn.example.com/seatmaps/1f.svg',
          seatConfig: {
            tiers: [
              { tierName: 'VIP', color: '#FFD700', seatIds: ['A-1'] },
            ],
          },
          totalSeats: 1,
        },
        {
          floorKey: '2F',
          floorLabel: '2층',
          sortOrder: 1,
          svgUrl: 'https://cdn.example.com/seatmaps/2f.svg',
          seatConfig: {
            tiers: [
              { tierName: 'R', color: '#4169E1', seatIds: ['B-1'] },
            ],
          },
          totalSeats: 1,
        },
      ],
      bookingPolicy: {
        maxTicketsPerUser: 1,
        allowedPaymentMethods: ['CARD', 'FOREIGN_EASY_PAY'],
        changePolicyEnabled: false,
        paymentWindowMinutes: 7,
        seatHoldMinutes: 10,
        cancelledSeatHoldMinMinutes: 1,
        cancelledSeatHoldMaxMinutes: 10,
        manualOpenEnabled: true,
      },
    });

    expect(parsed.seatMaps).toHaveLength(2);
    expect(parsed.detailImages).toEqual([
      {
        imageUrl: 'https://cdn.example.com/detail/seat-guide.jpg',
        altText: '좌석 안내',
        sortOrder: 0,
      },
      {
        imageUrl: 'https://cdn.example.com/detail/benefits.jpg',
        sortOrder: 1,
      },
    ]);
    expect(parsed.seatMaps[0]?.floorKey).toBe('1F');
    expect(parsed.bookingPolicy.allowedPaymentMethods).toEqual([
      'CARD',
      'FOREIGN_EASY_PAY',
    ]);
  });

  it('accepts partial floor/policy updates for admin edit flows', () => {
    const parsed = updatePerformanceSchema.parse({
      showtimes: [
        {
          showtimeId: '11111111-1111-4111-8111-111111111111',
          dateTime: '2026-07-18T14:00:00',
        },
      ],
      seatMaps: [
        {
          floorKey: '1F',
          floorLabel: '1층',
          sortOrder: 0,
          svgUrl: 'https://cdn.example.com/seatmaps/1f.svg',
          seatConfig: {
            tiers: [
              { tierName: 'VIP', color: '#FFD700', seatIds: ['A-1'] },
            ],
          },
          totalSeats: 1,
        },
      ],
      bookingPolicy: {
        maxTicketsPerUser: 2,
        allowedPaymentMethods: ['CARD'],
        changePolicyEnabled: true,
        paymentWindowMinutes: 9,
        seatHoldMinutes: 10,
        cancelledSeatHoldMinMinutes: 2,
        cancelledSeatHoldMaxMinutes: 8,
        manualOpenEnabled: false,
        bookingStartsAt: '2026-06-04T10:00:00.000Z',
      },
      detailImages: [
        {
          imageUrl: 'https://cdn.example.com/detail/location.jpg',
          altText: null,
          sortOrder: 0,
        },
      ],
    });

    expect(parsed.showtimes?.[0]?.showtimeId).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(parsed.seatMaps?.[0]?.floorLabel).toBe('1층');
    expect(parsed.bookingPolicy?.maxTicketsPerUser).toBe(2);
    expect(parsed.bookingPolicy?.manualOpenEnabled).toBe(false);
    expect(parsed.bookingPolicy?.bookingStartsAt).toBe('2026-06-04T10:00:00.000Z');
    expect(parsed.detailImages?.[0]?.imageUrl).toBe(
      'https://cdn.example.com/detail/location.jpg',
    );
  });
});

describe('performance price and sale-time input guards', () => {
  const basePayload = {
    title: '2026 걸룰스 팬미팅',
    genre: 'artist_celebrity',
    venueName: '동해문화예술관 대극장',
    startDate: '2026-07-18T14:00:00.000Z',
    endDate: '2026-07-18T16:00:00.000Z',
    ageRating: '전체 관람가',
    priceTiers: [{ tierName: 'VIP', price: 88000, sortOrder: 0 }],
  } as const;
  const policy = {
    maxTicketsPerUser: 1,
    allowedPaymentMethods: ['CARD'],
    changePolicyEnabled: false,
    paymentWindowMinutes: 7,
    seatHoldMinutes: 10,
    cancelledSeatHoldMinMinutes: 1,
    cancelledSeatHoldMaxMinutes: 10,
    manualOpenEnabled: true,
  } as const;

  it('trims tier names on both the price tier and seat assignment sides', () => {
    const parsed = createPerformanceSchema.parse({
      ...basePayload,
      priceTiers: [{ tierName: ' VIP ', price: 88000, sortOrder: 0 }],
      seatMaps: [{
        floorKey: '1F', floorLabel: '1층', sortOrder: 0, svgUrl: 'https://cdn.example.com/1f.svg', totalSeats: 1,
        seatConfig: { tiers: [{ tierName: 'VIP ', color: '#FFD700', seatIds: ['A-1'] }] },
      }],
    });

    expect(parsed.priceTiers[0]?.tierName).toBe('VIP');
    expect(parsed.seatMaps[0]?.seatConfig?.tiers[0]?.tierName).toBe('VIP');
    expect(seatMapConfigSchema.parse({ tiers: [{ tierName: '  R', color: '#000', seatIds: [] }] }).tiers[0]?.tierName).toBe('R');
    expect(createPerformanceSchema.safeParse({
      ...basePayload, priceTiers: [{ tierName: '   ', price: 88000, sortOrder: 0 }],
    }).success).toBe(false);
  });

  it('rejects a zero-priced tier that would sell a paid seat for the service fee only', () => {
    const result = createPerformanceSchema.safeParse({
      ...basePayload,
      priceTiers: [{ tierName: 'VIP', price: 88000, sortOrder: 0 }, { tierName: 'R', price: 0, sortOrder: 1 }],
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('가격은 0보다 커야 합니다');
  });

  it.each([
    '0002-10-01T11:00:00.000Z',
    '0202-10-01T11:00:00.000Z',
    '2101-01-01T00:00:00.000Z',
  ])('rejects an implausible KST sale start year %s', (bookingStartsAt) => {
    const result = performanceBookingPolicySchema.safeParse({ ...policy, bookingStartsAt });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('bookingStartsAt');
  });

  it('accepts a sale start at the KST year boundary and an omitted start', () => {
    // 2000-01-01 00:00 KST is 1999-12-31 15:00 UTC.
    expect(performanceBookingPolicySchema.safeParse({ ...policy, bookingStartsAt: '1999-12-31T15:00:00.000Z' }).success).toBe(true);
    expect(performanceBookingPolicySchema.safeParse({ ...policy, bookingStartsAt: '1999-12-31T14:59:59.000Z' }).success).toBe(false);
    expect(performanceBookingPolicySchema.parse({ ...policy }).bookingStartsAt).toBeNull();
  });
});

describe('resolvePerformanceSaleOpening', () => {
  const now = new Date('2026-10-01T00:00:00.000Z');

  it('mirrors the booking gate for each sale status and start time combination', () => {
    expect(resolvePerformanceSaleOpening({ status: 'upcoming', bookingStartsAt: null }, now))
      .toEqual({ mode: 'manual', at: null, startElapsed: false });
    expect(resolvePerformanceSaleOpening({ status: 'selling', bookingStartsAt: null }, now))
      .toEqual({ mode: 'immediate', at: null, startElapsed: false });
    expect(resolvePerformanceSaleOpening({ status: 'closing_soon', bookingStartsAt: undefined }, now).mode).toBe('immediate');
    expect(resolvePerformanceSaleOpening({ status: 'upcoming', bookingStartsAt: '2026-10-08T11:00:00.000Z' }, now))
      .toEqual({ mode: 'scheduled', at: '2026-10-08T11:00:00.000Z', startElapsed: false });
    expect(resolvePerformanceSaleOpening({ status: 'selling', bookingStartsAt: new Date('2026-10-08T11:00:00.000Z') }, now).mode).toBe('scheduled');
    expect(resolvePerformanceSaleOpening({ status: 'upcoming', bookingStartsAt: '2025-10-01T11:00:00.000Z' }, now))
      .toEqual({ mode: 'immediate', at: '2025-10-01T11:00:00.000Z', startElapsed: true });
    expect(resolvePerformanceSaleOpening({ status: 'ended', bookingStartsAt: null }, now).mode).toBe('ended');
  });
});
