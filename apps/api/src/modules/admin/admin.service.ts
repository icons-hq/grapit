import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { eq, sql, ilike } from 'drizzle-orm';
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
	  venueLayouts,
	  venueLayoutFloors,
	  venueLayoutSeats,
	  performanceSeatTiers,
	  performanceSeatAssignments,
	} from '../../database/schema/index.js';
import type {
  PerformanceBookingPolicy,
  Banner,
  SeatMap,
  PerformanceWithDetails,
  PerformanceListResponse,
  SeatMapConfig,
  PerformanceSeatMapInput,
  PerformanceBookingPolicyInput,
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

type LegacySeatMapSaveInput = {
  svgUrl: string;
  seatConfig: SeatMapConfigInput;
  totalSeats?: number;
};

type FloorAwareSeatMapSaveInput = {
  seatMaps: PerformanceSeatMapInput[];
  bookingPolicy?: PerformanceBookingPolicyInput;
};

type SaveSeatMapInput = LegacySeatMapSaveInput | FloorAwareSeatMapSaveInput;

type SeatMapSaveResult = Pick<
  PerformanceWithDetails,
  'seatMaps' | 'bookingPolicy' | 'seatMap'
>;

type SeatMapValidationIssue = {
  path: string;
  message: string;
};

type PriceTierSnapshot = {
  tierName: string;
  price: number;
  sortOrder: number;
};

type SyncedLayoutOverlay = {
  layoutId: string | null;
};

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

  private normalizeSeatMaps(
    performanceId: string,
    floors: PerformanceSeatMapInput[],
  ): SeatMap[] {
    return floors.map((floor, index) => ({
      id: `${performanceId}:${floor.floorKey}:${index}`,
      performanceId,
      floorKey: floor.floorKey,
      floorLabel: floor.floorLabel,
      sortOrder: floor.sortOrder,
      svgUrl: floor.svgUrl,
      seatConfig: floor.seatConfig as SeatMapConfig | null,
      totalSeats: floor.totalSeats,
    }));
  }

  private assertUniqueFloorKeys(floors: PerformanceSeatMapInput[]): void {
    const seen = new Set<string>();

    for (const floor of floors) {
      if (seen.has(floor.floorKey)) {
        throw new UnprocessableEntityException({
          message: 'Validation failed',
          errors: {
            seatMaps: [`duplicate floorKey: ${floor.floorKey}`],
          },
        });
      }

      seen.add(floor.floorKey);
    }
  }

  private assertUniquePriceTierNames(
    priceTierInputs: Array<{ tierName: string }>,
  ): Set<string> {
    const names = new Set<string>();
    const duplicates = new Set<string>();

    for (const tier of priceTierInputs) {
      const tierName = tier.tierName.trim();
      if (names.has(tierName)) {
        duplicates.add(tierName);
      }
      names.add(tierName);
    }

    if (duplicates.size > 0) {
      throw new UnprocessableEntityException({
        message: 'Validation failed',
        errors: {
          priceTiers: [
            `duplicate tierName: ${Array.from(duplicates).join(', ')}`,
          ],
        },
      });
    }

    return names;
  }

  private async loadPriceTierNames(
    tx: DrizzleDB,
    performanceId: string,
  ): Promise<Set<string>> {
    const snapshots = await this.loadPriceTierSnapshots(tx, performanceId);
    return new Set(snapshots.map((row) => row.tierName));
  }

  private async loadPriceTierSnapshots(
    tx: DrizzleDB,
    performanceId: string,
  ): Promise<PriceTierSnapshot[]> {
    const rows = await tx
      .select({
        tierName: priceTiers.tierName,
        price: priceTiers.price,
        sortOrder: priceTiers.sortOrder,
      })
      .from(priceTiers)
      .where(eq(priceTiers.performanceId, performanceId));

    return rows.map((row) => ({
      tierName: row.tierName,
      price: row.price,
      sortOrder: row.sortOrder,
    }));
  }

  private priceTierSnapshotsFromInput(
    priceTierInputs: Array<{ tierName: string; price: number; sortOrder: number }>,
  ): PriceTierSnapshot[] {
    return priceTierInputs.map((tier) => ({
      tierName: tier.tierName.trim(),
      price: tier.price,
      sortOrder: tier.sortOrder,
    }));
  }

  private async loadPerformanceVenueId(
    tx: DrizzleDB,
    performanceId: string,
  ): Promise<string | null> {
    const rows = await tx
      .select({ venueId: performances.venueId })
      .from(performances)
      .where(eq(performances.id, performanceId));

    return typeof rows[0]?.venueId === 'string' ? rows[0].venueId : null;
  }

  private getAssignedSeatIds(floor: PerformanceSeatMapInput): Set<string> {
    const assignedSeats = new Set<string>();

    for (const tier of floor.seatConfig?.tiers ?? []) {
      for (const seatId of tier.seatIds) {
        assignedSeats.add(seatId);
      }
    }

    return assignedSeats;
  }

  private toStableSeatKey(floorKey: string, sourceSeatId: string): string {
    return sourceSeatId.includes(':') ? sourceSeatId : `${floorKey}:${sourceSeatId}`;
  }

  private deriveSeatPosition(sourceSeatId: string): { rowLabel: string | null; seatNumber: string | null } {
    const localSeatId = sourceSeatId.includes(':')
      ? sourceSeatId.slice(sourceSeatId.indexOf(':') + 1)
      : sourceSeatId;
    const hyphenParts = localSeatId.split('-');
    if (hyphenParts.length >= 2 && hyphenParts[0] && hyphenParts.slice(1).join('-')) {
      return {
        rowLabel: hyphenParts[0],
        seatNumber: hyphenParts.slice(1).join('-'),
      };
    }

    const compactMatch = /^([A-Za-z]+)[-_ ]?(\d+)$/.exec(localSeatId);
    if (compactMatch) {
      return {
        rowLabel: compactMatch[1]!,
        seatNumber: compactMatch[2]!,
      };
    }

    return { rowLabel: null, seatNumber: null };
  }

  private assertSeatMapConfigsValid(
    floors: PerformanceSeatMapInput[],
    validTierNames: Set<string>,
  ): void {
    const issues: SeatMapValidationIssue[] = [];

    floors.forEach((floor, floorIndex) => {
      const seatConfig = floor.seatConfig;
      if (!seatConfig) {
        if (floor.totalSeats > 0) {
          issues.push({
            path: `seatMaps.${floorIndex}.seatConfig`,
            message: `seatConfig is required for ${floor.totalSeats} detected seats`,
          });
        }
        return;
      }

      const assignedSeats = new Set<string>();
      const duplicatedSeats = new Set<string>();

      seatConfig.tiers.forEach((tier, tierIndex) => {
        const tierName = tier.tierName.trim();
        if (!validTierNames.has(tierName)) {
          issues.push({
            path: `seatMaps.${floorIndex}.seatConfig.tiers.${tierIndex}.tierName`,
            message: `unknown tierName: ${tier.tierName}`,
          });
        }

        for (const seatId of tier.seatIds) {
          if (assignedSeats.has(seatId)) {
            duplicatedSeats.add(seatId);
          }
          assignedSeats.add(seatId);

          if (this.toStableSeatKey(floor.floorKey, seatId).length > 120) {
            issues.push({
              path: `seatMaps.${floorIndex}.seatConfig.tiers.${tierIndex}.seatIds`,
              message: `seatKey exceeds 120 chars: ${this.toStableSeatKey(floor.floorKey, seatId)}`,
            });
          }
        }
      });

      if (duplicatedSeats.size > 0) {
        issues.push({
          path: `seatMaps.${floorIndex}.seatConfig.tiers`,
          message: `duplicate seatIds: ${Array.from(duplicatedSeats).join(', ')}`,
        });
      }

      if (floor.totalSeats > 0 && assignedSeats.size !== floor.totalSeats) {
        issues.push({
          path: `seatMaps.${floorIndex}.seatConfig.tiers`,
          message: `assigned seat count ${assignedSeats.size} does not match detected totalSeats ${floor.totalSeats}`,
        });
      }
    });

    if (issues.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Validation failed',
        errors: issues.reduce<Record<string, string[]>>((acc, issue) => {
          acc[issue.path] = [...(acc[issue.path] ?? []), issue.message];
          return acc;
        }, {}),
      });
    }
  }

  private async persistBookingPolicy(
    tx: DrizzleDB,
    performanceId: string,
    bookingPolicy: PerformanceBookingPolicyInput | PerformanceBookingPolicy,
  ): Promise<void> {
    await tx
      .insert(bookingPolicies)
      .values({
        performanceId,
        maxTicketsPerUser: bookingPolicy.maxTicketsPerUser,
        allowedPaymentMethods: bookingPolicy.allowedPaymentMethods,
        changePolicyEnabled: bookingPolicy.changePolicyEnabled,
        paymentWindowMinutes: bookingPolicy.paymentWindowMinutes,
        seatHoldMinutes: bookingPolicy.seatHoldMinutes,
        cancelledSeatHoldMinMinutes: bookingPolicy.cancelledSeatHoldMinMinutes,
        cancelledSeatHoldMaxMinutes: bookingPolicy.cancelledSeatHoldMaxMinutes,
        manualOpenEnabled: bookingPolicy.manualOpenEnabled,
      })
      .onConflictDoUpdate({
        target: bookingPolicies.performanceId,
        set: {
          maxTicketsPerUser: bookingPolicy.maxTicketsPerUser,
          allowedPaymentMethods: bookingPolicy.allowedPaymentMethods,
          changePolicyEnabled: bookingPolicy.changePolicyEnabled,
          paymentWindowMinutes: bookingPolicy.paymentWindowMinutes,
          seatHoldMinutes: bookingPolicy.seatHoldMinutes,
          cancelledSeatHoldMinMinutes: bookingPolicy.cancelledSeatHoldMinMinutes,
          cancelledSeatHoldMaxMinutes: bookingPolicy.cancelledSeatHoldMaxMinutes,
          manualOpenEnabled: bookingPolicy.manualOpenEnabled,
          updatedAt: new Date(),
        },
      })
      .returning();
  }

  private async syncVenueLayoutOverlay(
    tx: DrizzleDB,
    performanceId: string,
    venueId: string | null | undefined,
    floors: PerformanceSeatMapInput[],
    priceTierSnapshots: PriceTierSnapshot[],
  ): Promise<SyncedLayoutOverlay> {
    await tx
      .delete(performanceSeatAssignments)
      .where(eq(performanceSeatAssignments.performanceId, performanceId));
    await tx
      .delete(performanceSeatTiers)
      .where(eq(performanceSeatTiers.performanceId, performanceId));

    if (!venueId || floors.length === 0) {
      return { layoutId: null };
    }

    const layoutName = `performance:${performanceId}:seat-map`;
    const firstSvgUrl = floors[0]?.svgUrl ?? null;
    const [layout] = await tx
      .insert(venueLayouts)
      .values({
        venueId,
        layoutName,
        version: 1,
        isActive: true,
        sourceSvgUrl: firstSvgUrl,
        normalizedSvgUrl: firstSvgUrl,
        stagePosition: 'top',
      })
      .onConflictDoUpdate({
        target: [
          venueLayouts.venueId,
          venueLayouts.layoutName,
          venueLayouts.version,
        ],
        set: {
          isActive: true,
          sourceSvgUrl: firstSvgUrl,
          normalizedSvgUrl: firstSvgUrl,
          updatedAt: new Date(),
        },
      })
      .returning({ id: venueLayouts.id });

    const layoutId = layout?.id ?? null;
    if (!layoutId) {
      return { layoutId: null };
    }

    await tx.delete(venueLayoutSeats).where(eq(venueLayoutSeats.layoutId, layoutId));
    await tx.delete(venueLayoutFloors).where(eq(venueLayoutFloors.layoutId, layoutId));

    const tierColorByName = new Map<string, string>();
    for (const floor of floors) {
      for (const tier of floor.seatConfig?.tiers ?? []) {
        if (!tierColorByName.has(tier.tierName)) {
          tierColorByName.set(tier.tierName, tier.color);
        }
      }
    }

    const insertedTierRows = priceTierSnapshots.length > 0
      ? await tx
        .insert(performanceSeatTiers)
        .values(
          priceTierSnapshots.map((tier) => ({
            performanceId,
            tierName: tier.tierName,
            price: tier.price,
            sortOrder: tier.sortOrder,
            color: tierColorByName.get(tier.tierName) ?? '#9CA3AF',
          })),
        )
        .returning({
          id: performanceSeatTiers.id,
          tierName: performanceSeatTiers.tierName,
        })
      : [];
    const tierIdByName = new Map(
      insertedTierRows
        .filter((row) => typeof row.tierName === 'string')
        .map((row) => [row.tierName, row.id]),
    );

    for (const floor of floors) {
      const [layoutFloor] = await tx
        .insert(venueLayoutFloors)
        .values({
          layoutId,
          floorKey: floor.floorKey,
          floorLabel: floor.floorLabel,
          sortOrder: floor.sortOrder,
          svgUrl: floor.svgUrl,
        })
        .returning({ id: venueLayoutFloors.id });
      const floorId = layoutFloor?.id;
      if (!floorId) {
        continue;
      }

      const seatTierBySeatKey = new Map<string, string>();
      for (const tier of floor.seatConfig?.tiers ?? []) {
        for (const sourceSeatId of tier.seatIds) {
          seatTierBySeatKey.set(
            this.toStableSeatKey(floor.floorKey, sourceSeatId),
            tier.tierName,
          );
        }
      }

      const seatValues = Array.from(this.getAssignedSeatIds(floor)).map((sourceSeatId, index) => {
        const seatKey = this.toStableSeatKey(floor.floorKey, sourceSeatId);
        const position = this.deriveSeatPosition(sourceSeatId);

        return {
          layoutId,
          floorId,
          seatKey,
          sourceSeatId,
          rowLabel: position.rowLabel,
          seatNumber: position.seatNumber,
          sortOrder: index,
        };
      });

      if (seatValues.length === 0) {
        continue;
      }

      const insertedSeatRows = await tx
        .insert(venueLayoutSeats)
        .values(seatValues)
        .returning({
          id: venueLayoutSeats.id,
          seatKey: venueLayoutSeats.seatKey,
        });

      const assignmentValues = insertedSeatRows
        .map((seatRow) => {
          const tierName = seatTierBySeatKey.get(seatRow.seatKey);
          const tierId = tierName ? tierIdByName.get(tierName) : undefined;
          if (!tierId) {
            return null;
          }

          return {
            performanceId,
            layoutSeatId: seatRow.id,
            tierId,
            saleStatus: 'available' as const,
          };
        })
        .filter((value): value is NonNullable<typeof value> => value !== null);

      if (assignmentValues.length > 0) {
        await tx.insert(performanceSeatAssignments).values(assignmentValues);
      }
    }

    return { layoutId };
  }

  private async replaceSeatMaps(
    tx: DrizzleDB,
    performanceId: string,
    venueId: string | null | undefined,
    floors: PerformanceSeatMapInput[],
    validTierNames: Set<string>,
    priceTierSnapshots: PriceTierSnapshot[],
  ): Promise<void> {
    this.assertUniqueFloorKeys(floors);
    this.assertSeatMapConfigsValid(floors, validTierNames);
    const overlay = await this.syncVenueLayoutOverlay(
      tx,
      performanceId,
      venueId,
      floors,
      priceTierSnapshots,
    );
    await tx.delete(seatMaps).where(eq(seatMaps.performanceId, performanceId));

    if (floors.length === 0) {
      return;
    }

    await tx
      .insert(seatMaps)
      .values(
        floors.map((floor) => ({
          performanceId,
          venueLayoutId: overlay.layoutId,
          floorKey: floor.floorKey,
          floorLabel: floor.floorLabel,
          sortOrder: floor.sortOrder,
          svgUrl: floor.svgUrl,
          seatConfig: floor.seatConfig as unknown as Record<string, unknown> | null,
          totalSeats: floor.totalSeats,
        })),
      )
      .returning();
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
      const validTierNames = this.assertUniquePriceTierNames(input.priceTiers);
      const priceTierSnapshots = this.priceTierSnapshotsFromInput(input.priceTiers);

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

      const normalizedSeatMaps = this.normalizeSeatMaps(
        performanceId,
        input.seatMaps,
      );
      await this.replaceSeatMaps(
        tx as unknown as DrizzleDB,
        performanceId,
        venue?.id,
        input.seatMaps,
        validTierNames,
        priceTierSnapshots,
      );

      const bookingPolicy = input.bookingPolicy ?? cloneDefaultBookingPolicy();
      await this.persistBookingPolicy(
        tx as unknown as DrizzleDB,
        performanceId,
        bookingPolicy,
      );

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
        seatMaps: normalizedSeatMaps,
        bookingPolicy,
        seatMap: normalizedSeatMaps[0] ?? null,
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
      let validTierNames: Set<string> | null = null;
      let priceTierSnapshots: PriceTierSnapshot[] | null = null;
      if (input.priceTiers) {
        validTierNames = this.assertUniquePriceTierNames(input.priceTiers);
        priceTierSnapshots = this.priceTierSnapshotsFromInput(input.priceTiers);
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

      if (input.seatMaps) {
        validTierNames ??= await this.loadPriceTierNames(
          tx as unknown as DrizzleDB,
          id,
        );
        priceTierSnapshots ??= await this.loadPriceTierSnapshots(
          tx as unknown as DrizzleDB,
          id,
        );
        await this.replaceSeatMaps(
          tx as unknown as DrizzleDB,
          id,
          perf.venueId,
          input.seatMaps,
          validTierNames,
          priceTierSnapshots,
        );
      }

      const bookingPolicy = input.bookingPolicy ?? cloneDefaultBookingPolicy();
      if (input.bookingPolicy) {
        await this.persistBookingPolicy(
          tx as unknown as DrizzleDB,
          id,
          bookingPolicy,
        );
      }

      const normalizedSeatMaps = this.normalizeSeatMaps(id, input.seatMaps ?? []);

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
        seatMaps: normalizedSeatMaps,
        bookingPolicy,
        seatMap: normalizedSeatMaps[0] ?? null,
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
    input: SaveSeatMapInput,
  ): Promise<SeatMapSaveResult> {
    const floorAwareInput: FloorAwareSeatMapSaveInput = 'seatMaps' in input
      ? input
      : {
          seatMaps: [
            {
              floorKey: '1F',
              floorLabel: '1층',
              sortOrder: 0,
              svgUrl: input.svgUrl,
              seatConfig: input.seatConfig,
              totalSeats:
                input.totalSeats
                ?? input.seatConfig.tiers.reduce(
                  (sum, tier) => sum + tier.seatIds.length,
                  0,
                ),
            },
          ],
        };

    const bookingPolicy = floorAwareInput.bookingPolicy ?? cloneDefaultBookingPolicy();
    this.assertUniqueFloorKeys(floorAwareInput.seatMaps);
    const [priceTierSnapshots, venueId] = await Promise.all([
      this.loadPriceTierSnapshots(
        this.db,
        performanceId,
      ),
      this.loadPerformanceVenueId(
        this.db,
        performanceId,
      ),
    ]);
    const validTierNames = new Set(priceTierSnapshots.map((row) => row.tierName));
    this.assertSeatMapConfigsValid(floorAwareInput.seatMaps, validTierNames);

    await this.db.transaction(async (tx) => {
      await this.replaceSeatMaps(
        tx as unknown as DrizzleDB,
        performanceId,
        venueId,
        floorAwareInput.seatMaps,
        validTierNames,
        priceTierSnapshots,
      );

      if (floorAwareInput.bookingPolicy) {
        await this.persistBookingPolicy(
          tx as unknown as DrizzleDB,
          performanceId,
          floorAwareInput.bookingPolicy,
        );
      }
    });

    const normalizedSeatMaps = this.normalizeSeatMaps(
      performanceId,
      floorAwareInput.seatMaps,
    );

    return {
      seatMaps: normalizedSeatMaps,
      bookingPolicy,
      seatMap: normalizedSeatMaps[0] ?? null,
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
