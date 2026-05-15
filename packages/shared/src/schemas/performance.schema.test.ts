import { describe, expect, it } from 'vitest';
import {
  createPerformanceSchema,
  performanceQuerySchema,
  searchQuerySchema,
  updatePerformanceSchema,
} from './performance.schema';

describe('performance query schema', () => {
  it('parses ended query strings without JavaScript truthiness coercion', () => {
    expect(performanceQuerySchema.parse({ ended: 'false' }).ended).toBe(false);
    expect(performanceQuerySchema.parse({ ended: 'true' }).ended).toBe(true);
    expect(performanceQuerySchema.parse({}).ended).toBe(false);
    expect(performanceQuerySchema.parse({ ended: '' }).ended).toBe(false);
    expect(() => performanceQuerySchema.parse({ ended: 'yes' })).toThrow();
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
    expect(parsed.detailImages?.[0]?.imageUrl).toBe(
      'https://cdn.example.com/detail/location.jpg',
    );
  });
});
