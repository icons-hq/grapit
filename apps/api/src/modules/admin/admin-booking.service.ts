import {
  Injectable,
  Inject,
  BadRequestException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { asc, eq, and, sql, ilike, or, desc, inArray, gte, lte, ne, type SQL } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  reservations,
  reservationSeats,
  payments,
  showtimes,
  performances,
  users,
  seatInventories,
  bookingPolicies,
  bookingOperationAuditLogs,
  ticketItems,
} from '../../database/schema/index.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import { RefundService } from '../refund/refund.service.js';
import { safeCsvRows } from './csv-export.util.js';
import { AdminAuditService } from './admin-audit.service.js';
import { normalizeSeatIdentity, toFloorAwareSeatSelection } from '@grabit/shared';
import type {
  AdminBookingListItem,
  AdminReservationExportFilter,
  BookingStats,
  FloorAwareSeatSelection,
  PaymentStatus,
  ReservationStatus,
} from '@grabit/shared';

const RAW_EXPORT_TYPE = 'raw_pii';
const RESERVATION_EXPORT_HEADERS = [
  'Reservation Number',
  'User Name',
  'User Email',
  'User Phone',
  'Audience Region',
  'Performance Title',
  'Show DateTime',
  'Tier',
  'Seat',
  'Payment Method',
  'Payment Status',
  'Total Amount',
  'Reservation Status',
  'Reserved At',
  'Ticket Item ID',
  'Ticket Item Status',
  'Admission State',
  'Entered At',
  'Cancelled At',
  'Cancel Reason',
  'Ticket Price',
  'Service Fee',
  'Cancellation Fee',
  'Service Fee Refund',
  'Refundable Amount',
  'Reopen State',
] as const;

export interface ReservationExportRequest {
  actorUserId: string;
  filters: AdminReservationExportFilter;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ReservationExportResult {
  filename: string;
  contentType: 'text/csv; charset=utf-8';
  csv: string;
  rowCount: number;
}

type AdminTicketItemStatus =
  | 'ACTIVE'
  | 'CANCELLATION_PENDING'
  | 'CANCELLED'
  | 'EXPIRED';

type AdminTicketItemAdmissionState = 'NOT_ENTERED' | 'ENTERED';

type AdminTicketItemReopenState =
  | 'NOT_REQUIRED'
  | 'HELD_CANCELLED'
  | 'AVAILABLE'
  | 'MANUAL_OPENED';

type AdminPaymentInfo = {
  paymentKey: string;
  method: string;
  amount: number;
  status: PaymentStatus;
  paidAt: string | null;
};

type AdminTicketItemDto = FloorAwareSeatSelection & {
  id: string;
  reservationId: string;
  paymentId: string;
  showtimeId: string;
  serviceFee: number;
  status: AdminTicketItemStatus;
  admissionState: AdminTicketItemAdmissionState;
  enteredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancellationFee: number;
  serviceFeeRefund: number;
  refundableAmount: number;
  reopenState: AdminTicketItemReopenState;
  reopenHoldUntil: string | null;
};

type AdminBookingDetailDto = AdminBookingListItem & {
  paymentInfo: AdminPaymentInfo;
  ticketItems: AdminTicketItemDto[];
};

type AdminTicketItemRow = Pick<
  typeof ticketItems.$inferSelect,
  | 'id'
  | 'reservationId'
  | 'paymentId'
  | 'showtimeId'
  | 'seatId'
  | 'seatKey'
  | 'floorKey'
  | 'floorLabel'
  | 'tierName'
  | 'row'
  | 'number'
  | 'price'
  | 'serviceFee'
  | 'status'
  | 'admissionState'
  | 'enteredAt'
  | 'cancelledAt'
  | 'cancelReason'
  | 'cancellationFee'
  | 'serviceFeeRefund'
  | 'refundableAmount'
  | 'reopenState'
  | 'reopenHoldUntil'
>;

type ReservationExportRow = {
  reservation: {
    id: string;
    reservationNumber: string;
    status: string;
    totalAmount: number;
    createdAt: Date | null;
  };
  user: {
    name: string;
    email: string;
    phone: string;
    country: string;
  };
  showtime: {
    dateTime: Date | null;
  };
  performance: {
    id: string;
    title: string;
  };
  ticketItem: AdminTicketItemRow;
  payment: {
    method: string | null;
    status: string | null;
    paidAt: Date | null;
  } | null;
};

function normalizeReservationSeatIdentity(seatId: string): {
  floorKey: string;
  seatId: string;
  seatKey: string;
} {
  const identity = normalizeSeatIdentity({ seatId });
  return {
    floorKey: identity.floorKey,
    seatId: identity.seatId,
    seatKey: identity.seatKey,
  };
}

@Injectable()
export class AdminBookingService {
  private readonly logger = new Logger(AdminBookingService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly bookingGateway: BookingGateway,
    private readonly refundService: RefundService,
    @Optional() private readonly injectedAuditService?: AdminAuditService,
  ) {}

