import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, type SQL } from 'drizzle-orm';

import {
  adminSeatOperationShowtimeIdSchema,
  normalizeSeatIdentity,
  type AdminSeatOperationHistory,
  type AdminSeatOperationRequest,
  type SeatMapConfig,
  type SeatState,
} from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  seatMaps,
  seatInventories,
  seatOperationHistory,
  showtimes,
} from '../../database/schema/index.js';
import { BookingService } from '../booking/booking.service.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import { AdminAuditService } from './admin-audit.service.js';

type SeatOperationAction = Extract<
  AdminSeatOperationRequest['operation'],
  'seat.disable' | 'seat.reactivate'
>;
type SeatInventoryStatus = typeof seatInventories.$inferSelect.status;
type AdminSeatOperationNextStatus = Extract<SeatState, 'available' | 'disabled'>;
type SeatOperationIdentity = {
  floorKey: string;
  seatId: string;
  seatKey: string;
};
type SeatOperationInventoryRow = Pick<
  typeof seatInventories.$inferSelect,
  'id' | 'showtimeId' | 'seatId' | 'floorKey' | 'seatKey' | 'status'
>;

export interface AdminSeatOperationExecutionContext {
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AdminSeatOperationResult extends AdminSeatOperationHistory {
  historyId: string;
  auditEventId: string;
  previousStatus: SeatInventoryStatus;
  nextStatus: SeatInventoryStatus;
}

export interface AdminSeatOperationHistoryFilters {
  showtimeId: string;
  seatKey?: string;
  limit?: number;
}

export interface AdminSeatOperationHistoryResponse {
  rows: AdminSeatOperationHistory[];
}

@Injectable()
export class AdminSeatOperationsService {
  private readonly logger = new Logger(AdminSeatOperationsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly adminAuditService: AdminAuditService,
    private readonly bookingGateway: BookingGateway,
    private readonly bookingService?: BookingService,
  ) {}

