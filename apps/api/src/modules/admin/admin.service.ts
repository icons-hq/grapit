import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, sql, ilike, inArray } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  performances,
  venues,
  priceTiers,
  showtimes,
  reservations,
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
  BannerDeviceTarget,
  BannerPlacement,
  BannerStatus,
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
import {
  BANNER_DEVICE_TARGETS,
  BANNER_PLACEMENTS,
  BANNER_STATUSES,
  createBannerSchema,
} from '@grabit/shared';
import { CacheService } from '../performance/cache.service.js';
import { parseAdminKstDateTime } from './admin-date.util.js';
import { AdminAuditService } from './admin-audit.service.js';

function cloneDefaultBookingPolicy(): PerformanceBookingPolicy {
  return {
    ...DEFAULT_BOOKING_POLICY,
    allowedPaymentMethods: [...DEFAULT_BOOKING_POLICY.allowedPaymentMethods],
  };
}

function parseOptionalIsoDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function toOptionalIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
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
type ShowtimeUpdateInput = NonNullable<UpdatePerformanceInput['showtimes']>[number];

type SeatMapSaveResult = Pick<
  PerformanceWithDetails,
  'seatMaps' | 'bookingPolicy' | 'seatMap'
>;

type BannerMutationContext = AdminEventMutationContext;

type BannerRow = {
  id: string;
  imageUrl: string;
  linkUrl: string | null;
  placement: BannerPlacement;
  deviceTarget: BannerDeviceTarget;
  status: BannerStatus;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  sortOrder: number;
  isActive: boolean;
};

type NormalizedCreateBannerInput = {
  imageUrl: string;
  linkUrl?: string | null;
  placement: BannerPlacement;
  deviceTarget: BannerDeviceTarget;
  startsAt?: string | null;
  endsAt?: string | null;
  status: BannerStatus;
  sortOrder: number;
  isActive: boolean;
};

export interface AdminEventMutationContext {
  actorUserId: string;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface EventPublishContentChecklist {
  ko: {
    title: boolean;
    description: boolean;
  };
  en: {
    title: boolean;
    description: boolean;
  };
}

export interface PublishPerformanceInput {
  reason: string;
  confirmed: true;
  confirmedChangedFields: string[];
  contentChecklist: EventPublishContentChecklist;
}

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
    private readonly adminAuditService: AdminAuditService,
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
      ops.push(
        this.cacheService.invalidate(`cache:performances:detail:${id}`),
        this.cacheService.invalidatePattern(`cache:performances:detail:${id}:*`),
      );
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

