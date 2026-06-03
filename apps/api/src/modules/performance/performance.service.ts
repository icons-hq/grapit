import { Inject, Injectable } from '@nestjs/common';
import { eq, desc, sql, and, inArray, ne } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  performances,
  venues,
  priceTiers,
  showtimes,
  castings,
  seatMaps,
  bookingPolicies,
  banners,
} from '../../database/schema/index.js';
import {
  DEFAULT_PERFORMANCE_BOOKING_POLICY,
  performanceDetailImagesSchema,
} from '@grabit/shared';
import type {
  PerformanceDetailImage,
  PerformanceBookingPolicy,
  PerformanceCardData,
  PerformanceListResponse,
  PerformanceWithDetails,
  Banner,
  PerformanceQuery,
  SeatMap,
} from '@grabit/shared';
import { CacheService } from './cache.service.js';
import {
  overlayReviewedCardTranslations,
  overlayReviewedDetailTranslations,
  resolvePerformanceTranslationLocale,
} from '../translation/performance-translation-overlay.js';

type SeatMapConfigForDetails = NonNullable<
  PerformanceWithDetails['seatMap']
>['seatConfig'];

type FindPerformanceByIdOptions = {
  includeHiddenCopy?: boolean;
};

const PERFORMANCE_TAXONOMY_CACHE_VERSION = 'event-category-v1-public-published';
const PERFORMANCE_DETAIL_CACHE_VERSION = 'public-published-v1';
const DEFAULT_FLOOR_KEY = '1F';
const DEFAULT_FLOOR_LABEL = '1층';

