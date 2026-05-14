import {
  Injectable,
  Inject,
  BadRequestException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { eq, and, sql, ilike, or, desc, inArray, gte, lte, ne, type SQL } from 'drizzle-orm';
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
} from '../../database/schema/index.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import { RefundService } from '../refund/refund.service.js';
import { safeCsvRows } from './csv-export.util.js';
import { AdminAuditService } from './admin-audit.service.js';
import type {
  AdminBookingListItem,
  AdminReservationExportFilter,
  BookingStats,
  FloorAwareSeatSelection,
  PaymentInfo,
  PaymentStatus,
  ReservationStatus,
  SeatSelection,
} from '@grabit/shared';

const LEGACY_FLOOR_KEY = 'default';
const LEGACY_FLOOR_LABEL = '기본';
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
  seat: {
    seatId: string;
    tierName: string;
    row: string;
    number: string;
    price: number;
  };
  payment: {
    method: string | null;
    status: string | null;
    paidAt: Date | null;
  } | null;
};

function toFloorAwareSeatSelection(seat: SeatSelection): FloorAwareSeatSelection {
  return {
    ...seat,
    floorKey: LEGACY_FLOOR_KEY,
    floorLabel: LEGACY_FLOOR_LABEL,
    seatKey: `${LEGACY_FLOOR_KEY}:${seat.seatId}`,
  };
}

function normalizeReservationSeatIdentity(seatId: string): {
  floorKey: string;
  seatId: string;
  seatKey: string;
} {
  if (seatId.includes(':')) {
    const separatorIndex = seatId.indexOf(':');
    const floorKey = seatId.slice(0, separatorIndex) || '1F';
    const rawSeatId = seatId.slice(separatorIndex + 1);

    return {
      floorKey,
      seatId: rawSeatId,
      seatKey: `${floorKey}:${rawSeatId}`,
    };
  }

  return {
    floorKey: '1F',
    seatId,
    seatKey: `1F:${seatId}`,
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

    // Batch-fetch all seats for all reservations (eliminates N+1)
    const reservationIds = rows.map((r) => r.reservation.id);
    const allSeats = reservationIds.length > 0
      ? await this.db
          .select()
          .from(reservationSeats)
          .where(inArray(reservationSeats.reservationId, reservationIds))
      : [];
    const seatsByReservation = new Map<string, typeof allSeats>();
    for (const seat of allSeats) {
      const existing = seatsByReservation.get(seat.reservationId) ?? [];
      existing.push(seat);
      seatsByReservation.set(seat.reservationId, existing);
    }

    const bookings: AdminBookingListItem[] = rows.map((row) => {
      const seats = seatsByReservation.get(row.reservation.id) ?? [];
      return {
        id: row.reservation.id,
        reservationNumber: row.reservation.reservationNumber,
        userName: row.user.name,
        userPhone: row.user.phone,
        performanceTitle: row.performance.title,
        showDateTime: row.showtime.dateTime?.toISOString() ?? '',
        seats: seats.map((s) => toFloorAwareSeatSelection({
          seatId: s.seatId,
          tierName: s.tierName,
          price: s.price,
          row: s.row,
          number: s.number,
        })),
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

  async getBookingDetail(reservationId: string): Promise<AdminBookingListItem & { paymentInfo: PaymentInfo }> {
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

    const seats = await this.db
      .select()
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservationId));

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
      seats: seats.map((s) => toFloorAwareSeatSelection({
        seatId: s.seatId,
        tierName: s.tierName,
        price: s.price,
        row: s.row,
        number: s.number,
      })),
      totalAmount: row.reservation.totalAmount,
      status: row.reservation.status as ReservationStatus,
      createdAt: row.reservation.createdAt?.toISOString() ?? '',
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
      conditions.push(eq(reservationSeats.tierName, filters.tierName));
    }
    if (filters.zoneFloor) {
      conditions.push(ilike(reservationSeats.seatId, `${filters.zoneFloor}:%`));
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
        seat: {
          seatId: reservationSeats.seatId,
          tierName: reservationSeats.tierName,
          row: reservationSeats.row,
          number: reservationSeats.number,
          price: reservationSeats.price,
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
      .innerJoin(reservationSeats, eq(reservationSeats.reservationId, reservations.id))
      .leftJoin(payments, eq(payments.reservationId, reservations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(reservations.createdAt));
  }

  async manualOpen(reservationId: string, operatorUserId: string): Promise<void> {
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

  return [
    row.reservation.reservationNumber,
    row.user.name,
    row.user.email,
    row.user.phone,
    audienceRegion,
    row.performance.title,
    row.showtime.dateTime?.toISOString() ?? '',
    row.seat.tierName,
    row.seat.seatId,
    row.payment?.method ?? '',
    row.payment?.status ?? '',
    row.reservation.totalAmount,
    row.reservation.status,
    row.reservation.createdAt?.toISOString() ?? '',
  ];
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