  async performOperation(
    actorUserId: string,
    input: AdminSeatOperationRequest,
    context: AdminSeatOperationExecutionContext = {},
  ): Promise<AdminSeatOperationResult> {
    const showtimeId = parseSeatOperationShowtimeId(input.showtimeId);
    const action = assertSeatInventoryOperation(input.operation);
    const reason = input.reason.trim();
    if (!reason) {
      throw new BadRequestException('좌석 운영 사유를 입력해주세요');
    }
    if (input.confirmed !== true) {
      throw new BadRequestException('좌석 운영 확인이 필요합니다');
    }

    const now = context.now ?? new Date();
    const result = await this.db.transaction(async (tx) => {
      const [seat] = await tx
        .select({
          id: seatInventories.id,
          showtimeId: seatInventories.showtimeId,
          seatId: seatInventories.seatId,
          floorKey: seatInventories.floorKey,
          seatKey: seatInventories.seatKey,
          status: seatInventories.status,
        })
        .from(seatInventories)
        .where(
          and(
            eq(seatInventories.showtimeId, showtimeId),
            eq(seatInventories.seatKey, input.seatKey),
          ),
        )
        .limit(1);

      if (!seat && action !== 'seat.disable') {
        throw new NotFoundException('좌석을 찾을 수 없습니다');
      }

      const seatIdentity = parseSeatOperationSeatKey(input.seatKey);
      if (!seat) {
        await assertSeatExistsInShowtimeSeatMap(tx as DrizzleDB, showtimeId, seatIdentity);
      }

      const previousStatus = seat?.status ?? 'available';
      const nextStatus = resolveNextStatus(action, previousStatus);
      const audit = await this.adminAuditService.write(
        {
          actorUserId,
          action,
          resourceType: 'seat_inventory',
          resourceId: `${showtimeId}:${input.seatKey}`,
          status: 'success',
          reason,
          changedFields: ['seatStatus'],
          before: {
            seatStatus: previousStatus,
          },
          after: {
            seatStatus: nextStatus,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
        tx,
      );

      const inventory = seat
        ? await updateSeatInventoryStatus(tx as DrizzleDB, seat, nextStatus)
        : await createDisabledSeatInventory(tx as DrizzleDB, showtimeId, seatIdentity);

      const [history] = await tx
        .insert(seatOperationHistory)
        .values({
          actorUserId,
          action,
          showtimeId,
          seatInventoryId: inventory.id,
          seatId: inventory.seatId,
          floorKey: inventory.floorKey,
          seatKey: inventory.seatKey,
          previousStatus,
          nextStatus,
          reason,
          auditLogId: audit.id,
          reservationId: input.reservationId ?? null,
          createdAt: now,
        })
        .returning({ id: seatOperationHistory.id });

      return {
        id: history?.id ?? '',
        historyId: history?.id ?? '',
        auditEventId: audit.id,
        operation: action,
        showtimeId,
        seatInventoryId: inventory.id,
        seatId: inventory.seatId,
        floorKey: inventory.floorKey,
        seatKey: inventory.seatKey,
        previousStatus,
        nextStatus,
        reason,
        actorUserId,
        createdAt: now.toISOString(),
      };
    });

    if (result.nextStatus === 'disabled') {
      try {
        await this.bookingService?.forceReleaseSeatLock(result.showtimeId, result.seatKey);
      } catch (error) {
        this.logger.error(
          `Failed to force-release disabled seat lock. showtimeId=${result.showtimeId}, seatKey=${result.seatKey}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.bookingGateway.broadcastSeatUpdate(
      result.showtimeId,
      result.seatKey,
      result.nextStatus,
    );

    return result;
  }

  async listHistory(
    filters: AdminSeatOperationHistoryFilters,
  ): Promise<AdminSeatOperationHistoryResponse> {
    const showtimeId = parseSeatOperationShowtimeId(filters.showtimeId);

    const predicates: SQL[] = [
      eq(seatOperationHistory.showtimeId, showtimeId),
    ];
    if (filters.seatKey) {
      predicates.push(eq(seatOperationHistory.seatKey, filters.seatKey));
    }

    const rows = await this.db
      .select({
        id: seatOperationHistory.id,
        action: seatOperationHistory.action,
        showtimeId: seatOperationHistory.showtimeId,
        seatKey: seatOperationHistory.seatKey,
        previousStatus: seatOperationHistory.previousStatus,
        nextStatus: seatOperationHistory.nextStatus,
        reason: seatOperationHistory.reason,
        actorUserId: seatOperationHistory.actorUserId,
        auditLogId: seatOperationHistory.auditLogId,
        createdAt: seatOperationHistory.createdAt,
      })
      .from(seatOperationHistory)
      .where(and(...predicates))
      .orderBy(desc(seatOperationHistory.createdAt))
      .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200));

    return {
      rows: rows.map((row) => ({
        id: row.id,
        operation: row.action,
        showtimeId: row.showtimeId,
        seatKey: row.seatKey,
        previousStatus: row.previousStatus,
        nextStatus: row.nextStatus,
        reason: row.reason,
        actorUserId: row.actorUserId,
        auditEventId: row.auditLogId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}

function parseSeatOperationShowtimeId(showtimeId: string): string {
  const result = adminSeatOperationShowtimeIdSchema.safeParse(showtimeId);
  if (!result.success) {
    throw new BadRequestException('유효한 회차 ID가 필요합니다');
  }
  return result.data;
}

function assertSeatInventoryOperation(
  operation: AdminSeatOperationRequest['operation'],
): SeatOperationAction {
  if (operation === 'seat.disable' || operation === 'seat.reactivate') {
    return operation;
  }

  throw new BadRequestException('지원하지 않는 좌석 운영입니다');
}

function parseSeatOperationSeatKey(seatKey: string): SeatOperationIdentity {
  const identity = normalizeSeatIdentity({ seatId: seatKey });
  const { floorKey, seatId } = identity;

  if (!floorKey.trim() || !seatId.trim()) {
    throw new BadRequestException('유효한 좌석 키가 필요합니다');
  }

  return {
    floorKey,
    seatId,
    seatKey: identity.seatKey,
  };
}

async function assertSeatExistsInShowtimeSeatMap(
  db: DrizzleDB,
  showtimeId: string,
  seat: SeatOperationIdentity,
): Promise<void> {
  const [showtime] = await db
    .select({ performanceId: showtimes.performanceId })
    .from(showtimes)
    .where(eq(showtimes.id, showtimeId))
    .limit(1);

  if (!showtime) {
    throw new NotFoundException('좌석을 찾을 수 없습니다');
  }

  const [seatMap] = await db
    .select({ seatConfig: seatMaps.seatConfig })
    .from(seatMaps)
    .where(
      and(
        eq(seatMaps.performanceId, showtime.performanceId),
        eq(seatMaps.floorKey, seat.floorKey),
      ),
    )
    .limit(1);

  if (!seatMapHasSeatId(seatMap?.seatConfig, seat.seatId)) {
    throw new NotFoundException('좌석을 찾을 수 없습니다');
  }
}

function seatMapHasSeatId(seatConfig: unknown, seatId: string): boolean {
  if (!seatConfig || typeof seatConfig !== 'object') {
    return false;
  }

  const tiers = (seatConfig as SeatMapConfig).tiers;
  return Array.isArray(tiers)
    && tiers.some((tier) =>
      Boolean(
        tier
        && Array.isArray(tier.seatIds)
        && tier.seatIds.includes(seatId),
      ),
    );
}

async function updateSeatInventoryStatus(
  db: DrizzleDB,
  seat: SeatOperationInventoryRow,
  nextStatus: AdminSeatOperationNextStatus,
): Promise<SeatOperationInventoryRow> {
  const [updated] = await db
    .update(seatInventories)
    .set({
      status: nextStatus,
      lockedBy: null,
      lockedUntil: null,
      soldAt: null,
      heldCancelledAt: null,
      reopenHoldUntil: null,
      reopenJobId: null,
    })
    .where(
      and(
        eq(seatInventories.id, seat.id),
        eq(seatInventories.status, seat.status),
      ),
    )
    .returning({
      id: seatInventories.id,
      showtimeId: seatInventories.showtimeId,
      seatId: seatInventories.seatId,
      floorKey: seatInventories.floorKey,
      seatKey: seatInventories.seatKey,
      status: seatInventories.status,
    });

  if (!updated) {
    throw new BadRequestException('좌석 상태가 변경되었습니다. 새로고침 후 다시 시도해주세요');
  }

  return {
    ...seat,
    ...updated,
    status: nextStatus,
  };
}

async function createDisabledSeatInventory(
  db: DrizzleDB,
  showtimeId: string,
  seat: SeatOperationIdentity,
): Promise<SeatOperationInventoryRow> {
  const [created] = await db
    .insert(seatInventories)
    .values({
      showtimeId,
      seatId: seat.seatId,
      floorKey: seat.floorKey,
      seatKey: seat.seatKey,
      status: 'disabled',
    })
    .onConflictDoNothing()
    .returning({
      id: seatInventories.id,
      showtimeId: seatInventories.showtimeId,
      seatId: seatInventories.seatId,
      floorKey: seatInventories.floorKey,
      seatKey: seatInventories.seatKey,
      status: seatInventories.status,
    });

  if (!created) {
    throw new BadRequestException('좌석 상태가 변경되었습니다. 새로고침 후 다시 시도해주세요');
  }

  return created;
}

function resolveNextStatus(
  action: SeatOperationAction,
  currentStatus: SeatInventoryStatus,
): AdminSeatOperationNextStatus {
  if (action === 'seat.disable') {
    if (currentStatus === 'disabled') {
      throw new BadRequestException('이미 비활성화된 좌석입니다');
    }
    if (currentStatus !== 'available') {
      throw new BadRequestException('판매 가능 좌석만 비활성화할 수 있습니다');
    }
    return 'disabled';
  }

  if (currentStatus !== 'disabled') {
    throw new BadRequestException('비활성화된 좌석만 재활성화할 수 있습니다');
  }
  return 'available';
}