  private async syncShowtimes(
    tx: DrizzleDB,
    performanceId: string,
    nextShowtimes: ShowtimeUpdateInput[],
  ): Promise<void> {
    const existingShowtimes = await tx
      .select({
        id: showtimes.id,
        dateTime: showtimes.dateTime,
      })
      .from(showtimes)
      .where(eq(showtimes.performanceId, performanceId))
      .orderBy(showtimes.dateTime);

    const existingById = new Map(
      existingShowtimes.map((showtime) => [showtime.id, showtime]),
    );
    const retainedIds = new Set<string>();

    for (const [index, nextShowtime] of nextShowtimes.entries()) {
      const dateTime = parseAdminKstDateTime(nextShowtime.dateTime);
      const requestedId = nextShowtime.showtimeId;
      let targetShowtime = requestedId
        ? existingById.get(requestedId)
        : undefined;

      if (requestedId && !targetShowtime) {
        throw new UnprocessableEntityException({
          message: 'Validation failed',
          errors: {
            showtimes: [`unknown showtimeId: ${requestedId}`],
          },
        });
      }

      if (!targetShowtime) {
        targetShowtime =
          existingShowtimes.find(
            (showtime) =>
              !retainedIds.has(showtime.id)
              && showtime.dateTime.getTime() === dateTime.getTime(),
          )
          ?? existingShowtimes.find(
            (showtime, existingIndex) =>
              existingIndex === index && !retainedIds.has(showtime.id),
          );
      }

      if (targetShowtime) {
        retainedIds.add(targetShowtime.id);
        await tx
          .update(showtimes)
          .set({ dateTime })
          .where(
            and(
              eq(showtimes.id, targetShowtime.id),
              eq(showtimes.performanceId, performanceId),
            ),
          );
        continue;
      }

      await tx
        .insert(showtimes)
        .values({
          performanceId,
          dateTime,
        });
    }

    const removedShowtimeIds = existingShowtimes
      .filter((showtime) => !retainedIds.has(showtime.id))
      .map((showtime) => showtime.id);

    if (removedShowtimeIds.length === 0) {
      return;
    }

    const referencedShowtimes = await tx
      .select({ showtimeId: reservations.showtimeId })
      .from(reservations)
      .where(inArray(reservations.showtimeId, removedShowtimeIds))
      .limit(1);

    if (referencedShowtimes.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Validation failed',
        errors: {
          showtimes: [
            '예약이 연결된 회차는 삭제할 수 없습니다. 회차를 유지한 채 일시만 수정하거나 예약을 먼저 정리해주세요.',
          ],
        },
      });
    }

    await tx
      .delete(showtimes)
      .where(
        and(
          eq(showtimes.performanceId, performanceId),
          inArray(showtimes.id, removedShowtimeIds),
        ),
      );
  }

  async createPerformance(input: CreatePerformanceInput): Promise<PerformanceWithDetails> {
    const result = await this.db.transaction(async (tx) => {
      // Insert or find venue by name
      const [venue] = await tx
        .insert(venues)
        .values({
          name: input.venueName,
          address: input.venueAddress ?? null,
          accessNotes: input.venueAccessNotes ?? null,
          transportSummary: input.transportSummary ?? null,
        })
        .onConflictDoUpdate({
          target: venues.name,
          set: {
            address: input.venueAddress ?? null,
            accessNotes: input.venueAccessNotes ?? null,
            transportSummary: input.transportSummary ?? null,
          },
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
          status: input.status,
          publishState: input.publishState,
          publishReviewRequestedAt: parseOptionalIsoDate(
            input.publishReviewRequestedAt,
          ),
          publishReadyAt: parseOptionalIsoDate(input.publishReadyAt),
          publishedAt: parseOptionalIsoDate(input.publishedAt),
          publishedByUserId: input.publishedByUserId ?? null,
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
        publishState: perf!.publishState,
        publishReviewRequestedAt: toOptionalIsoString(
          perf!.publishReviewRequestedAt,
        ),
        publishReadyAt: toOptionalIsoString(perf!.publishReadyAt),
        publishedAt: toOptionalIsoString(perf!.publishedAt),
        publishedByUserId: perf!.publishedByUserId,
        salesInfo: perf!.salesInfo,
        viewCount: perf!.viewCount,
        createdAt: perf!.createdAt?.toISOString() ?? '',
        updatedAt: perf!.updatedAt?.toISOString() ?? '',
        venue: venue
          ? {
              id: venue.id,
              name: venue.name,
              address: venue.address,
              accessNotes: venue.accessNotes,
              transportSummary: venue.transportSummary,
            }
          : null,
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

  async updatePerformance(
    id: string,
    input: UpdatePerformanceInput,
    context?: AdminEventMutationContext,
  ): Promise<PerformanceWithDetails> {
    const result = await this.db.transaction(async (tx) => {
      // Handle venue update if venueName changed
      let venueId: string | undefined;
      if (input.venueName) {
        const [venue] = await tx
          .insert(venues)
          .values({
            name: input.venueName,
            address: input.venueAddress ?? null,
            accessNotes: input.venueAccessNotes ?? null,
            transportSummary: input.transportSummary ?? null,
          })
          .onConflictDoUpdate({
            target: venues.name,
            set: {
              address: input.venueAddress ?? null,
              accessNotes: input.venueAccessNotes ?? null,
              transportSummary: input.transportSummary ?? null,
            },
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
      if (input.status !== undefined) updateData['status'] = input.status;
      if (input.publishState !== undefined) {
        updateData['publishState'] = input.publishState;
      }
      if (input.publishReviewRequestedAt !== undefined) {
        updateData['publishReviewRequestedAt'] = parseOptionalIsoDate(
          input.publishReviewRequestedAt,
        );
      }
      if (input.publishReadyAt !== undefined) {
        updateData['publishReadyAt'] = parseOptionalIsoDate(input.publishReadyAt);
      }
      if (input.publishedAt !== undefined) {
        updateData['publishedAt'] = parseOptionalIsoDate(input.publishedAt);
      }
      if (input.publishedByUserId !== undefined) {
        updateData['publishedByUserId'] = input.publishedByUserId;
      }
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
        await this.syncShowtimes(tx as unknown as DrizzleDB, id, input.showtimes);
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

      const response = {
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
        publishState: perf!.publishState,
        publishReviewRequestedAt: toOptionalIsoString(
          perf!.publishReviewRequestedAt,
        ),
        publishReadyAt: toOptionalIsoString(perf!.publishReadyAt),
        publishedAt: toOptionalIsoString(perf!.publishedAt),
        publishedByUserId: perf!.publishedByUserId,
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

      if (context) {
        const changedFields = resolveUpdateChangedFields(input);
        await this.adminAuditService.write(
          {
            actorUserId: context.actorUserId,
            action: 'event.update',
            resourceType: 'performance',
            resourceId: id,
            status: 'success',
            reason: context.reason ?? null,
            changedFields,
            before: {},
            after: buildUpdateAuditSnapshot(input, response),
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent ?? null,
            requestId: context.requestId ?? null,
          },
          tx as unknown as DrizzleDB,
        );
      }

      return response;
    });

    await this.invalidateCatalogCache(id);
    return result;
  }

  async publishPerformance(
    id: string,
    input: PublishPerformanceInput,
    context: AdminEventMutationContext,
  ): Promise<PerformanceWithDetails> {
    const result = await this.db.transaction(async (tx) => {
      const changedFields = sanitizeChangedFields(input.confirmedChangedFields);
      const missingRequiredContent = getMissingRequiredPublishContent(
        input.contentChecklist,
      );

      if (missingRequiredContent.length > 0) {
        await this.adminAuditService.write(
          {
            actorUserId: context.actorUserId,
            action: 'event.publish',
            resourceType: 'performance',
            resourceId: id,
            status: 'failed',
            reason: input.reason,
            changedFields,
            before: {},
            after: { missingRequiredContent },
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent ?? null,
            requestId: context.requestId ?? null,
          },
          tx as unknown as DrizzleDB,
        );

        throw new BadRequestException(
          `게시에는 한국어와 영어 필수 콘텐츠가 필요합니다: ${missingRequiredContent.join(', ')}`,
        );
      }

      const publishedAt = new Date();
      const [perf] = await tx
        .update(performances)
        .set({
          publishState: 'published',
          publishedAt,
          publishedByUserId: context.actorUserId,
          updatedAt: publishedAt,
        })
        .where(eq(performances.id, id))
        .returning();

      if (!perf) {
        throw new NotFoundException(`공연을 찾을 수 없습니다 (id: ${id})`);
      }

      const bookingPolicy = cloneDefaultBookingPolicy();
      const normalizedSeatMaps: SeatMap[] = [];
      const response: PerformanceWithDetails = {
        id: perf.id,
        title: perf.title,
        genre: perf.genre,
        subcategory: perf.subcategory,
        venueId: perf.venueId,
        posterUrl: perf.posterUrl,
        description: perf.description,
        startDate: perf.startDate?.toISOString() ?? '',
        endDate: perf.endDate?.toISOString() ?? '',
        runtime: perf.runtime,
        ageRating: perf.ageRating,
        status: perf.status,
        publishState: perf.publishState,
        publishReviewRequestedAt: toOptionalIsoString(
          perf.publishReviewRequestedAt,
        ),
        publishReadyAt: toOptionalIsoString(perf.publishReadyAt),
        publishedAt: toOptionalIsoString(perf.publishedAt),
        publishedByUserId: perf.publishedByUserId,
        salesInfo: perf.salesInfo,
        viewCount: perf.viewCount,
        createdAt: perf.createdAt?.toISOString() ?? '',
        updatedAt: perf.updatedAt?.toISOString() ?? '',
        venue: null,
        priceTiers: [],
        showtimes: [],
        castings: [],
        seatMaps: normalizedSeatMaps,
        bookingPolicy,
        seatMap: null,
      };

      await this.adminAuditService.write(
        {
          actorUserId: context.actorUserId,
          action: 'event.publish',
          resourceType: 'performance',
          resourceId: id,
          status: 'success',
          reason: input.reason,
          changedFields,
          before: {},
          after: {
            publishState: 'published',
            publishedAt: response.publishedAt,
            publishedByUserId: context.actorUserId,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
          requestId: context.requestId ?? null,
        },
        tx as unknown as DrizzleDB,
      );

      return response;
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

    await this.invalidateCatalogCache(performanceId);

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

  async createBanner(
    input: CreateBannerInput,
    context?: BannerMutationContext,
  ): Promise<Banner> {
    const bannerInput = validateCreateBannerInput(input);
    const [result] = await this.db
      .insert(banners)
      .values({
        imageUrl: bannerInput.imageUrl,
        linkUrl: bannerInput.linkUrl ?? null,
        placement: bannerInput.placement,
        deviceTarget: bannerInput.deviceTarget,
        startsAt: parseOptionalIsoDate(bannerInput.startsAt),
        endsAt: parseOptionalIsoDate(bannerInput.endsAt),
        status: bannerInput.status,
        sortOrder: bannerInput.sortOrder,
        isActive: bannerInput.isActive,
      })
      .returning();

    await this.cacheService.invalidate('cache:home:banners');
    const banner = toBanner(result!);

    await this.writeBannerAudit('create', banner.id, context, {
      changedFields: resolveBannerChangedFields(bannerInput),
      after: toBannerAuditSnapshot(banner),
    });

    return banner;
  }

  async updateBanner(
    id: string,
    input: Partial<CreateBannerInput>,
    context?: BannerMutationContext,
  ): Promise<Banner> {
    const bannerInput = validateUpdateBannerInput(input);
    const updateData: Record<string, unknown> = {};
    if (bannerInput.imageUrl !== undefined) updateData['imageUrl'] = bannerInput.imageUrl;
    if (bannerInput.linkUrl !== undefined) updateData['linkUrl'] = bannerInput.linkUrl;
    if (bannerInput.placement !== undefined) updateData['placement'] = bannerInput.placement;
    if (bannerInput.deviceTarget !== undefined) updateData['deviceTarget'] = bannerInput.deviceTarget;
    if (bannerInput.startsAt !== undefined) {
      updateData['startsAt'] = parseOptionalIsoDate(bannerInput.startsAt);
    }
    if (bannerInput.endsAt !== undefined) {
      updateData['endsAt'] = parseOptionalIsoDate(bannerInput.endsAt);
    }
    if (bannerInput.status !== undefined) updateData['status'] = bannerInput.status;
    if (bannerInput.sortOrder !== undefined) updateData['sortOrder'] = bannerInput.sortOrder;
    if (bannerInput.isActive !== undefined) updateData['isActive'] = bannerInput.isActive;
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
    const banner = toBanner(result);

    await this.writeBannerAudit('update', id, context, {
      changedFields: resolveBannerChangedFields(bannerInput),
      after: toBannerAuditSnapshot(banner),
    });

    return banner;
  }

  async deleteBanner(id: string, context?: BannerMutationContext): Promise<void> {
    await this.db.delete(banners).where(eq(banners.id, id));
    await this.cacheService.invalidate('cache:home:banners');

    await this.writeBannerAudit('delete', id, context, {
      changedFields: ['deleted'],
      after: { deleted: true },
    });
  }

  async listBanners(): Promise<Banner[]> {
    const rows = await this.db
      .select()
      .from(banners)
      .orderBy(banners.sortOrder);

    return rows.map(toBanner);
  }

  async reorderBanners(
    orderedIds: string[],
    context?: BannerMutationContext,
  ): Promise<void> {
    if (orderedIds.length === 0) {
      throw new BadRequestException('배너 순서를 변경할 ID가 필요합니다');
    }

    await this.db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(banners)
          .set({ sortOrder: i })
          .where(eq(banners.id, orderedIds[i]!));
      }
    });
    await this.cacheService.invalidate('cache:home:banners');

    await this.writeBannerAudit('reorder', 'bulk-reorder', context, {
      changedFields: ['sortOrder'],
      after: { orderedIds },
    });
  }

  private async writeBannerAudit(
    reason: 'create' | 'update' | 'delete' | 'reorder',
    resourceId: string,
    context: BannerMutationContext | undefined,
    diff: {
      changedFields: string[];
      before?: Record<string, unknown>;
      after: Record<string, unknown>;
    },
  ): Promise<void> {
    if (!context) {
      return;
    }

    await this.adminAuditService.write({
      actorUserId: context.actorUserId,
      action: 'banner.manage',
      resourceType: 'banner',
      resourceId,
      status: 'success',
      reason,
      changedFields: diff.changedFields,
      before: diff.before ?? {},
      after: diff.after,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
  }
}

function validateCreateBannerInput(
  input: CreateBannerInput,
): NormalizedCreateBannerInput {
  const parsed = createBannerSchema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException('배너 입력이 올바르지 않습니다');
  }
  return parsed.data;
}

function validateUpdateBannerInput(
  input: Partial<CreateBannerInput>,
): Partial<CreateBannerInput> {
  validateOptionalUrl(input.imageUrl, '배너 이미지 URL');
  validateOptionalUrl(input.linkUrl, '배너 링크 URL');
  validateOptionalEnum(input.placement, BANNER_PLACEMENTS, '배너 위치');
  validateOptionalEnum(input.deviceTarget, BANNER_DEVICE_TARGETS, '배너 기기');
  validateOptionalEnum(input.status, BANNER_STATUSES, '배너 상태');
  validateOptionalIsoDate(input.startsAt, '배너 시작 시각');
  validateOptionalIsoDate(input.endsAt, '배너 종료 시각');

  if (
    input.startsAt
    && input.endsAt
    && Date.parse(input.endsAt) < Date.parse(input.startsAt)
  ) {
    throw new BadRequestException('배너 종료 시각은 시작 시각보다 빠를 수 없습니다');
  }
  if (
    input.sortOrder !== undefined
    && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)
  ) {
    throw new BadRequestException('배너 정렬 순서는 0 이상의 정수여야 합니다');
  }
  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') {
    throw new BadRequestException('배너 활성 상태가 올바르지 않습니다');
  }

  return input;
}

function validateOptionalUrl(
  value: string | null | undefined,
  label: string,
): void {
  if (value === undefined || value === null) return;
  try {
    new URL(value);
  } catch {
    throw new BadRequestException(`${label}이 올바르지 않습니다`);
  }
}

function validateOptionalEnum<T extends readonly string[]>(
  value: string | undefined,
  allowedValues: T,
  label: string,
): void {
  if (value === undefined) return;
  if (!allowedValues.includes(value)) {
    throw new BadRequestException(`${label} 값이 올바르지 않습니다`);
  }
}

function validateOptionalIsoDate(
  value: string | null | undefined,
  label: string,
): void {
  if (value === undefined || value === null) return;
  if (Number.isNaN(Date.parse(value))) {
    throw new BadRequestException(`${label}은 ISO datetime 형식이어야 합니다`);
  }
}

function resolveBannerChangedFields(input: Partial<CreateBannerInput>): string[] {
  return sanitizeChangedFields(Object.keys(input));
}

function toBanner(row: BannerRow): Banner {
  return {
    id: row.id,
    imageUrl: row.imageUrl,
    linkUrl: row.linkUrl,
    placement: row.placement,
    deviceTarget: row.deviceTarget,
    status: row.status,
    startsAt: toOptionalIsoString(row.startsAt),
    endsAt: toOptionalIsoString(row.endsAt),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

function toBannerAuditSnapshot(banner: Banner): Record<string, unknown> {
  return {
    id: banner.id,
    imageUrl: banner.imageUrl,
    linkUrl: banner.linkUrl,
    placement: banner.placement,
    deviceTarget: banner.deviceTarget,
    status: banner.status,
    startsAt: banner.startsAt,
    endsAt: banner.endsAt,
    sortOrder: banner.sortOrder,
    isActive: banner.isActive,
  };
}

function resolveUpdateChangedFields(input: UpdatePerformanceInput): string[] {
  return sanitizeChangedFields([
    ...Object.keys(input),
    ...(input.venueName !== undefined ? ['venueName'] : []),
    ...(input.venueAddress !== undefined ? ['venueAddress'] : []),
    ...(input.venueAccessNotes !== undefined ? ['venueAccessNotes'] : []),
    ...(input.transportSummary !== undefined ? ['transportSummary'] : []),
  ]);
}

function sanitizeChangedFields(fields: readonly string[]): string[] {
  return [...new Set(fields.map((field) => field.trim()).filter(Boolean))];
}

function buildUpdateAuditSnapshot(
  input: UpdatePerformanceInput,
  response: PerformanceWithDetails,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};

  for (const field of resolveUpdateChangedFields(input)) {
    if (field === 'venueName') {
      snapshot[field] = input.venueName ?? response.venue?.name ?? null;
      continue;
    }
    if (field === 'venueAddress') {
      snapshot[field] = input.venueAddress ?? response.venue?.address ?? null;
      continue;
    }
    if (field === 'venueAccessNotes') {
      snapshot[field] =
        input.venueAccessNotes ?? response.venue?.accessNotes ?? null;
      continue;
    }
    if (field === 'transportSummary') {
      snapshot[field] =
        input.transportSummary ?? response.venue?.transportSummary ?? null;
      continue;
    }

    if (Object.hasOwn(input, field)) {
      snapshot[field] = input[field as keyof UpdatePerformanceInput];
    }
  }

  return snapshot;
}

function getMissingRequiredPublishContent(
  checklist: EventPublishContentChecklist,
): string[] {
  const missing: string[] = [];

  if (!checklist.ko.title) missing.push('ko.title');
  if (!checklist.ko.description) missing.push('ko.description');
  if (!checklist.en.title) missing.push('en.title');
  if (!checklist.en.description) missing.push('en.description');

  return missing;
}
