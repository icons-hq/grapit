import {
  Injectable,
  Inject,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, sql, ilike, or, desc, inArray } from 'drizzle-orm';
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
import type {
  AdminBookingListItem,
  BookingStats,
  FloorAwareSeatSelection,
  PaymentInfo,
  PaymentStatus,
  ReservationStatus,
  SeatSelection,
} from '@grabit/shared';

const LEGACY_FLOOR_KEY = 'default';
const LEGACY_FLOOR_LABEL = '기본';

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
  ) {}

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
    await this.refundService.requestAdminRefund(reservationId, operatorUserId, reason);
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
