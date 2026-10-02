import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq, desc, sql, and, inArray, ne, or, gt, isNull } from 'drizzle-orm';
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
import { publicCatalogCardSelection, mapPublicCatalogCard, publicCatalogStatusCondition, resolveEffectivePerformanceStatus } from './catalog-card.js';
import { CacheService, type CacheLoadResult } from './cache.service.js';
import { CATALOG_CACHE_GENERATION_SCOPES } from './catalog-cache-keys.js';
import { PerformanceViewCounter } from './performance-view-counter.service.js';
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

const PERFORMANCE_TAXONOMY_CACHE_VERSION = 'event-catalog-v4-opening-boundary';
const PERFORMANCE_DETAIL_CACHE_VERSION = 'public-published-v3-venue-access';
const HOME_BANNER_CACHE_VERSION = 'home-visible-v1';
const DEFAULT_CACHE_TTL_SECONDS = 300;
/**
 * Empty list pages (unknown subcategory, page past the end) are cached only
 * briefly so arbitrary query combinations cannot pin keys in Valkey.
 */
export const EMPTY_LIST_CACHE_TTL_SECONDS = 10;
const UNAVAILABLE_CACHE_GENERATION = 'unavailable';
const HOME_BANNER_PLACEMENTS = ['home_hero', 'home_secondary'] as const;
const HOME_BANNER_STATUSES = ['active', 'scheduled'] as const;
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
        bookingStartsAt?: Date | string | null;
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
    bookingStartsAt: toOptionalIsoString(row.bookingStartsAt),
  };
}

function cacheTtlUntilNextBookingStart(
  startsAtValues: Array<Date | string | null | undefined>,
  now: Date = new Date(),
): number {
  const nowMs = now.getTime();
  const nextStartsInSeconds = startsAtValues
    .map((value) => {
      if (!value) return null;
      const startsAtMs = value instanceof Date ? value.getTime() : Date.parse(value);
      if (!Number.isFinite(startsAtMs) || startsAtMs <= nowMs) return null;
      return Math.ceil((startsAtMs - nowMs) / 1000);
    })
    .filter((value): value is number => typeof value === 'number');

  if (nextStartsInSeconds.length === 0) {
    return DEFAULT_CACHE_TTL_SECONDS;
  }

  return Math.max(1, Math.min(DEFAULT_CACHE_TTL_SECONDS, ...nextStartsInSeconds));
}

/** Fixed-length, delimiter-free cache key segment for free-form input. */
function hashCacheKeySegment(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url').slice(0, 22);
}

function cacheGenerationSegment(generation: string | null): string {
  return `g${generation ?? UNAVAILABLE_CACHE_GENERATION}`;
}

type HomeBannerRow = typeof banners.$inferSelect;

/**
 * A home banner is public only when the operator published it for a home
 * placement and its schedule window contains `now`. `scheduled` banners go
 * live at their startsAt; without a startsAt they stay hidden.
 */