  private get auditService(): AdminAuditService {
    return this.injectedAuditService ?? new AdminAuditService(this.db);
  }

  async getBookings(params: {
    status?: string;
    search?: string;
    page?: number;
  }): Promise<{ bookings: AdminBookingListItem[]; stats: BookingStats; total: number }> {
    const { status, search, page = 1 } = params;
    const limit = 20;
    const offset = (page - 1) * limit;

    // Stats: total bookings
    const [totalResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations);

    // Stats: total revenue (CONFIRMED only)
    const [revenueResult] = await this.db
      .select({ sum: sql<number>`coalesce(sum(${reservations.totalAmount}), 0)::int` })
      .from(reservations)
      .where(eq(reservations.status, 'CONFIRMED'));

    // Stats: cancelled count
    const [cancelledResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(eq(reservations.status, 'CANCELLED'));

    const totalBookings = totalResult?.count ?? 0;
    const totalRevenue = revenueResult?.sum ?? 0;
    const cancelledCount = cancelledResult?.count ?? 0;
    const cancelRate = totalBookings > 0
      ? Math.round((cancelledCount / totalBookings) * 100)
      : 0;

    // Build filter conditions for list
    const conditions: ReturnType<typeof eq>[] = [];
    if (status) {
      conditions.push(
        eq(reservations.status, status as typeof reservations.status.enumValues[number]),
      );
    }
    if (search) {
      conditions.push(
        or(
          ilike(reservations.reservationNumber, `%${search}%`),
          ilike(users.name, `%${search}%`),
        )!,
      );
    }

    const whereClause = conditions.length > 0
      ? and(...conditions)
      : undefined;

    const rows = await this.db
      .select({
        reservation: {
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          status: reservations.status,
          totalAmount: reservations.totalAmount,
          createdAt: reservations.createdAt,
        },
        user: {
          name: users.name,
          phone: users.phone,
        },
        showtime: {
          dateTime: showtimes.dateTime,
        },
        performance: {
          title: performances.title,
        },
      })
      .from(reservations)
      .innerJoin(users, eq(reservations.userId, users.id))
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .where(whereClause)
      .orderBy(desc(reservations.createdAt))
      .limit(limit)
      .offset(offset);

    // Batch-fetch all ticket items for all reservations (eliminates N+1)
    const reservationIds = rows.map((r) => r.reservation.id);
    const allTicketItems = reservationIds.length > 0
      ? await this.db
          .select()
          .from(ticketItems)
          .where(inArray(ticketItems.reservationId, reservationIds))
          .orderBy(asc(ticketItems.createdAt), asc(ticketItems.id))
      : [];
    const ticketItemsByReservation = new Map<string, typeof allTicketItems>();
    for (const ticketItem of allTicketItems) {
      const existing = ticketItemsByReservation.get(ticketItem.reservationId) ?? [];
      existing.push(ticketItem);
      ticketItemsByReservation.set(ticketItem.reservationId, existing);
    }
    const reservationIdsWithoutTicketItems = reservationIds.filter(
      (reservationId) => (ticketItemsByReservation.get(reservationId)?.length ?? 0) === 0,
    );
    const allReservationSeats = reservationIdsWithoutTicketItems.length > 0
      ? await this.db
          .select()
          .from(reservationSeats)
          .where(inArray(reservationSeats.reservationId, reservationIdsWithoutTicketItems))
          .orderBy(asc(reservationSeats.id))
      : [];
    const reservationSeatsByReservation = new Map<string, typeof allReservationSeats>();
    for (const reservationSeat of allReservationSeats) {
      const existing = reservationSeatsByReservation.get(reservationSeat.reservationId) ?? [];
      existing.push(reservationSeat);
      reservationSeatsByReservation.set(reservationSeat.reservationId, existing);
    }

    const bookings: AdminBookingListItem[] = rows.map((row) => {
      const reservationTicketItems = ticketItemsByReservation.get(row.reservation.id) ?? [];
      const reservationSeatsFallback = reservationSeatsByReservation.get(row.reservation.id) ?? [];
      return {
        id: row.reservation.id,
        reservationNumber: row.reservation.reservationNumber,
        userName: row.user.name,
        userPhone: row.user.phone,
        performanceTitle: row.performance.title,
        showDateTime: row.showtime.dateTime?.toISOString() ?? '',
        seats: reservationTicketItems.length > 0
          ? reservationTicketItems.map(mapTicketItemToSeatSelection)
          : reservationSeatsFallback.map(mapReservationSeatToSeatSelection),
        totalAmount: row.reservation.totalAmount,
        status: row.reservation.status as ReservationStatus,
        createdAt: row.reservation.createdAt?.toISOString() ?? '',
      };
    });

    return {
      bookings,
      stats: { totalBookings, totalRevenue, cancelRate },
      total: totalBookings,
    };
  }

  async getBookingDetail(reservationId: string): Promise<AdminBookingDetailDto> {
    const [row] = await this.db
      .select({
        reservation: {
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          status: reservations.status,
          totalAmount: reservations.totalAmount,
          createdAt: reservations.createdAt,
        },
        user: {
          name: users.name,
          phone: users.phone,
        },
        showtime: {
          dateTime: showtimes.dateTime,
        },
        performance: {
          title: performances.title,
        },
      })
      .from(reservations)
      .innerJoin(users, eq(reservations.userId, users.id))
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .where(eq(reservations.id, reservationId));

    if (!row) {
      throw new NotFoundException('예매를 찾을 수 없습니다');
    }

    const reservationTicketItems = await this.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.reservationId, reservationId))
      .orderBy(asc(ticketItems.createdAt), asc(ticketItems.id));

    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.reservationId, reservationId));

    return {
      id: row.reservation.id,
      reservationNumber: row.reservation.reservationNumber,
      userName: row.user.name,
      userPhone: row.user.phone,
      performanceTitle: row.performance.title,
      showDateTime: row.showtime.dateTime?.toISOString() ?? '',
      seats: reservationTicketItems.map(mapTicketItemToSeatSelection),
      totalAmount: row.reservation.totalAmount,
      status: row.reservation.status as ReservationStatus,
      createdAt: row.reservation.createdAt?.toISOString() ?? '',
      ticketItems: reservationTicketItems.map(mapTicketItemToAdminTicketItem),
      paymentInfo: payment
        ? {
            paymentKey: payment.paymentKey,
            method: payment.method,
            amount: payment.amount,
            status: payment.status as PaymentStatus,
            paidAt: payment.paidAt?.toISOString() ?? null,
          }
        : {
            paymentKey: '',
            method: '',
            amount: 0,
            status: 'READY' as PaymentStatus,
            paidAt: null,
          },
    };
  }

  async refundBooking(
    reservationId: string,
    operatorUserId: string,
    reason: string,
  ): Promise<void> {
    try {
      const refundResult = await this.refundService.requestAdminRefund(
        reservationId,
        operatorUserId,
        reason,
      );

      await this.auditService.write({
        actorUserId: operatorUserId,
        action: 'refund.admin_refund',
        resourceType: 'reservation',
        resourceId: reservationId,
        status: 'success',
        reason,
        changedFields: ['refund'],
        before: {},
        after: {
          refund: {
            idempotent: refundResult.idempotent,
            retryEnqueued: refundResult.retryEnqueued,
            currentState: refundResult.refundTimeline?.currentState ?? null,
          },
        },
      });
    } catch (error) {
      await this.auditService.write({
        actorUserId: operatorUserId,
        action: 'refund.admin_refund',
        resourceType: 'reservation',
        resourceId: reservationId,
        status: 'failed',
        reason,
        changedFields: ['refund'],
        before: {},
        after: {
          refund: {
            error: error instanceof Error ? error.message : 'unknown',
          },
        },
      }).catch((auditError: unknown) => {
        this.logger.warn(
          `Failed to write admin refund failure audit for reservationId=${reservationId}: ${
            auditError instanceof Error ? auditError.message : 'unknown'
          }`,
        );
      });
      throw error;
    }
  }

  async exportReservations(
    request: ReservationExportRequest,
  ): Promise<ReservationExportResult> {
    const reason = request.filters.reason?.trim();
    if (!reason) {
      throw new BadRequestException('원본 CSV 내보내기 사유를 입력해주세요');
    }

    if (
      request.filters.dateFrom
      && request.filters.dateTo
      && request.filters.dateFrom > request.filters.dateTo
    ) {
      throw new BadRequestException('조회 종료일은 시작일 이후여야 합니다');
    }

    const filters = {
      ...request.filters,
      exportType: RAW_EXPORT_TYPE,
      reason,
    } satisfies AdminReservationExportFilter;

    const rows = await this.selectReservationExportRows(filters);
    const csv = safeCsvRows([
      RESERVATION_EXPORT_HEADERS,
      ...rows.map((row) => reservationExportRowToCsvValues(row)),
    ]);

    await this.auditService.write({
      actorUserId: request.actorUserId,
      action: 'reservations.export_raw',
      resourceType: 'reservation_export',
      resourceId: RAW_EXPORT_TYPE,
      status: 'success',
      reason,
      changedFields: ['exportType', 'filters', 'rowCount'],
      before: {},
      after: {
        exportType: RAW_EXPORT_TYPE,
        filters: reservationExportFiltersForAudit(filters),
        rowCount: rows.length,
      },
      ipAddress: request.ipAddress ?? null,
      userAgent: request.userAgent ?? null,
    });

    return {
      filename: `reservation-export-raw-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv; charset=utf-8',
      csv,
      rowCount: rows.length,
    };
  }

  private async selectReservationExportRows(
    filters: AdminReservationExportFilter,
  ): Promise<ReservationExportRow[]> {
    const conditions: SQL[] = [];

    if (filters.eventId) {
      conditions.push(eq(performances.id, filters.eventId));
    }
    if (filters.tierName) {
      conditions.push(eq(ticketItems.tierName, filters.tierName));
    }
    if (filters.zoneFloor) {
      conditions.push(
        or(
          eq(ticketItems.floorKey, filters.zoneFloor),
          ilike(ticketItems.seatKey, `${filters.zoneFloor}:%`),
        )!,
      );
    }
    if (filters.reservationStatus) {
      conditions.push(eq(reservations.status, filters.reservationStatus));
    }
    if (filters.audienceRegion === 'domestic') {
      conditions.push(eq(users.country, 'KR'));
    }
    if (filters.audienceRegion === 'overseas') {
      conditions.push(ne(users.country, 'KR'));
    }
    if (filters.paymentMethod) {
      conditions.push(eq(payments.method, filters.paymentMethod));
    }
    if (filters.dateFrom) {
      conditions.push(gte(reservations.createdAt, dateOnlyStart(filters.dateFrom)));
    }
    if (filters.dateTo) {
      conditions.push(lte(reservations.createdAt, dateOnlyEnd(filters.dateTo)));
    }

    return this.db
      .select({
        reservation: {
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          status: reservations.status,
          totalAmount: reservations.totalAmount,
          createdAt: reservations.createdAt,
        },
        user: {
          name: users.name,
          email: users.email,
          phone: users.phone,
          country: users.country,
        },
        showtime: {
          dateTime: showtimes.dateTime,
        },
        performance: {
          id: performances.id,
          title: performances.title,
        },
        ticketItem: {
          id: ticketItems.id,
          reservationId: ticketItems.reservationId,
          paymentId: ticketItems.paymentId,
          showtimeId: ticketItems.showtimeId,
          seatId: ticketItems.seatId,
          seatKey: ticketItems.seatKey,
          floorKey: ticketItems.floorKey,
          floorLabel: ticketItems.floorLabel,
          tierName: ticketItems.tierName,
          row: ticketItems.row,
          number: ticketItems.number,
          price: ticketItems.price,
          serviceFee: ticketItems.serviceFee,
          status: ticketItems.status,
          admissionState: ticketItems.admissionState,
          enteredAt: ticketItems.enteredAt,
          cancelledAt: ticketItems.cancelledAt,
          cancelReason: ticketItems.cancelReason,
          cancellationFee: ticketItems.cancellationFee,
          serviceFeeRefund: ticketItems.serviceFeeRefund,
          refundableAmount: ticketItems.refundableAmount,
          reopenState: ticketItems.reopenState,
          reopenHoldUntil: ticketItems.reopenHoldUntil,
        },
        payment: {
          method: payments.method,
          status: payments.status,
          paidAt: payments.paidAt,
        },
      })
      .from(reservations)
      .innerJoin(users, eq(reservations.userId, users.id))
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .innerJoin(ticketItems, eq(ticketItems.reservationId, reservations.id))
      .leftJoin(payments, eq(payments.reservationId, reservations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(reservations.createdAt), asc(ticketItems.createdAt), asc(ticketItems.id));
  }

  async manualOpen(
    reservationId: string,
    operatorUserId: string,
    reason: string,
  ): Promise<void> {
    const auditReason = reason.trim();
    if (!auditReason) {
      throw new BadRequestException('좌석 운영 사유를 입력해주세요');
    }

    const [context] = await this.db
      .select({
        reservation: {
          id: reservations.id,
          showtimeId: reservations.showtimeId,
          status: reservations.status,
        },
        bookingPolicy: {
          manualOpenEnabled: bookingPolicies.manualOpenEnabled,
        },
      })
      .from(reservations)
      .innerJoin(showtimes, eq(showtimes.id, reservations.showtimeId))
      .leftJoin(bookingPolicies, eq(bookingPolicies.performanceId, showtimes.performanceId))
      .where(eq(reservations.id, reservationId));

    if (!context) {
      throw new NotFoundException('예매를 찾을 수 없습니다');
    }

    if (context.reservation.status !== 'CANCELLED') {
      throw new BadRequestException('수동 오픈은 취소된 예매에만 사용할 수 있습니다');
    }

    if (context.bookingPolicy?.manualOpenEnabled === false) {
      throw new BadRequestException('수동 오픈이 비활성화된 공연입니다');
    }

    const seats = await this.db
      .select({ seatId: reservationSeats.seatId })
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservationId));

    if (seats.length === 0) {
      throw new NotFoundException('오픈할 좌석을 찾을 수 없습니다');
    }

    const now = new Date();
    const seatIdentities = seats.map((seat) =>
      normalizeReservationSeatIdentity(seat.seatId),
    );
    const beforeSeatStatus = seatIdentities.map((seatIdentity) => ({
      seatKey: seatIdentity.seatKey,
      status: 'held_cancelled',
    }));
    const afterSeatStatus = seatIdentities.map((seatIdentity) => ({
      seatKey: seatIdentity.seatKey,
      status: 'available',
    }));

    await this.db.transaction(async (tx) => {
      await tx.insert(bookingOperationAuditLogs).values(
        seatIdentities.map((seatIdentity) => ({
          operatorUserId,
          action: 'manual_open' as const,
          seatKey: seatIdentity.seatKey,
          reservationId,
          createdAt: now,
        })),
      );

      await this.auditService.write(
        {
          actorUserId: operatorUserId,
          action: 'seat.manual_open',
          resourceType: 'reservation',
          resourceId: reservationId,
          status: 'success',
          reason: auditReason,
          changedFields: ['seatStatus'],
          before: {
            seatStatus: beforeSeatStatus,
          },
          after: {
            seatStatus: afterSeatStatus,
          },
        },
        tx,
      );

      for (const seatIdentity of seatIdentities) {
        await tx
          .update(seatInventories)
          .set({
            status: 'available',
            lockedBy: null,
            lockedUntil: null,
            soldAt: null,
            heldCancelledAt: null,
            reopenHoldUntil: null,
            reopenJobId: null,
          })
          .where(
            and(
              eq(seatInventories.showtimeId, context.reservation.showtimeId),
              eq(seatInventories.floorKey, seatIdentity.floorKey),
              eq(seatInventories.seatKey, seatIdentity.seatKey),
              eq(seatInventories.status, 'held_cancelled'),
            ),
          );
      }
    });

    for (const seat of seats) {
      this.bookingGateway.broadcastSeatUpdate(
        context.reservation.showtimeId,
        seat.seatId,
        'available',
      );
    }

    this.logger.log(
      `Manual open completed for reservationId=${reservationId}, operatorUserId=${operatorUserId}, seats=${seatIdentities.length}`,
    );
  }
}

function reservationExportRowToCsvValues(row: ReservationExportRow): readonly unknown[] {
  const audienceRegion = row.user.country === 'KR' ? 'domestic' : 'overseas';
  const ticketItem = mapTicketItemToAdminTicketItem(row.ticketItem);

  return [
    row.reservation.reservationNumber,
    row.user.name,
    row.user.email,
    row.user.phone,
    audienceRegion,
    row.performance.title,
    row.showtime.dateTime?.toISOString() ?? '',
    row.ticketItem.tierName,
    row.ticketItem.seatKey,
    row.payment?.method ?? '',
    row.payment?.status ?? '',
    row.reservation.totalAmount,
    row.reservation.status,
    row.reservation.createdAt?.toISOString() ?? '',
    ticketItem.id,
    ticketItem.status,
    ticketItem.admissionState,
    ticketItem.enteredAt ?? '',
    ticketItem.cancelledAt ?? '',
    ticketItem.cancelReason ?? '',
    ticketItem.price,
    ticketItem.serviceFee,
    ticketItem.cancellationFee,
    ticketItem.serviceFeeRefund,
    ticketItem.refundableAmount,
    ticketItem.reopenState,
  ];
}

function mapTicketItemToSeatSelection(item: AdminTicketItemRow): FloorAwareSeatSelection {
  return {
    seatId: item.seatId,
    seatKey: item.seatKey,
    floorKey: item.floorKey,
    floorLabel: item.floorLabel,
    tierName: item.tierName,
    price: item.price,
    row: item.row,
    number: item.number,
  };
}

function mapReservationSeatToSeatSelection(
  seat: typeof reservationSeats.$inferSelect,
): FloorAwareSeatSelection {
  return toFloorAwareSeatSelection({
    seatId: seat.seatId,
    tierName: seat.tierName,
    price: seat.price,
    row: seat.row,
    number: seat.number,
  });
}

function mapTicketItemToAdminTicketItem(item: AdminTicketItemRow): AdminTicketItemDto {
  return {
    ...mapTicketItemToSeatSelection(item),
    id: item.id,
    reservationId: item.reservationId,
    paymentId: item.paymentId,
    showtimeId: item.showtimeId,
    serviceFee: item.serviceFee,
    status: mapAdminTicketItemStatus(item.status),
    admissionState: mapAdminTicketItemAdmissionState(item.admissionState),
    enteredAt: dateToIsoOrNull(item.enteredAt),
    cancelledAt: dateToIsoOrNull(item.cancelledAt),
    cancelReason: item.cancelReason ?? null,
    cancellationFee: item.cancellationFee,
    serviceFeeRefund: item.serviceFeeRefund,
    refundableAmount: item.refundableAmount,
    reopenState: mapAdminTicketItemReopenState(item.reopenState),
    reopenHoldUntil: dateToIsoOrNull(item.reopenHoldUntil),
  };
}

function mapAdminTicketItemStatus(status: string): AdminTicketItemStatus {
  switch (status) {
    case 'cancellation_pending':
      return 'CANCELLATION_PENDING';
    case 'cancelled':
      return 'CANCELLED';
    case 'expired':
      return 'EXPIRED';
    case 'active':
    default:
      return 'ACTIVE';
  }
}

function mapAdminTicketItemAdmissionState(
  admissionState: string,
): AdminTicketItemAdmissionState {
  return admissionState === 'entered' ? 'ENTERED' : 'NOT_ENTERED';
}

function mapAdminTicketItemReopenState(
  reopenState: string,
): AdminTicketItemReopenState {
  switch (reopenState) {
    case 'held_cancelled':
      return 'HELD_CANCELLED';
    case 'available':
      return 'AVAILABLE';
    case 'manual_opened':
      return 'MANUAL_OPENED';
    case 'not_required':
    default:
      return 'NOT_REQUIRED';
  }
}

function dateToIsoOrNull(date: Date | null | undefined): string | null {
  return date instanceof Date ? date.toISOString() : null;
}

function reservationExportFiltersForAudit(
  filters: AdminReservationExportFilter,
): Record<string, string> {
  const auditFilters: Record<string, string> = {};

  for (const key of [
    'eventId',
    'tierName',
    'zoneFloor',
    'reservationStatus',
    'audienceRegion',
    'paymentMethod',
    'dateFrom',
    'dateTo',
  ] as const) {
    const value = filters[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      auditFilters[key] = value;
    }
  }

  return auditFilters;
}

function dateOnlyStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function dateOnlyEnd(date: string): Date {
  return new Date(`${date}T23:59:59.999Z`);
}