function normalizePerformanceDetailImages(
  value: unknown,
): PerformanceDetailImage[] {
  const parsed = performanceDetailImagesSchema.safeParse(value);

  if (!parsed.success) return [];

  return parsed.data
    .map((image, index) => ({
      imageUrl: image.imageUrl,
      altText: image.altText ?? null,
      sortOrder: image.sortOrder ?? index,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function mapSeatMapRowToDetailsSeatMap(
  row: {
    id: string;
    performanceId: string;
    floorKey?: string | null;
	    floorLabel?: string | null;
	    sortOrder?: number | null;
	    venueLayoutId?: string | null;
	    svgUrl: string;
    seatConfig: unknown;
    totalSeats: number;
  },
): SeatMap {
  return {
    id: row.id,
    performanceId: row.performanceId,
    floorKey: row.floorKey ?? DEFAULT_FLOOR_KEY,
	    floorLabel: row.floorLabel ?? DEFAULT_FLOOR_LABEL,
	    sortOrder: row.sortOrder ?? 0,
	    venueLayoutId: row.venueLayoutId ?? null,
	    svgUrl: row.svgUrl,
    seatConfig: row.seatConfig as SeatMapConfigForDetails,
    totalSeats: row.totalSeats,
  };
}

function cloneDefaultBookingPolicy(): PerformanceBookingPolicy {
  return {
    ...DEFAULT_PERFORMANCE_BOOKING_POLICY,
    allowedPaymentMethods: [
      ...DEFAULT_PERFORMANCE_BOOKING_POLICY.allowedPaymentMethods,
    ],
  };
}

function mapBookingPolicyRow(
  row:
    | {
        maxTicketsPerUser: number | null;
        allowedPaymentMethods: string[] | null;
        changePolicyEnabled: boolean | null;
        paymentWindowMinutes: number | null;
        seatHoldMinutes: number | null;
        cancelledSeatHoldMinMinutes: number | null;
        cancelledSeatHoldMaxMinutes: number | null;
        manualOpenEnabled: boolean | null;
      }
    | null
    | undefined,
): PerformanceBookingPolicy {
  if (!row) {
    return cloneDefaultBookingPolicy();
  }

  return {
    maxTicketsPerUser:
      row.maxTicketsPerUser ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.maxTicketsPerUser,
    allowedPaymentMethods:
      row.allowedPaymentMethods?.length
        ? (row.allowedPaymentMethods as PerformanceBookingPolicy['allowedPaymentMethods'])
        : [...DEFAULT_PERFORMANCE_BOOKING_POLICY.allowedPaymentMethods],
    changePolicyEnabled:
      row.changePolicyEnabled
      ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.changePolicyEnabled,
    paymentWindowMinutes:
      row.paymentWindowMinutes
      ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.paymentWindowMinutes,
    seatHoldMinutes:
      row.seatHoldMinutes ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.seatHoldMinutes,
    cancelledSeatHoldMinMinutes:
      row.cancelledSeatHoldMinMinutes
      ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.cancelledSeatHoldMinMinutes,
    cancelledSeatHoldMaxMinutes:
      row.cancelledSeatHoldMaxMinutes
      ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.cancelledSeatHoldMaxMinutes,
    manualOpenEnabled:
      row.manualOpenEnabled ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.manualOpenEnabled,
  };
}

function toOptionalIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function maskHiddenPerformanceCopy(
  performance: PerformanceWithDetails,
): PerformanceWithDetails {
  return {
    ...performance,
    description:
      performance.descriptionVisible === false ? null : performance.description,
    salesInfo:
      performance.salesInfoVisible === false ? null : performance.salesInfo,
  };
}

@Injectable()
export class PerformanceService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly cacheService: CacheService,
  ) {}

  async findByGenre(
    genre: string,
    query: PerformanceQuery,
  ): Promise<PerformanceListResponse> {
    const { page = 1, limit = 20, sort = 'latest', ended = false, sub } = query;
    const locale = resolvePerformanceTranslationLocale(query.locale);

    const cacheKey = `cache:performances:list:${PERFORMANCE_TAXONOMY_CACHE_VERSION}:${genre}:${locale}:${page}:${limit}:${sort}:${ended}:${sub ?? 'none'}`;
    const cached = await this.cacheService.get<PerformanceListResponse>(cacheKey);
    if (cached) return cached;

    const offset = (page - 1) * limit;

    const conditions = [
      eq(performances.publishState, 'published'),
      eq(
        performances.genre,
        genre as (typeof performances.genre.enumValues)[number],
      ),
    ];

    if (sub) {
      conditions.push(eq(performances.subcategory, sub));
    }

    if (!ended) {
      conditions.push(ne(performances.status, 'ended'));
    }

    const whereClause = and(...conditions);

    const orderByClause = sort === 'popular'
      ? desc(performances.viewCount)
      : desc(performances.createdAt);

    const [data, countResult] = await Promise.all([
      this.db
        .select({
          id: performances.id,
          title: performances.title,
          genre: performances.genre,
          posterUrl: performances.posterUrl,
          status: performances.status,
          startDate: performances.startDate,
          endDate: performances.endDate,
          venueName: venues.name,
        })
        .from(performances)
        .leftJoin(venues, eq(performances.venueId, venues.id))
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(performances)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;

    const cards: PerformanceCardData[] = data.map((row) => ({
      id: row.id,
      title: row.title,
      genre: row.genre,
      posterUrl: row.posterUrl,
      status: row.status,
      startDate: row.startDate?.toISOString() ?? '',
      endDate: row.endDate?.toISOString() ?? '',
      venueName: row.venueName ?? null,
    }));

    const result: PerformanceListResponse = {
      data: await overlayReviewedCardTranslations(this.db, cards, locale),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    await this.cacheService.set(cacheKey, result);
    return result;
  }

  async findById(
    id: string,
    locale?: string | null,
    options: FindPerformanceByIdOptions = {},
  ): Promise<PerformanceWithDetails | null> {
    const targetLocale = resolvePerformanceTranslationLocale(locale);
    const includeHiddenCopy = options.includeHiddenCopy === true;
    const visibilityCondition = includeHiddenCopy
      ? eq(performances.id, id)
      : and(eq(performances.id, id), eq(performances.publishState, 'published'));

    // Increment view count BEFORE the cache check so view counters keep
    // accruing on every request, not just on DB hits (per plan acceptance).
    // no-op if ID doesn't exist or is hidden from the current read path.
    const visibilityRows = await this.db
      .update(performances)
      .set({ viewCount: sql`${performances.viewCount} + 1` })
      .where(visibilityCondition)
      .returning({ id: performances.id });

    if (visibilityRows.length === 0) {
      return null;
    }

    const cacheKey = `cache:performances:detail:${id}:${targetLocale}:${PERFORMANCE_DETAIL_CACHE_VERSION}`;
    if (!includeHiddenCopy) {
      const cached = await this.cacheService.get<PerformanceWithDetails>(cacheKey);
      if (cached) return cached;
    }

    // Get performance with venue
    const [performanceRow] = await this.db
      .select()
      .from(performances)
      .leftJoin(venues, eq(performances.venueId, venues.id))
      .where(visibilityCondition);

    if (!performanceRow) {
      return null;
    }

    // Fetch related data in parallel
    const [priceTierRows, showtimeRows, castingRows, seatMapRows, bookingPolicyRows] =
      await Promise.all([
        this.db
          .select()
          .from(priceTiers)
          .where(eq(priceTiers.performanceId, id))
          .orderBy(priceTiers.sortOrder),
        this.db
          .select()
          .from(showtimes)
          .where(eq(showtimes.performanceId, id))
          .orderBy(showtimes.dateTime),
        this.db
          .select()
          .from(castings)
          .where(eq(castings.performanceId, id))
          .orderBy(castings.sortOrder),
        this.db
          .select()
          .from(seatMaps)
          .where(eq(seatMaps.performanceId, id))
          .orderBy(seatMaps.sortOrder),
        this.db
          .select()
          .from(bookingPolicies)
          .where(eq(bookingPolicies.performanceId, id)),
      ]);

    const perf = performanceRow.performances;
    const venue = performanceRow.venues;
    const detailSeatMaps = seatMapRows.map(mapSeatMapRowToDetailsSeatMap);
    const bookingPolicy = mapBookingPolicyRow(bookingPolicyRows[0] ?? null);

    const result: PerformanceWithDetails =
      await overlayReviewedDetailTranslations(
        this.db,
        {
          id: perf.id,
          title: perf.title,
          genre: perf.genre,
          subcategory: perf.subcategory,
          venueId: perf.venueId,
          posterUrl: perf.posterUrl,
          description: perf.description,
          descriptionVisible: perf.descriptionVisible,
          detailImages: normalizePerformanceDetailImages(perf.detailImages),
          startDate: perf.startDate?.toISOString() ?? '',
          endDate: perf.endDate?.toISOString() ?? '',
          runtime: perf.runtime,
          ageRating: perf.ageRating,
          status: perf.status,
          salesInfo: perf.salesInfo,
          salesInfoVisible: perf.salesInfoVisible,
          viewCount: perf.viewCount,
          createdAt: perf.createdAt?.toISOString() ?? '',
          updatedAt: perf.updatedAt?.toISOString() ?? '',
          venue: venue
            ? { id: venue.id, name: venue.name, address: venue.address }
            : null,
          priceTiers: priceTierRows.map((pt) => ({
            id: pt.id,
            performanceId: pt.performanceId,
            tierName: pt.tierName,
            price: pt.price,
            sortOrder: pt.sortOrder,
          })),
          showtimes: showtimeRows.map((st) => ({
            id: st.id,
            performanceId: st.performanceId,
            dateTime: st.dateTime?.toISOString() ?? '',
          })),
          castings: castingRows.map((c) => ({
            id: c.id,
            performanceId: c.performanceId,
            actorName: c.actorName,
            roleName: c.roleName,
            photoUrl: c.photoUrl,
            sortOrder: c.sortOrder,
          })),
          seatMaps: detailSeatMaps,
          bookingPolicy,
          seatMap: detailSeatMaps[0] ?? null,
        },
        targetLocale,
      );

    const response = includeHiddenCopy
      ? result
      : maskHiddenPerformanceCopy(result);

    if (!includeHiddenCopy) {
      await this.cacheService.set(cacheKey, response);
    }
    return response;
  }

  async getHomeBanners(): Promise<Banner[]> {
    const cacheKey = 'cache:home:banners';
    const cached = await this.cacheService.get<Banner[]>(cacheKey);
    if (cached) return cached;

    const rows = await this.db
      .select()
      .from(banners)
      .where(eq(banners.isActive, true))
      .orderBy(banners.sortOrder);

    const result: Banner[] = rows.map((b) => ({
      id: b.id,
      imageUrl: b.imageUrl,
      linkUrl: b.linkUrl,
      placement: b.placement,
      deviceTarget: b.deviceTarget,
      status: b.status,
      startsAt: toOptionalIsoString(b.startsAt),
      endsAt: toOptionalIsoString(b.endsAt),
      sortOrder: b.sortOrder,
      isActive: b.isActive,
    }));

    await this.cacheService.set(cacheKey, result);
    return result;
  }

  async getHotPerformances(
    locale?: string | null,
  ): Promise<PerformanceCardData[]> {
    const targetLocale = resolvePerformanceTranslationLocale(locale);
    const cacheKey = `cache:home:hot:${PERFORMANCE_TAXONOMY_CACHE_VERSION}:${targetLocale}`;
    const cached = await this.cacheService.get<PerformanceCardData[]>(cacheKey);
    if (cached) return cached;

    const rows = await this.db
      .select({
        id: performances.id,
        title: performances.title,
        genre: performances.genre,
        posterUrl: performances.posterUrl,
        status: performances.status,
        startDate: performances.startDate,
        endDate: performances.endDate,
        venueName: venues.name,
      })
      .from(performances)
      .leftJoin(venues, eq(performances.venueId, venues.id))
      .where(
        and(
          eq(performances.publishState, 'published'),
          inArray(performances.status, ['selling', 'closing_soon']),
        ),
      )
      .orderBy(desc(performances.viewCount))
      .limit(4);

    const cards: PerformanceCardData[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      genre: row.genre,
      posterUrl: row.posterUrl,
      status: row.status,
      startDate: row.startDate?.toISOString() ?? '',
      endDate: row.endDate?.toISOString() ?? '',
      venueName: row.venueName ?? null,
    }));
    const result = await overlayReviewedCardTranslations(
      this.db,
      cards,
      targetLocale,
    );

    await this.cacheService.set(cacheKey, result);
    return result;
  }

  async getNewPerformances(
    locale?: string | null,
  ): Promise<PerformanceCardData[]> {
    const targetLocale = resolvePerformanceTranslationLocale(locale);
    const cacheKey = `cache:home:new:${PERFORMANCE_TAXONOMY_CACHE_VERSION}:${targetLocale}`;
    const cached = await this.cacheService.get<PerformanceCardData[]>(cacheKey);
    if (cached) return cached;

    const rows = await this.db
      .select({
        id: performances.id,
        title: performances.title,
        genre: performances.genre,
        posterUrl: performances.posterUrl,
        status: performances.status,
        startDate: performances.startDate,
        endDate: performances.endDate,
        venueName: venues.name,
      })
      .from(performances)
      .leftJoin(venues, eq(performances.venueId, venues.id))
      .where(
        and(
          eq(performances.publishState, 'published'),
          inArray(performances.status, ['selling', 'upcoming', 'closing_soon']),
        ),
      )
      .orderBy(desc(performances.createdAt))
      .limit(4);

    const cards: PerformanceCardData[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      genre: row.genre,
      posterUrl: row.posterUrl,
      status: row.status,
      startDate: row.startDate?.toISOString() ?? '',
      endDate: row.endDate?.toISOString() ?? '',
      venueName: row.venueName ?? null,
    }));
    const result = await overlayReviewedCardTranslations(
      this.db,
      cards,
      targetLocale,
    );

    await this.cacheService.set(cacheKey, result);
    return result;
  }
}
