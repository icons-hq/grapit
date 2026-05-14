import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, type SQL } from 'drizzle-orm';

import {
  adminSeatOperationShowtimeIdSchema,
  type AdminSeatOperationHistory,
  type AdminSeatOperationRequest,
  type SeatState,
} from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  seatInventories,
  seatOperationHistory,
} from '../../database/schema/index.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import { AdminAuditService } from './admin-audit.service.js';

type SeatOperationAction = Extract<
  AdminSeatOperationRequest['operation'],
  'seat.disable' | 'seat.reactivate'
>;
type SeatInventoryStatus = typeof seatInventories.$inferSelect.status;
type AdminSeatOperationNextStatus = Extract<SeatState, 'available' | 'disabled'>;

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
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly adminAuditService: AdminAuditService,
    private readonly bookingGateway: BookingGateway,
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

      if (!seat) {
        throw new NotFoundException('좌석을 찾을 수 없습니다');
      }

      const nextStatus = resolveNextStatus(action, seat.status);
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
            seatStatus: seat.status,
          },
          after: {
            seatStatus: nextStatus,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
        tx,
      );

      const [updated] = await tx
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
        .returning({ id: seatInventories.id });

      if (!updated) {
        throw new BadRequestException('좌석 상태가 변경되었습니다. 새로고침 후 다시 시도해주세요');
      }

      const [history] = await tx
        .insert(seatOperationHistory)
        .values({
          actorUserId,
          action,
          showtimeId,
          seatInventoryId: seat.id,
          seatId: seat.seatId,
          floorKey: seat.floorKey,
          seatKey: seat.seatKey,
          previousStatus: seat.status,
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
        seatKey: seat.seatKey,
        previousStatus: seat.status,
        nextStatus,
        reason,
        actorUserId,
        createdAt: now.toISOString(),
      };
    });

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
