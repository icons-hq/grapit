import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql, ilike } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  performances,
  venues,
  priceTiers,
  showtimes,
  castings,
  seatMaps,
  banners,
} from '../../database/schema/index.js';
import type {
  PerformanceBookingPolicy,
  Banner,
  SeatMap,
  PerformanceWithDetails,
  PerformanceListResponse,
  SeatMapConfig,
} from '@grabit/shared';
import { DEFAULT_PERFORMANCE_BOOKING_POLICY as DEFAULT_BOOKING_POLICY } from '@grabit/shared';
import type {
  CreatePerformanceInput,
  UpdatePerformanceInput,
  CreateBannerInput,
  SeatMapConfigInput,
} from '@grabit/shared';
import { CacheService } from '../performance/cache.service.js';
import { parseAdminKstDateTime } from './admin-date.util.js';

function cloneDefaultBookingPolicy(): PerformanceBookingPolicy {
  return {
    ...DEFAULT_BOOKING_POLICY,
    allowedPaymentMethods: [...DEFAULT_BOOKING_POLICY.allowedPaymentMethods],
  };
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Invalidate all catalog caches (list + home + detail by id if provided).
   * Called after any mutation that can change the published catalog output.
   */
  private async invalidateCatalogCache(id?: string): Promise<void> {
    const ops: Array<Promise<void>> = [
      this.cacheService.invalidatePattern('cache:performances:list:*'),
      this.cacheService.invalidatePattern('cache:home:*'),
    ];
    if (id) {
      ops.push(this.cacheService.invalidate(`cache:performances:detail:${id}`));
    }
    await Promise.all(ops);
  }

  async createPerformance(input: CreatePerformanceInput): Promise<PerformanceWithDetails> {
    const result = await this.db.transaction(async (tx) => {
      // Insert or find venue by name
      const [venue] = await tx
        .insert(venues)
        .values({
          name: input.venueName,
          address: input.venueAddress ?? null,
        })
        .onConflictDoUpdate({
          target: venues.name,
          set: { address: input.venueAddress ?? null },
        })
        .returning();

      // Insert performance
      const [perf] = await tx
        .insert(performances)
        .values({
          title: input.title,
          genre: input.genre,
          subcategory: input.subcategory ?? null,
          venueId: venue?.id,
          posterUrl: input.posterUrl ?? null,
          description: input.description ?? null,
          startDate: parseAdminKstDateTime(input.startDate),
          endDate: parseAdminKstDateTime(input.endDate),
          runtime: input.runtime ?? null,
          ageRating: input.ageRating,
          salesInfo: input.salesInfo ?? null,
        })
        .returning();

      const performanceId = perf!.id;

      // Insert price tiers
      if (input.priceTiers.length > 0) {
        await tx
          .insert(priceTiers)
          .values(
            input.priceTiers.map((pt) => ({
              performanceId,
              tierName: pt.tierName,
              price: pt.price,
              sortOrder: pt.sortOrder,
            })),
          );
      }

      // Insert showtimes
      if (input.showtimes && input.showtimes.length > 0) {
        await tx
          .insert(showtimes)
          .values(
            input.showtimes.map((st) => ({
              performanceId,
              dateTime: parseAdminKstDateTime(st.dateTime),
            })),
          );
      }

      // Insert castings
      if (input.castings && input.castings.length > 0) {
        await tx
          .insert(castings)
          .values(
            input.castings.map((c) => ({
              performanceId,
              actorName: c.actorName,
              roleName: c.roleName ?? null,
              photoUrl: c.photoUrl ?? null,
              sortOrder: c.sortOrder,
            })),
          );
      }

      return {
        id: perf!.id,
        title: perf!.title,
        genre: perf!.genre,
        subcategory: perf!.subcategory,
        venueId: perf!.venueId,
        posterUrl: perf!.posterUrl,
        description: perf!.description,
        startDate: perf!.startDate?.toISOString() ?? '',
        endDate: perf!.endDate?.toISOString() ?? '',
        runtime: perf!.runtime,
        ageRating: perf!.ageRating,
        status: perf!.status,
        salesInfo: perf!.salesInfo,
        viewCount: perf!.viewCount,
        createdAt: perf!.createdAt?.toISOString() ?? '',
        updatedAt: perf!.updatedAt?.toISOString() ?? '',
        venue: venue ? { id: venue.id, name: venue.name, address: venue.address } : null,
        priceTiers: [],
        showtimes: [],
        castings: [],
        seatMaps: [],
        bookingPolicy: cloneDefaultBookingPolicy(),
        seatMap: null,
      };
    });

    await this.invalidateCatalogCache();
    return result;
  }

  async updatePerformance(id: string, input: UpdatePerformanceInput): Promise<PerformanceWithDetails> {
    const result = await this.db.transaction(async (tx) => {
      // Handle venue update if venueName changed
      let venueId: string | undefined;
      if (input.venueName) {
        const [venue] = await tx
          .insert(venues)
          .values({
            name: input.venueName,
            address: input.venueAddress ?? null,
          })
          .onConflictDoUpdate({
            target: venues.name,
            set: { address: input.venueAddress ?? null },
          })
          .returning();
        venueId = venue?.id;
      }

      // Update performance fields
      const updateData: Record<string, unknown> = {};
      if (input.title !== undefined) updateData['title'] = input.title;
      if (input.genre !== undefined) updateData['genre'] = input.genre;
      if (input.subcategory !== undefined) updateData['subcategory'] = input.subcategory;
      if (venueId !== undefined) updateData['venueId'] = venueId;
      if (input.posterUrl !== undefined) updateData['posterUrl'] = input.posterUrl;
      if (input.description !== undefined) updateData['description'] = input.description;
      if (input.startDate !== undefined) {
        updateData['startDate'] = parseAdminKstDateTime(input.startDate);
      }
      if (input.endDate !== undefined) {
        updateData['endDate'] = parseAdminKstDateTime(input.endDate);
      }
      if (input.runtime !== undefined) updateData['runtime'] = input.runtime;
      if (input.ageRating !== undefined) updateData['ageRating'] = input.ageRating;
      if (input.salesInfo !== undefined) updateData['salesInfo'] = input.salesInfo;
      updateData['updatedAt'] = new Date();

      const [perf] = await tx
        .update(performances)
        .set(updateData)
        .where(eq(performances.id, id))
        .returning();

      if (!perf) {
        throw new NotFoundException(`공연을 찾을 수 없습니다 (id: ${id})`);
      }

      // Replace price tiers if provided
      if (input.priceTiers) {
        await tx.delete(priceTiers).where(eq(priceTiers.performanceId, id));
        if (input.priceTiers.length > 0) {
          await tx
            .insert(priceTiers)
            .values(
              input.priceTiers.map((pt) => ({
                performanceId: id,
                tierName: pt.tierName,
                price: pt.price,
                sortOrder: pt.sortOrder,
              })),
            );
        }
      }

      // Replace showtimes if provided
      if (input.showtimes) {
        await tx.delete(showtimes).where(eq(showtimes.performanceId, id));
        if (input.showtimes.length > 0) {
          await tx
            .insert(showtimes)
            .values(
              input.showtimes.map((st) => ({
                performanceId: id,
                dateTime: parseAdminKstDateTime(st.dateTime),
              })),
            );
        }
      }

      // Replace castings if provided
      if (input.castings) {
        await tx.delete(castings).where(eq(castings.performanceId, id));
        if (input.castings.length > 0) {
          await tx
            .insert(castings)
            .values(
              input.castings.map((c) => ({
                performanceId: id,
                actorName: c.actorName,
                roleName: c.roleName ?? null,
                photoUrl: c.photoUrl ?? null,
                sortOrder: c.sortOrder,
              })),
            );
        }
      }

      return {
        id: perf!.id,
        title: perf!.title,
        genre: perf!.genre,
        subcategory: perf!.subcategory,
        venueId: perf!.venueId,
        posterUrl: perf!.posterUrl,
        description: perf!.description,
        startDate: perf!.startDate?.toISOString() ?? '',
        endDate: perf!.endDate?.toISOString() ?? '',
        runtime: perf!.runtime,
        ageRating: perf!.ageRating,
        status: perf!.status,
        salesInfo: perf!.salesInfo,
        viewCount: perf!.viewCount,
        createdAt: perf!.createdAt?.toISOString() ?? '',
        updatedAt: perf!.updatedAt?.toISOString() ?? '',
        venue: null,
        priceTiers: [],
        showtimes: [],
        castings: [],
        seatMaps: [],
        bookingPolicy: cloneDefaultBookingPolicy(),
        seatMap: null,
      };
    });

    await this.invalidateCatalogCache(id);
    return result;
  }

  async deletePerformance(id: string): Promise<void> {
    await this.db.delete(performances).where(eq(performances.id, id));
    await this.invalidateCatalogCache(id);
  }

  async saveSeatMap(
    performanceId: string,
    svgUrl: string,
    seatConfig: SeatMapConfigInput,
    totalSeats?: number,
  ): Promise<SeatMap> {
    const calculatedTotalSeats = totalSeats
      ?? seatConfig.tiers.reduce((sum, tier) => sum + tier.seatIds.length, 0);

    const [result] = await this.db
      .insert(seatMaps)
      .values({
        performanceId,
        svgUrl,
        seatConfig: seatConfig as unknown as Record<string, unknown>,
        totalSeats: calculatedTotalSeats,
      })
      .onConflictDoUpdate({
        target: seatMaps.performanceId,
        set: {
          svgUrl,
          seatConfig: seatConfig as unknown as Record<string, unknown>,
          totalSeats: calculatedTotalSeats,
        },
      })
      .returning();

    return {
      id: result!.id,
      performanceId: result!.performanceId,
      floorKey: result!.floorKey ?? '1F',
      floorLabel: result!.floorLabel ?? '1층',
      sortOrder: result!.sortOrder ?? 0,
      svgUrl: result!.svgUrl,
      seatConfig: result!.seatConfig as SeatMapConfig | null,
      totalSeats: result!.totalSeats,
    };
  }

  async listPerformances(query: {
    status?: string;
    search?: string;
    page: number;
    limit: number;
  }): Promise<PerformanceListResponse> {
    const { status, search, page = 1, limit = 20 } = query;
    const offset = (page - 1) * limit;

    const conditions: ReturnType<typeof eq>[] = [];

    if (status) {
      conditions.push(
        eq(performances.status, status as typeof performances.status.enumValues[number]),
      );
    }

    if (search) {
      conditions.push(ilike(performances.title, `%${search}%`));
    }

    const whereClause = conditions.length > 0
      ? sql`${sql.join(conditions, sql` AND `)}`
      : undefined;

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
        .orderBy(performances.createdAt)
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(performances)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data: data.map((row) => ({
        id: row.id,
        title: row.title,
        genre: row.genre,
        posterUrl: row.posterUrl,
        status: row.status,
        startDate: row.startDate?.toISOString() ?? '',
        endDate: row.endDate?.toISOString() ?? '',
        venueName: row.venueName ?? null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async createBanner(input: CreateBannerInput): Promise<Banner> {
    const [result] = await this.db
      .insert(banners)
      .values({
        imageUrl: input.imageUrl,
        linkUrl: input.linkUrl ?? null,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      })
      .returning();

    await this.cacheService.invalidate('cache:home:banners');

    return {
      id: result!.id,
      imageUrl: result!.imageUrl,
      linkUrl: result!.linkUrl,
      sortOrder: result!.sortOrder,
      isActive: result!.isActive,
    };
  }

  async updateBanner(id: string, input: Partial<CreateBannerInput>): Promise<Banner> {
    const updateData: Record<string, unknown> = {};
    if (input.imageUrl !== undefined) updateData['imageUrl'] = input.imageUrl;
    if (input.linkUrl !== undefined) updateData['linkUrl'] = input.linkUrl;
    if (input.sortOrder !== undefined) updateData['sortOrder'] = input.sortOrder;
    if (input.isActive !== undefined) updateData['isActive'] = input.isActive;
    updateData['updatedAt'] = new Date();

    const [result] = await this.db
      .update(banners)
      .set(updateData)
      .where(eq(banners.id, id))
      .returning();

    if (!result) {
      throw new NotFoundException(`배너를 찾을 수 없습니다 (id: ${id})`);
    }

    await this.cacheService.invalidate('cache:home:banners');

    return {
      id: result.id,
      imageUrl: result.imageUrl,
      linkUrl: result.linkUrl,
      sortOrder: result.sortOrder,
      isActive: result.isActive,
    };
  }

  async deleteBanner(id: string): Promise<void> {
    await this.db.delete(banners).where(eq(banners.id, id));
    await this.cacheService.invalidate('cache:home:banners');
  }

  async listBanners(): Promise<Banner[]> {
    const rows = await this.db
      .select()
      .from(banners)
      .orderBy(banners.sortOrder);

    return rows.map((b) => ({
      id: b.id,
      imageUrl: b.imageUrl,
      linkUrl: b.linkUrl,
      sortOrder: b.sortOrder,
      isActive: b.isActive,
    }));
  }

  async reorderBanners(orderedIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(banners)
          .set({ sortOrder: i })
          .where(eq(banners.id, orderedIds[i]!));
      }
    });
    await this.cacheService.invalidate('cache:home:banners');
  }
}