export function isHomeBannerLive(
  banner: Pick<HomeBannerRow, 'isActive' | 'status' | 'placement' | 'startsAt' | 'endsAt'>,
  now: Date = new Date(),
): boolean {
  if (!banner.isActive) return false;
  if (!(HOME_BANNER_PLACEMENTS as readonly string[]).includes(banner.placement)) return false;
  if (!(HOME_BANNER_STATUSES as readonly string[]).includes(banner.status)) return false;
  if (banner.status === 'scheduled' && !banner.startsAt) return false;
  const nowMs = now.getTime();
  if (banner.startsAt && banner.startsAt.getTime() > nowMs) return false;
  if (banner.endsAt && banner.endsAt.getTime() <= nowMs) return false;
  return true;
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
    @Inject(CacheService) private readonly cacheService: CacheService,
    @Inject(PerformanceViewCounter)
    private readonly viewCounter: PerformanceViewCounter,
  ) {}

  async findByGenre(
    genre: string,
    query: PerformanceQuery,
  ): Promise<PerformanceListResponse> {
    const { page = 1, limit = 20, sort = 'latest', ended = false, sub, status } = query;
    const locale = resolvePerformanceTranslationLocale(query.locale);
    const generation = await this.cacheService.getGeneration(
      CATALOG_CACHE_GENERATION_SCOPES.list,
    );
    // `sub` is free-form text (bounded by the shared query schema); hash it so
    // the key stays fixed-length and delimiter-free.
    const subSegment = sub ? `sub-${hashCacheKeySegment(sub)}` : 'none';
    const cacheKey = `cache:performances:list:${PERFORMANCE_TAXONOMY_CACHE_VERSION}:${cacheGenerationSegment(generation)}:${genre}:${locale}:${page}:${limit}:${sort}:${ended}:${subSegment}:${status ?? 'all'}`;

    return this.cacheService.getOrLoad(
      cacheKey,
      () => this.loadGenreList(genre, { page, limit, sort, ended, sub, status }, locale),
      { readThrough: generation !== null },
    );
  }

  private async loadGenreList(
    genre: string,
    query: Required<Pick<PerformanceQuery, 'page' | 'limit' | 'sort' | 'ended'>>
      & Pick<PerformanceQuery, 'sub' | 'status'>,
    locale: string,
  ): Promise<CacheLoadResult<PerformanceListResponse>> {
    const { page, limit, sort, ended, sub, status } = query;
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

    const queryTime = new Date();
    const statusCondition = publicCatalogStatusCondition(status, queryTime);
    if (statusCondition) conditions.push(statusCondition);
    else if (!ended) conditions.push(ne(performances.status, 'ended'));

    const whereClause = and(...conditions);

    const orderByClause = sort === 'popular'
      ? desc(performances.viewCount)
      : desc(performances.createdAt);

    const [data, countResult] = await Promise.all([
      this.db
        .select(publicCatalogCardSelection)
        .from(performances)
        .leftJoin(venues, eq(performances.venueId, venues.id))
        .leftJoin(bookingPolicies, eq(bookingPolicies.performanceId, performances.id))
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset),
      this.db
        .select({
          count: sql<number>`count(*)::int`,
          // This scalar query sees future openings excluded by status or page.
          nextBookingStartsAt: sql<Date | string | null>`(
            select min(next_policy.booking_starts_at)
            from performances next_performance
            join booking_policies next_policy on next_policy.performance_id = next_performance.id
            where next_performance.publish_state = 'published'
              and next_performance.genre = ${genre}
              and next_performance.status <> 'ended'
              and next_policy.booking_starts_at > ${queryTime}
              ${sub ? sql`and next_performance.subcategory = ${sub}` : sql``}
          )`,
        })
        .from(performances)
        .leftJoin(bookingPolicies, eq(bookingPolicies.performanceId, performances.id))
        .where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;

    const cards: PerformanceCardData[] = data.map(mapPublicCatalogCard);

    const result: PerformanceListResponse = {
      data: await overlayReviewedCardTranslations(this.db, cards, locale),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    const nextBookingStartsAt = countResult[0]?.nextBookingStartsAt;
    const cacheTtl = nextBookingStartsAt && new Date(nextBookingStartsAt).getTime() <= Date.now()
      ? 1
      : cacheTtlUntilNextBookingStart([nextBookingStartsAt, ...data.map((row) => row.bookingStartsAt)]);
    return {
      value: result,
      ttlSeconds: data.length === 0
        ? Math.min(EMPTY_LIST_CACHE_TTL_SECONDS, cacheTtl)
        : cacheTtl,
    };
  }

  async findById(
    id: string,
    locale?: string | null,
    options: FindPerformanceByIdOptions = {},
  ): Promise<PerformanceWithDetails | null> {
    const targetLocale = resolvePerformanceTranslationLocale(locale);

    if (options.includeHiddenCopy === true) {
      // Guarded admin reads: never cached, never counted as public views, and
      // they expose the stored status so an edit form does not persist the
      // derived 'selling' status back over 'upcoming'.
      const loaded = await this.loadPerformanceDetail(id, targetLocale, true);
      return loaded?.detail ?? null;
    }

    // The generation is read before the DB so a load that raced an admin
    // commit can only populate the superseded key (catalog freshness bumps
    // the generation after every commit, including visibility changes).
    const generation = await this.cacheService.getGeneration(
      CATALOG_CACHE_GENERATION_SCOPES.detail(id),
    );
    const cacheKey = `cache:performances:detail:${id}:${targetLocale}:${PERFORMANCE_DETAIL_CACHE_VERSION}:${cacheGenerationSegment(generation)}`;
    const detail = await this.cacheService.getOrLoad<PerformanceWithDetails | null>(
      cacheKey,
      async () => {
        const loaded = await this.loadPerformanceDetail(id, targetLocale, false);
        if (!loaded) return { value: null, ttlSeconds: null };
        return {
          value: maskHiddenPerformanceCopy(loaded.detail),
          ttlSeconds: cacheTtlUntilNextBookingStart([loaded.bookingStartsAt]),
        };
      },
      { readThrough: generation !== null },
    );

    if (detail) {
      // Write-behind: no DB write or row lock on the public read path.
      this.viewCounter.record(id);
    }
    return detail;
  }

  private async loadPerformanceDetail(
    id: string,
    targetLocale: string,
    includeHiddenCopy: boolean,
  ): Promise<{ detail: PerformanceWithDetails; bookingStartsAt: string | null } | null> {
    const visibilityCondition = includeHiddenCopy
      ? eq(performances.id, id)
      : and(eq(performances.id, id), eq(performances.publishState, 'published'));

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
          status: includeHiddenCopy
            ? perf.status
            : resolveEffectivePerformanceStatus(
              perf.status,
              bookingPolicy.bookingStartsAt,
            ),
          salesInfo: perf.salesInfo,
          salesInfoVisible: perf.salesInfoVisible,
          viewCount: perf.viewCount,
          createdAt: perf.createdAt?.toISOString() ?? '',
          updatedAt: perf.updatedAt?.toISOString() ?? '',
          venue: venue
            ? { id: venue.id, name: venue.name, address: venue.address, accessNotes: venue.accessNotes, transportSummary: venue.transportSummary }
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

    return { detail: result, bookingStartsAt: bookingPolicy.bookingStartsAt ?? null };
  }

  async getHomeBanners(): Promise<Banner[]> {
    const generation = await this.cacheService.getGeneration(
      CATALOG_CACHE_GENERATION_SCOPES.banner,
    );
    const cacheKey = `cache:home:banners:${HOME_BANNER_CACHE_VERSION}:${cacheGenerationSegment(generation)}`;
    return this.cacheService.getOrLoad(
      cacheKey,
      () => this.loadHomeBanners(),
      { readThrough: generation !== null },
    );
  }

  private async loadHomeBanners(
    now: Date = new Date(),
  ): Promise<CacheLoadResult<Banner[]>> {
    // Candidates include not-yet-started banners so the cache TTL can stop at
    // their startsAt; isHomeBannerLive decides what is public right now.
    const rows = await this.db
      .select()
      .from(banners)
      .where(
        and(
          eq(banners.isActive, true),
          inArray(banners.status, [...HOME_BANNER_STATUSES]),
          inArray(banners.placement, [...HOME_BANNER_PLACEMENTS]),
          or(isNull(banners.endsAt), gt(banners.endsAt, now)),
        ),
      )
      .orderBy(banners.sortOrder);

    const result: Banner[] = rows
      .filter((b) => isHomeBannerLive(b, now))
      .map((b) => ({
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

    return {
      value: result,
      // Expire at the next schedule boundary (a banner starting or ending).
      ttlSeconds: cacheTtlUntilNextBookingStart(
        rows.flatMap((b) => [b.startsAt, b.endsAt]),
        now,
      ),
    };
  }

  async getHotPerformances(
    locale?: string | null,
  ): Promise<PerformanceCardData[]> {
    const targetLocale = resolvePerformanceTranslationLocale(locale);
    const generation = await this.cacheService.getGeneration(
      CATALOG_CACHE_GENERATION_SCOPES.home,
    );
    const cacheKey = `cache:home:hot:${PERFORMANCE_TAXONOMY_CACHE_VERSION}:${cacheGenerationSegment(generation)}:${targetLocale}`;
    return this.cacheService.getOrLoad(
      cacheKey,
      () => this.loadHotPerformances(targetLocale),
      { readThrough: generation !== null },
    );
  }

  private async loadHotPerformances(
    targetLocale: string,
  ): Promise<CacheLoadResult<PerformanceCardData[]>> {
    const queryTime = new Date();
    const [rows, nextOpeningRows] = await Promise.all([
      this.db
        .select(publicCatalogCardSelection)
        .from(performances)
        .leftJoin(venues, eq(performances.venueId, venues.id))
        .leftJoin(bookingPolicies, eq(bookingPolicies.performanceId, performances.id))
        .where(
          and(
            eq(performances.publishState, 'published'),
            publicCatalogStatusCondition('selling', queryTime),
          ),
        )
        .orderBy(desc(performances.viewCount))
        .limit(4),
      // Only opened rows are listed, so the next opening that may enter the hot
      // list has to bound the cache TTL separately.
      this.db
        .select({
          nextBookingStartsAt: sql<Date | string | null>`min(${bookingPolicies.bookingStartsAt})`,
        })
        .from(performances)
        .innerJoin(bookingPolicies, eq(bookingPolicies.performanceId, performances.id))
        .where(
          and(
            eq(performances.publishState, 'published'),
            ne(performances.status, 'ended'),
            gt(bookingPolicies.bookingStartsAt, queryTime),
          ),
        ),
    ]);

    const cards: PerformanceCardData[] = rows.map(mapPublicCatalogCard);
    const result = await overlayReviewedCardTranslations(
      this.db,
      cards,
      targetLocale,
    );

    const nextBookingStartsAt = nextOpeningRows[0]?.nextBookingStartsAt;
    return {
      value: result,
      ttlSeconds: nextBookingStartsAt && new Date(nextBookingStartsAt).getTime() <= Date.now()
        ? 1
        : cacheTtlUntilNextBookingStart([nextBookingStartsAt, ...rows.map((row) => row.bookingStartsAt)]),
    };
  }

  async getNewPerformances(
    locale?: string | null,
  ): Promise<PerformanceCardData[]> {
    const targetLocale = resolvePerformanceTranslationLocale(locale);
    const generation = await this.cacheService.getGeneration(
      CATALOG_CACHE_GENERATION_SCOPES.home,
    );
    const cacheKey = `cache:home:new:${PERFORMANCE_TAXONOMY_CACHE_VERSION}:${cacheGenerationSegment(generation)}:${targetLocale}`;
    return this.cacheService.getOrLoad(
      cacheKey,
      () => this.loadNewPerformances(targetLocale),
      { readThrough: generation !== null },
    );
  }

  private async loadNewPerformances(
    targetLocale: string,
  ): Promise<CacheLoadResult<PerformanceCardData[]>> {
    const rows = await this.db
      .select(publicCatalogCardSelection)
        .from(performances)
        .leftJoin(venues, eq(performances.venueId, venues.id))
        .leftJoin(bookingPolicies, eq(bookingPolicies.performanceId, performances.id))
        .where(
          and(
            eq(performances.publishState, 'published'),
          inArray(performances.status, ['selling', 'upcoming', 'closing_soon']),
        ),
      )
      .orderBy(desc(performances.createdAt))
      .limit(4);

    const cards: PerformanceCardData[] = rows.map(mapPublicCatalogCard);
    const result = await overlayReviewedCardTranslations(
      this.db,
      cards,
      targetLocale,
    );

    return {
      value: result,
      ttlSeconds: cacheTtlUntilNextBookingStart(rows.map((row) => row.bookingStartsAt)),
    };
  }
}
