import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type {
  PerformanceBookingPolicy,
  PerformanceBookingPolicyInput,
  PerformanceSeatMapInput,
  SeatMap,
  SeatMapConfig,
} from '@grabit/shared';

import type { DrizzleDB } from '../../database/drizzle.provider.js';
import {
  bookingPolicies,
  performanceSeatAssignments,
  performanceSeatTiers,
  performances,
  priceTiers,
  reservations,
  seatMaps,
  showtimes,
  venueLayoutFloors,
  venueLayouts,
  venueLayoutSeats,
} from '../../database/schema/index.js';
import { parseAdminKstDateTime } from './admin-date.util.js';

type ShowtimeUpdateInput = {
  showtimeId?: string;
  dateTime: string;
};

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
export class PerformanceIntakeService {
  normalizeSeatMaps(
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

  assertUniqueFloorKeys(floors: PerformanceSeatMapInput[]): void {
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

  assertUniquePriceTierNames(
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

  async loadPriceTierNames(
    tx: DrizzleDB,
    performanceId: string,
  ): Promise<Set<string>> {
    const snapshots = await this.loadPriceTierSnapshots(tx, performanceId);
    return new Set(snapshots.map((row) => row.tierName));
  }

  async loadPriceTierSnapshots(
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

  priceTierSnapshotsFromInput(
    priceTierInputs: Array<{ tierName: string; price: number; sortOrder: number }>,
  ): PriceTierSnapshot[] {
    return priceTierInputs.map((tier) => ({
      tierName: tier.tierName.trim(),
      price: tier.price,
      sortOrder: tier.sortOrder,
    }));
  }

  async loadPerformanceVenueId(
    tx: DrizzleDB,
    performanceId: string,
  ): Promise<string | null> {
    const rows = await tx
      .select({ venueId: performances.venueId })
      .from(performances)
      .where(eq(performances.id, performanceId));

    return typeof rows[0]?.venueId === 'string' ? rows[0].venueId : null;
  }

  assertSeatMapConfigsValid(
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

  async persistBookingPolicy(
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
        bookingStartsAt: bookingPolicy.bookingStartsAt
          ? parseAdminKstDateTime(bookingPolicy.bookingStartsAt)
          : null,
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
          bookingStartsAt: bookingPolicy.bookingStartsAt
            ? parseAdminKstDateTime(bookingPolicy.bookingStartsAt)
            : null,
          updatedAt: new Date(),
        },
      })
      .returning();
  }

  async replaceSeatMaps(
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

  async syncShowtimes(
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

  private deriveSeatPosition(sourceSeatId: string): {
    rowLabel: string | null;
    seatNumber: string | null;
  } {
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
}
