import {
  Injectable,
  Inject,
  Optional,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq, and, or, sql, desc, inArray } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  reservations,
  reservationSeats,
  payments,
  showtimes,
  performances,
  priceTiers,
  venues,
  seatInventories,
  seatMaps,
  performanceSeatAssignments,
  performanceSeatTiers,
  venueLayoutSeats,
  venueLayoutFloors,
  bookingPolicies,
  users,
} from '../../database/schema/index.js';
import { TossPaymentsClient } from '../payment/toss-payments.client.js';
import {
  BookingService,
  BOOKING_VERIFICATION_REQUIRED_MESSAGE,
  PAYMENT_CONFIRM_LOCK_TTL,
} from '../booking/booking.service.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js';
import { ConsentService, type ConsentRequestMeta } from '../consent/consent.service.js';
import { QrTicketService } from '../ticket/qr-ticket.service.js';
import { DEFAULT_PERFORMANCE_BOOKING_POLICY } from '@grabit/shared';
import type {
  BookingPolicy,
  ConsentCaptureItem,
  FloorAwareSeatSelection,
  PerformanceBookingPolicy,
  PaymentStatus,
  QrTicket,
  SeatSelection,
  ReservationStatus,
  ReservationListItem,
  ReservationDetail,
  ConfirmPaymentRequest,
  PrepareReservationRequest,
  PrepareReservationResponse,
  SeatMapConfig,
} from '@grabit/shared';

const DEFAULT_FLOOR_KEY = '1F';
const DEFAULT_FLOOR_LABEL = '1층';
export const PAYMENT_DEADLINE_MINUTES = 7;

type ApprovedPaymentSnapshot = {
  existingPaymentId?: string;
  paymentKey: string;
  orderId: string;
  method: string;
  totalAmount: number;
  approvedAt: string;
  asyncStatus?: string | null;
};

type SeatSelectionLike = SeatSelection & Partial<FloorAwareSeatSelection>;
type BookingActor = {
  id: string;
  role?: string;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
};
type CanonicalSeatSelection = FloorAwareSeatSelection & {
  layoutSeatId?: string;
  performanceSeatAssignmentId?: string;
};
type ShowtimeBookingContext = {
  id: string;
  performanceId: string;
  performanceStatus: string;
  dateTime: Date;
  maxTicketsPerUser: number;
  bookingPolicy: BookingPolicy;
};

function normalizeSeatIdentity(seat: Pick<SeatSelectionLike, 'seatId'> & Partial<FloorAwareSeatSelection>) {
  const separatorIndex = seat.seatId.includes(':') ? seat.seatId.indexOf(':') : -1;
  const seatIdFromStoredValue = separatorIndex > 0 ? seat.seatId.slice(separatorIndex + 1) : undefined;
  const floorKeyFromStoredValue = separatorIndex > 0 ? seat.seatId.slice(0, separatorIndex) : undefined;
  const seatKeyFromField =
    typeof seat.seatKey === 'string' && seat.seatKey.length > 0 ? seat.seatKey : undefined;
  const floorKeyFromSeatKey = seatKeyFromField?.includes(':')
    ? seatKeyFromField.slice(0, seatKeyFromField.indexOf(':'))
    : undefined;
  const seatIdFromSeatKey = seatKeyFromField?.includes(':')
    ? seatKeyFromField.slice(seatKeyFromField.indexOf(':') + 1)
    : undefined;
  const floorKey = seat.floorKey ?? floorKeyFromSeatKey ?? floorKeyFromStoredValue ?? DEFAULT_FLOOR_KEY;
  const seatId = seatIdFromSeatKey ?? seatIdFromStoredValue ?? seat.seatId;

  return {
    floorKey,
    floorLabel: seat.floorLabel ?? (floorKey === DEFAULT_FLOOR_KEY ? DEFAULT_FLOOR_LABEL : floorKey),
    seatId,
    seatKey: `${floorKey}:${seatId}`,
  };
}

function toFloorAwareSeatSelection(seat: SeatSelectionLike): FloorAwareSeatSelection {
  const identity = normalizeSeatIdentity(seat);

  return {
    ...seat,
    seatId: identity.seatId,
    floorKey: identity.floorKey,
    floorLabel: identity.floorLabel,
    seatKey: identity.seatKey,
  };
}

function mapPerformanceBookingPolicy(
  policy: Partial<PerformanceBookingPolicy> | null | undefined,
  options: { forceCancelOnly?: boolean } = {},
): BookingPolicy {
  const maxTicketsPerOrder =
    policy?.maxTicketsPerUser ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.maxTicketsPerUser;
  const sameGradeChangeEnabled = options.forceCancelOnly
    ? false
    : (policy?.changePolicyEnabled ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.changePolicyEnabled);

  return {
    maxTicketsPerOrder,
    cancellationChangePolicy: sameGradeChangeEnabled ? 'SAME_GRADE_CHANGE' : 'CANCEL_ONLY',
    sameGradeChangeEnabled,
    paymentWindowMinutes:
      policy?.paymentWindowMinutes ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.paymentWindowMinutes,
    seatHoldMinutes:
      policy?.seatHoldMinutes ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.seatHoldMinutes,
  };
}

function assertBookingVerificationComplete(actor: BookingActor): void {
  if (actor.isEmailVerified !== true || actor.isPhoneVerified !== true) {
    throw new ForbiddenException(BOOKING_VERIFICATION_REQUIRED_MESSAGE);
  }
}

@Injectable()
export class ReservationService {
  private readonly logger = new Logger(ReservationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly tossClient: TossPaymentsClient,
    private readonly bookingService: BookingService,
    private readonly bookingGateway: BookingGateway,
    private readonly featureFlags: FeatureFlagsService,
    private readonly consentService: ConsentService,
    @Optional() private readonly qrTicketService?: QrTicketService,
  ) {}

  generateReservationNumber(): string {
    const now = new Date();
    const dateStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('');
    const random = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `GRP-${dateStr}-${random}`;
  }

  private calculatePaymentDeadlineAt(preparedAt: Date): Date {
    return new Date(preparedAt.getTime() + PAYMENT_DEADLINE_MINUTES * 60 * 1000);
  }

  private toOptionalDate(value?: string | null): Date | undefined {
    if (!value) return undefined;
    return new Date(value);
  }

  private isPastWindow(value: Date | null | undefined, now: Date = new Date()): boolean {
    return value instanceof Date && !Number.isNaN(value.getTime()) && value.getTime() < now.getTime();
  }

  private hasAsyncPaymentHandoff(status?: PaymentStatus | null): boolean {
    return status === 'IN_PROGRESS' || status === 'DONE';
  }

  private async expirePendingReservation(reservationId: string): Promise<void> {
    await this.db
      .update(reservations)
      .set({
        status: 'FAILED',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId));
  }

  private assertUniqueSeatIds(seats: SeatSelectionLike[]): void {
    const uniqueSeatKeys = new Set(seats.map((seat) => toFloorAwareSeatSelection(seat).seatKey));
    if (uniqueSeatKeys.size !== seats.length) {
      throw new BadRequestException('중복된 좌석이 포함되어 있습니다');
    }
  }

  private assertSeatCountWithinPolicy(
    seats: FloorAwareSeatSelection[],
    maxTicketsPerUser: number,
  ): void {
    if (seats.length > maxTicketsPerUser) {
      throw new ConflictException(`최대 ${maxTicketsPerUser}석까지 선택할 수 있습니다`);
    }
  }

  private getSeatTierBySeatId(seatConfig: unknown): Map<string, string> | null {
    if (!seatConfig || typeof seatConfig !== 'object') return null;

    const tiers = (seatConfig as SeatMapConfig).tiers;
    if (!Array.isArray(tiers) || tiers.length === 0) return null;

    const seatTierBySeatId = new Map<string, string>();
    for (const tier of tiers) {
      if (!tier || typeof tier.tierName !== 'string' || !Array.isArray(tier.seatIds)) {
        continue;
      }
      for (const seatId of tier.seatIds) {
        if (typeof seatId === 'string') {
          seatTierBySeatId.set(seatId, tier.tierName);
        }
      }
    }

    return seatTierBySeatId.size > 0 ? seatTierBySeatId : null;
  }

  private deriveSeatPosition(
    seatId: string,
    fallback: Pick<SeatSelection, 'row' | 'number'>,
  ): Pick<SeatSelection, 'row' | 'number'> {
    const hyphenParts = seatId.split('-');
    if (hyphenParts.length >= 2 && hyphenParts[0] && hyphenParts.slice(1).join('-')) {
      return { row: hyphenParts[0], number: hyphenParts.slice(1).join('-') };
    }

    const compactMatch = /^([A-Za-z]+)[-_ ]?(\d+)$/.exec(seatId);
    if (compactMatch) {
      return { row: compactMatch[1]!, number: compactMatch[2]! };
    }

    return fallback;
  }

  private calculateSeatTotal(seats: SeatSelection[]): number {
    return seats.reduce((total, seat) => total + seat.price, 0);
  }

  private async getCanonicalSeatSelectionsFromOverlay(
    requestedSeats: FloorAwareSeatSelection[],
    performanceId: string,
  ): Promise<CanonicalSeatSelection[] | null> {
    const overlayRows = await this.db
      .select({
        assignmentId: performanceSeatAssignments.id,
        saleStatus: performanceSeatAssignments.saleStatus,
        layoutSeatId: venueLayoutSeats.id,
        seatKey: venueLayoutSeats.seatKey,
        sourceSeatId: venueLayoutSeats.sourceSeatId,
        rowLabel: venueLayoutSeats.rowLabel,
        seatNumber: venueLayoutSeats.seatNumber,
        floorKey: venueLayoutFloors.floorKey,
        floorLabel: venueLayoutFloors.floorLabel,
        tierName: performanceSeatTiers.tierName,
        price: performanceSeatTiers.price,
      })
      .from(performanceSeatAssignments)
      .innerJoin(
        venueLayoutSeats,
        eq(performanceSeatAssignments.layoutSeatId, venueLayoutSeats.id),
      )
      .innerJoin(
        venueLayoutFloors,
        eq(venueLayoutSeats.floorId, venueLayoutFloors.id),
      )
      .innerJoin(
        performanceSeatTiers,
        eq(performanceSeatAssignments.tierId, performanceSeatTiers.id),
      )
      .where(eq(performanceSeatAssignments.performanceId, performanceId));

    if (overlayRows.length === 0) {
      return null;
    }

    const overlayBySeatKey = new Map<string, typeof overlayRows[number]>();
    for (const row of overlayRows) {
      overlayBySeatKey.set(row.seatKey, row);
      overlayBySeatKey.set(`${row.floorKey}:${row.sourceSeatId}`, row);
    }

    return requestedSeats.map((seat) => {
      const row = overlayBySeatKey.get(seat.seatKey);
      if (!row) {
        throw new BadRequestException('유효하지 않은 좌석입니다');
      }
      if (row.saleStatus !== 'available') {
        throw new BadRequestException('선택할 수 없는 좌석입니다');
      }

      const position = row.rowLabel && row.seatNumber
        ? { row: row.rowLabel, number: row.seatNumber }
        : this.deriveSeatPosition(row.sourceSeatId, seat);

      return {
        ...seat,
        seatId: row.sourceSeatId,
        seatKey: row.seatKey,
        floorKey: row.floorKey,
        floorLabel: row.floorLabel,
        tierName: row.tierName,
        price: row.price,
        row: position.row,
        number: position.number,
        layoutSeatId: row.layoutSeatId,
        performanceSeatAssignmentId: row.assignmentId,
      };
    });
  }

  private async getCanonicalSeatSelections(
    seats: SeatSelectionLike[],
    performanceId: string,
  ): Promise<CanonicalSeatSelection[]> {
    const requestedSeats = seats.map((seat) => toFloorAwareSeatSelection(seat));
    this.assertUniqueSeatIds(requestedSeats);

    const [tiers, seatMapRows] = await Promise.all([
      this.db
        .select()
        .from(priceTiers)
        .where(eq(priceTiers.performanceId, performanceId)),
      this.db
        .select({
          floorKey: seatMaps.floorKey,
          floorLabel: seatMaps.floorLabel,
          venueLayoutId: seatMaps.venueLayoutId,
          seatConfig: seatMaps.seatConfig,
        })
        .from(seatMaps)
        .where(eq(seatMaps.performanceId, performanceId)),
    ]);

    if (seatMapRows.some((row) => typeof row.venueLayoutId === 'string')) {
      const overlaySeats = await this.getCanonicalSeatSelectionsFromOverlay(
        requestedSeats,
        performanceId,
      );
      if (overlaySeats) {
        return overlaySeats;
      }
    }

    const tierPriceByName = new Map(tiers.map((tier) => [tier.tierName, tier.price]));
    const seatTierByFloorKey = new Map(
      seatMapRows.map((row) => [
        row.floorKey ?? DEFAULT_FLOOR_KEY,
        {
          floorLabel: row.floorLabel ?? DEFAULT_FLOOR_LABEL,
          seatTierBySeatId: this.getSeatTierBySeatId(row.seatConfig),
        },
      ]),
    );

    if (seatTierByFloorKey.size === 0) {
      throw new BadRequestException('좌석 배치 정보가 유효하지 않습니다');
    }

    const hasAnyUsableSeatConfig = Array.from(seatTierByFloorKey.values())
      .some((floor) => floor.seatTierBySeatId && floor.seatTierBySeatId.size > 0);
    if (!hasAnyUsableSeatConfig) {
      throw new BadRequestException('좌석 배치 정보가 유효하지 않습니다');
    }

    return requestedSeats.map((seat) => {
      const floorData = seatTierByFloorKey.get(seat.floorKey);
      const seatTierBySeatId = floorData?.seatTierBySeatId;
      if (!seatTierBySeatId) {
        throw new BadRequestException('좌석 배치 정보가 유효하지 않습니다');
      }

      const tierName = seatTierBySeatId.get(seat.seatId);
      if (!tierName) {
        throw new BadRequestException('유효하지 않은 좌석입니다');
      }

      const tierPrice = tierPriceByName.get(tierName);
      if (tierPrice === undefined) {
        throw new BadRequestException('유효하지 않은 등급입니다');
      }

      const position = this.deriveSeatPosition(seat.seatId, seat);

      return {
        ...seat,
        floorLabel: floorData.floorLabel,
        tierName,
        price: tierPrice,
        row: position.row,
        number: position.number,
      };
    });
  }

  async calculateTotalAmount(seats: SeatSelection[], performanceId: string): Promise<number> {
    const canonicalSeats = await this.getCanonicalSeatSelections(seats, performanceId);
    return this.calculateSeatTotal(canonicalSeats);
  }

  calculateCancelDeadline(showDateTime: Date): Date {
    return new Date(showDateTime.getTime() - 24 * 60 * 60 * 1000);
  }

  private async getReservationSeatIds(reservationId: string): Promise<string[]> {
    const rows = await this.getReservationSeatSelections(reservationId);
    return rows.map((row) => row.seatKey);
  }

  private async getReservationSeatSelections(reservationId: string): Promise<FloorAwareSeatSelection[]> {
    const rows = await this.db
      .select({
        seatId: reservationSeats.seatId,
        tierName: reservationSeats.tierName,
        price: reservationSeats.price,
        row: reservationSeats.row,
        number: reservationSeats.number,
      })
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservationId));

    return rows.map((seat) => toFloorAwareSeatSelection(seat));
  }

  private hasSameSeatSelections(
    left: FloorAwareSeatSelection[],
    right: FloorAwareSeatSelection[],
  ): boolean {
    if (left.length !== right.length) return false;

    const signature = (seat: SeatSelection) => [
      toFloorAwareSeatSelection(seat).seatKey,
      seat.tierName,
      seat.price,
      seat.row,
      seat.number,
    ].join('\u0000');

    const leftSignatures = left.map(signature).sort();
    const rightSignatures = right.map(signature).sort();
    return leftSignatures.every((value, index) => value === rightSignatures[index]);
  }

  private async getUserBirthDate(userId: string): Promise<string> {
    const [user] = await this.db
      .select({ birthDate: users.birthDate })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다');
    }

    return user.birthDate;
  }

  private async getShowtimeBookingContext(showtimeId: string): Promise<ShowtimeBookingContext> {
    const [showtime] = await this.db
      .select({
        id: showtimes.id,
        performanceId: showtimes.performanceId,
        performanceStatus: performances.status,
        dateTime: showtimes.dateTime,
        maxTicketsPerUser: bookingPolicies.maxTicketsPerUser,
        changePolicyEnabled: bookingPolicies.changePolicyEnabled,
        paymentWindowMinutes: bookingPolicies.paymentWindowMinutes,
        seatHoldMinutes: bookingPolicies.seatHoldMinutes,
      })
      .from(showtimes)
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(bookingPolicies, eq(bookingPolicies.performanceId, showtimes.performanceId))
      .where(eq(showtimes.id, showtimeId));

    if (!showtime) {
      throw new NotFoundException('회차를 찾을 수 없습니다');
    }

    return {
      id: showtime.id,
      performanceId: showtime.performanceId,
      performanceStatus: showtime.performanceStatus,
      dateTime: showtime.dateTime,
      maxTicketsPerUser:
        showtime.maxTicketsPerUser ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.maxTicketsPerUser,
      bookingPolicy: mapPerformanceBookingPolicy({
        maxTicketsPerUser: showtime.maxTicketsPerUser ?? undefined,
        changePolicyEnabled: showtime.changePolicyEnabled ?? undefined,
        paymentWindowMinutes: showtime.paymentWindowMinutes ?? undefined,
        seatHoldMinutes: showtime.seatHoldMinutes ?? undefined,
      }),
    };
  }

  private assertPerformanceBookingOpen(
    performanceStatus: string,
    actor: BookingActor,
  ): void {
    if (performanceStatus === 'upcoming' && actor.role !== 'admin') {
      throw new ForbiddenException('예매는 추후 오픈 예정입니다');
    }
  }

  async prepareReservation(
    dto: PrepareReservationRequest,
    actorOrUserId: string | BookingActor,
    requestMeta: ConsentRequestMeta = { ipAddress: '0.0.0.0' },
  ): Promise<PrepareReservationResponse> {
    const actor = typeof actorOrUserId === 'string'
      ? { id: actorOrUserId, isEmailVerified: true, isPhoneVerified: true }
      : actorOrUserId;
    const userId = actor.id;
    this.featureFlags.assertBookingEnabled(actor);
    assertBookingVerificationComplete(actor);
    await this.assertBookingConsent(dto as PrepareReservationRequest & {
      consentItems?: ConsentCaptureItem[];
    });

    this.assertUniqueSeatIds(dto.seats);

    // 1. Idempotency: if a reservation already exists for this orderId, return it
    const [existing] = await this.db
      .select({
        id: reservations.id,
        userId: reservations.userId,
        showtimeId: reservations.showtimeId,
        status: reservations.status,
        tossOrderId: reservations.tossOrderId,
        totalAmount: reservations.totalAmount,
        paymentDeadlineAt: reservations.paymentDeadlineAt,
      })
      .from(reservations)
      .where(eq(reservations.tossOrderId, dto.orderId));

    if (existing) {
      if (existing.userId !== userId) {
        throw new NotFoundException('예매 정보를 찾을 수 없습니다. 다시 시도해주세요.');
      }

      if (existing.status !== 'PENDING_PAYMENT') {
        throw new ConflictException('이미 처리된 주문 ID입니다. 새 주문 ID로 다시 시도해주세요.');
      }

      if (existing.showtimeId !== dto.showtimeId) {
        throw new ConflictException('기존 예매 요청과 일치하지 않습니다. 새 주문 ID로 다시 시도해주세요.');
      }

      if (this.isPastWindow(existing.paymentDeadlineAt)) {
        const [existingPayment] = await this.db
          .select({
            status: payments.status,
          })
          .from(payments)
          .where(eq(payments.tossOrderId, dto.orderId));

        if (!this.hasAsyncPaymentHandoff(existingPayment?.status as PaymentStatus | undefined)) {
          await this.expirePendingReservation(existing.id);
          throw new ConflictException('결제 가능 시간이 만료되었습니다. 좌석을 다시 선택해주세요.');
        }
      }

      const existingShowtime = await this.getShowtimeBookingContext(existing.showtimeId);
      this.assertPerformanceBookingOpen(existingShowtime.performanceStatus, actor);

      const canonicalSeats = await this.getCanonicalSeatSelections(
        dto.seats,
        existingShowtime.performanceId,
      );
      this.assertSeatCountWithinPolicy(canonicalSeats, existingShowtime.maxTicketsPerUser);
      const expectedAmount = this.calculateSeatTotal(canonicalSeats);
      if (existing.totalAmount !== expectedAmount || dto.amount !== expectedAmount) {
        throw new ConflictException('기존 예매 요청과 일치하지 않습니다. 새 주문 ID로 다시 시도해주세요.');
      }

      const existingSeats = await this.getReservationSeatSelections(existing.id);
      if (!this.hasSameSeatSelections(existingSeats, canonicalSeats)) {
        throw new ConflictException('기존 예매 요청과 일치하지 않습니다. 새 주문 ID로 다시 시도해주세요.');
      }

      const existingSeatIds = existingSeats.map((seat) => seat.seatKey);
      await this.bookingService.assertOwnedSeatLocks(userId, existing.showtimeId, existingSeatIds);

      return {
        reservationId: existing.id,
        orderId: dto.orderId,
        queueAdmission: dto.queueAdmission,
        paymentDeadlineAt:
          existing.paymentDeadlineAt?.toISOString()
          ?? dto.paymentDeadlineAt,
        bookingPolicy: existingShowtime.bookingPolicy,
        paymentMethod: dto.paymentMethod,
      };
    }

    // 2. Get showtime to determine performanceId and dateTime
    const showtime = await this.getShowtimeBookingContext(dto.showtimeId);
    this.assertPerformanceBookingOpen(showtime.performanceStatus, actor);

    // 3. Calculate expected amount from DB and canonical seat map metadata
    const canonicalSeats = await this.getCanonicalSeatSelections(dto.seats, showtime.performanceId);
    this.assertSeatCountWithinPolicy(canonicalSeats, showtime.maxTicketsPerUser);
    const expectedAmount = this.calculateSeatTotal(canonicalSeats);

    if (expectedAmount !== dto.amount) {
      throw new BadRequestException('금액이 일치하지 않습니다');
    }

    await this.bookingService.assertOwnedSeatLocks(
      userId,
      dto.showtimeId,
      canonicalSeats.map((seat) => seat.seatKey),
    );
    const userBirthDate = await this.getUserBirthDate(userId);

    // 4. Create pending reservation + seats atomically
    const preparedAt = new Date();
    const paymentDeadlineAt = this.calculatePaymentDeadlineAt(preparedAt);
    const reservationNumber = this.generateReservationNumber();
    const cancelDeadline = this.calculateCancelDeadline(showtime.dateTime);

    const result = await this.db.transaction(async (tx) => {
      const [reservation] = await tx
        .insert(reservations)
        .values({
          userId,
          showtimeId: dto.showtimeId,
          tossOrderId: dto.orderId,
          reservationNumber,
          status: 'PENDING_PAYMENT',
          totalAmount: expectedAmount,
          queueSessionId: dto.queueAdmission?.queueSessionId,
          admissionToken: dto.queueAdmission?.admissionToken,
          refreshFamilyId: dto.queueAdmission?.refreshFamilyId,
          deviceSlotKey: dto.queueAdmission?.deviceSlotKey,
          admittedAt: this.toOptionalDate(dto.queueAdmission?.admittedAt),
          admissionActiveUntilAt: this.toOptionalDate(dto.queueAdmission?.activeUntilAt),
          reentryGraceUntilAt: this.toOptionalDate(dto.queueAdmission?.reentryGraceUntilAt),
          paymentDeadlineAt,
          cancelDeadline,
        })
        .returning();

      const reservationId = reservation!.id;

      await tx.insert(reservationSeats).values(
        canonicalSeats.map((seat) => ({
          reservationId,
          seatId: seat.seatKey,
          tierName: seat.tierName,
          price: seat.price,
          row: seat.row,
          number: seat.number,
        })),
      );

      await this.consentService.captureConsent(
        userId,
        {
          birthDate: userBirthDate,
          items: dto.consentItems,
          sourceFlow: 'booking',
        },
        requestMeta,
        tx,
      );

      return reservation!;
    });

    return {
      reservationId: result.id,
      orderId: dto.orderId,
      queueAdmission: dto.queueAdmission,
      paymentDeadlineAt: paymentDeadlineAt.toISOString(),
      bookingPolicy: showtime.bookingPolicy,
      paymentMethod: dto.paymentMethod,
    };
  }

  private async assertBookingConsent(
    dto: PrepareReservationRequest & { consentItems?: ConsentCaptureItem[] },
  ): Promise<void> {
    if (!dto.consentItems?.length) {
      throw new BadRequestException('예매 동의 항목이 필요합니다');
    }

    await this.consentService.assertRequiredConsents({
      items: dto.consentItems,
    });
  }

  async confirmAndCreateReservation(
    dto: ConfirmPaymentRequest,
    actorOrUserId: string | BookingActor,
  ): Promise<ReservationDetail> {
    const actor = typeof actorOrUserId === 'string'
      ? { id: actorOrUserId, isEmailVerified: true, isPhoneVerified: true }
      : actorOrUserId;
    const userId = actor.id;
    this.featureFlags.assertBookingEnabled(actor);
    assertBookingVerificationComplete(actor);

    const confirmLockToken = randomUUID();
    const confirmLockAcquired = await this.bookingService.acquirePaymentConfirmLock(
      dto.orderId,
      confirmLockToken,
    );

    if (!confirmLockAcquired) {
      throw new ConflictException('결제 확인이 이미 진행 중입니다.');
    }

    const refreshTimer = this.startPaymentConfirmLockRefresh(dto.orderId, confirmLockToken);

    try {
      const lockStillOwned = await this.bookingService.refreshPaymentConfirmLock(
        dto.orderId,
        confirmLockToken,
      );
      if (!lockStillOwned) {
        throw new ConflictException('결제 확인이 이미 진행 중입니다.');
      }

      return await this.confirmAndCreateReservationLocked(dto, userId, confirmLockToken);
    } finally {
      clearInterval(refreshTimer);
      try {
        await this.bookingService.releasePaymentConfirmLock(dto.orderId, confirmLockToken);
      } catch (releaseError) {
        this.logger.error(
          `Payment confirm lock release failed. orderId=${dto.orderId}`,
          releaseError instanceof Error ? releaseError.stack : String(releaseError),
        );
      }
    }
  }

  private startPaymentConfirmLockRefresh(
    orderId: string,
    lockToken: string,
  ): ReturnType<typeof setInterval> {
    const refreshEveryMs = Math.max(1000, Math.floor(PAYMENT_CONFIRM_LOCK_TTL * 1000 / 2));
    return setInterval(() => {
      void this.bookingService.refreshPaymentConfirmLock(orderId, lockToken).catch((refreshError) => {
        this.logger.error(
          `Payment confirm lock refresh failed. orderId=${orderId}`,
          refreshError instanceof Error ? refreshError.stack : String(refreshError),
        );
      });
    }, refreshEveryMs);
  }

  private startOwnedSeatLockRefresh(
    userId: string,
    showtimeId: string,
    seatIds: string[],
  ): ReturnType<typeof setInterval> {
    const refreshEveryMs = Math.max(1000, Math.floor(PAYMENT_CONFIRM_LOCK_TTL * 1000 / 2));
    return setInterval(() => {
      void this.bookingService.extendOwnedSeatLocks(
        userId,
        showtimeId,
        seatIds,
        PAYMENT_CONFIRM_LOCK_TTL,
      ).catch((refreshError) => {
        this.logger.error(
          `Seat lock refresh failed during payment confirm. showtimeId=${showtimeId}`,
          refreshError instanceof Error ? refreshError.stack : String(refreshError),
        );
      });
    }, refreshEveryMs);
  }

  private async cancelConfirmedPaymentOrThrow(paymentKey: string, reason: string): Promise<void> {
    try {
      await this.tossClient.cancelPayment(paymentKey, reason);
      this.logger.log(`Compensation cancel succeeded. paymentKey=${paymentKey}`);
    } catch (cancelError) {
      this.logger.error(
        `CRITICAL: compensation cancel failed. paymentKey=${paymentKey}. Manual refund required.`,
        cancelError instanceof Error ? cancelError.stack : String(cancelError),
      );
      throw new InternalServerErrorException(
        '결제는 승인되었으나 자동 취소에 실패했습니다. 고객센터에 문의해주세요.',
      );
    }
  }

  private async cancelExistingDonePaymentAfterFailure(input: {
    paymentId: string;
    paymentKey: string;
    reservationId: string;
    reason: string;
  }): Promise<void> {
    await this.cancelConfirmedPaymentOrThrow(input.paymentKey, input.reason);
    await this.db
      .update(payments)
      .set({
        status: 'CANCELED',
        cancelledAt: new Date(),
        cancelReason: input.reason,
      })
      .where(eq(payments.id, input.paymentId));
    await this.expirePendingReservation(input.reservationId);
  }

  private async cancelApprovedPaymentAfterFailure(
    approvedPayment: ApprovedPaymentSnapshot,
    reservationId: string,
    reason: string,
  ): Promise<void> {
    if (approvedPayment.existingPaymentId) {
      await this.cancelExistingDonePaymentAfterFailure({
        paymentId: approvedPayment.existingPaymentId,
        paymentKey: approvedPayment.paymentKey,
        reservationId,
        reason,
      });
      return;
    }

    await this.cancelConfirmedPaymentOrThrow(approvedPayment.paymentKey, reason);
  }

  private async confirmAndCreateReservationLocked(
    dto: ConfirmPaymentRequest,
    userId: string,
    confirmLockToken: string,
  ): Promise<ReservationDetail> {
    // 1. Idempotency: check if payment already exists for this orderId
    const [existingPayment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.tossOrderId, dto.orderId));

    const legacyExistingPayment = existingPayment as { reservationId: string; status?: unknown } | undefined;
    if (legacyExistingPayment && !legacyExistingPayment.status) {
      return this.getReservationDetail(legacyExistingPayment.reservationId, userId);
    }

    // 2. Look up pending reservation by tossOrderId
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.tossOrderId, dto.orderId),
          eq(reservations.userId, userId),
        ),
      );

    if (!reservation) {
      throw new NotFoundException('예매 정보를 찾을 수 없습니다. 다시 시도해주세요.');
    }

    if (reservation.status === 'CONFIRMED') {
      return this.getReservationDetail(reservation.id, userId);
    }

    if (reservation.status !== 'PENDING_PAYMENT') {
      throw new ConflictException('좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.');
    }

    if (this.isPastWindow(reservation.admissionActiveUntilAt)) {
      if (existingPayment?.status === 'DONE') {
        await this.cancelConfirmedPaymentOrThrow(
          existingPayment.paymentKey,
          '결제 유효 시간 초과로 인한 자동 취소',
        );
        await this.db
          .update(payments)
          .set({
            status: 'CANCELED',
            cancelledAt: new Date(),
            cancelReason: '결제 유효 시간 초과로 인한 자동 취소',
          })
          .where(eq(payments.id, existingPayment.id));
        await this.expirePendingReservation(reservation.id);
      }

      throw new ConflictException('좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.');
    }

    if (
      existingPayment
      && existingPayment.status
      && existingPayment.status !== 'DONE'
    ) {
      throw new ConflictException('좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.');
    }

    // 3. Amount validation against the prepared reservation
    if (reservation.totalAmount !== dto.amount) {
      throw new BadRequestException('금액이 일치하지 않습니다');
    }

    if (existingPayment?.status === 'DONE') {
      this.assertExistingDonePaymentMatchesRequest(existingPayment, reservation, dto);
    }

    const pendingSeats = await this.getReservationSeatSelections(reservation.id);
    const pendingSeatIds = pendingSeats.map((seat) => seat.seatKey);
    try {
      await this.bookingService.extendOwnedSeatLocks(
        userId,
        reservation.showtimeId,
        pendingSeatIds,
        PAYMENT_CONFIRM_LOCK_TTL,
      );
    } catch (lockError) {
      if (existingPayment?.status === 'DONE') {
        const reason = lockError instanceof ConflictException
          && lockError.message.includes('비활성화')
          ? '판매 불가능 좌석으로 인한 자동 취소'
          : '좌석 점유 만료로 인한 자동 취소';
        await this.cancelExistingDonePaymentAfterFailure({
          paymentId: existingPayment.id,
          paymentKey: existingPayment.paymentKey,
          reservationId: reservation.id,
          reason,
        });
      }
      throw lockError;
    }

    const seatLockRefreshTimer = this.startOwnedSeatLockRefresh(userId, reservation.showtimeId, pendingSeatIds);
    try {
    let approvedPayment: ApprovedPaymentSnapshot;
    if (existingPayment?.status === 'DONE') {
      approvedPayment = {
        existingPaymentId: existingPayment.id,
        paymentKey: existingPayment.paymentKey,
        orderId: existingPayment.tossOrderId,
        method: existingPayment.method,
        totalAmount: existingPayment.amount,
        approvedAt:
          existingPayment.paidAt?.toISOString()
          ?? new Date().toISOString(),
        asyncStatus: existingPayment.asyncStatus,
      };
    } else {
      // 4. Call Toss Payments confirm API
      const tossResponse = await this.tossClient.confirmPayment({
        paymentKey: dto.paymentKey,
        orderId: dto.orderId,
        amount: dto.amount,
      });

      approvedPayment = {
        paymentKey: tossResponse.paymentKey,
        orderId: tossResponse.orderId,
        method: tossResponse.method,
        totalAmount: tossResponse.totalAmount,
        approvedAt: tossResponse.approvedAt,
        asyncStatus: 'sync',
      };
    }

    let confirmLockStillOwned: boolean;
    try {
      confirmLockStillOwned = await this.bookingService.refreshPaymentConfirmLock(
        dto.orderId,
        confirmLockToken,
      );
    } catch (lockError) {
      this.logger.error(
        `Payment confirm lock refresh failed after payment approval. paymentKey=${approvedPayment.paymentKey}, orderId=${dto.orderId}`,
        lockError instanceof Error ? lockError.stack : String(lockError),
      );
      await this.cancelApprovedPaymentAfterFailure(
        approvedPayment,
        reservation.id,
        '결제 확인 상태 검증 실패로 인한 자동 취소',
      );
      throw new InternalServerErrorException(
        '결제는 승인되었으나 처리 중 오류가 발생했습니다. 자동 취소를 시도했습니다. 고객센터에 문의해주세요.',
      );
    }
    if (!confirmLockStillOwned) {
      this.logger.error(
        `Payment confirm lock ownership lost after payment approval. paymentKey=${approvedPayment.paymentKey}, orderId=${dto.orderId}`,
      );
      await this.cancelApprovedPaymentAfterFailure(
        approvedPayment,
        reservation.id,
        '결제 확인 중복 처리로 인한 자동 취소',
      );
      throw new ConflictException('결제 확인이 이미 진행 중입니다.');
    }

    try {
      await this.bookingService.assertOwnedSeatLocks(userId, reservation.showtimeId, pendingSeatIds);
    } catch (lockError) {
      this.logger.error(
        `Seat lock ownership lost after payment approval. paymentKey=${approvedPayment.paymentKey}, orderId=${dto.orderId}`,
        lockError instanceof Error ? lockError.stack : String(lockError),
      );
      await this.cancelApprovedPaymentAfterFailure(
        approvedPayment,
        reservation.id,
        '좌석 점유 만료로 인한 자동 취소',
      );
      throw lockError;
    }

    // 5. Update reservation status + create payment record + mark seats sold
    let committedPaymentId: string | null = null;
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(reservations)
          .set({
            status: 'CONFIRMED',
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, reservation.id));

        if (approvedPayment.existingPaymentId) {
          committedPaymentId = approvedPayment.existingPaymentId;
          await tx
            .update(payments)
            .set({
              status: 'DONE',
              amount: approvedPayment.totalAmount,
              paidAt: new Date(approvedPayment.approvedAt),
              asyncStatus: approvedPayment.asyncStatus ?? 'pending_webhook',
            })
            .where(eq(payments.id, approvedPayment.existingPaymentId));
        } else {
          const insertedPayments = await tx
            .insert(payments)
            .values({
              reservationId: reservation.id,
              paymentKey: approvedPayment.paymentKey,
              tossOrderId: approvedPayment.orderId,
              method: approvedPayment.method,
              provider: 'CARD',
              currency: 'KRW',
              asyncStatus: approvedPayment.asyncStatus ?? 'sync',
              amount: approvedPayment.totalAmount,
              status: 'DONE',
              paidAt: new Date(approvedPayment.approvedAt),
            })
            .returning({ id: payments.id });

          committedPaymentId = insertedPayments[0]?.id ?? null;
        }

        // Mark seats sold only when the inventory row is still available.
        for (const seat of pendingSeats) {
	          const updated = await tx
	            .update(seatInventories)
	            .set({
	              status: 'sold',
	              soldAt: new Date(),
	              lockedBy: null,
	              lockedUntil: null,
	            })
            .where(
              and(
                eq(seatInventories.showtimeId, reservation.showtimeId),
                eq(seatInventories.floorKey, seat.floorKey),
                or(
                  eq(seatInventories.seatKey, seat.seatKey),
                  and(
                    sql`${seatInventories.seatKey} IS NULL`,
                    eq(seatInventories.seatId, seat.seatId),
                  ),
                ),
                eq(seatInventories.status, 'available'),
              ),
            )
            .returning({ id: seatInventories.id });

          if (updated.length > 0) continue;

          const inserted = await tx
            .insert(seatInventories)
            .values({
              showtimeId: reservation.showtimeId,
              seatId: seat.seatId,
              floorKey: seat.floorKey,
              seatKey: seat.seatKey,
              status: 'sold',
              soldAt: new Date(),
            })
            .onConflictDoNothing()
            .returning({ id: seatInventories.id });

          if (inserted.length === 0) {
            throw new ConflictException('판매 불가능한 좌석입니다');
          }
        }
      });
    } catch (dbError) {
      if (dbError instanceof ConflictException) {
        this.logger.error(
          `Seat finalization failed after payment approval. paymentKey=${approvedPayment.paymentKey}, orderId=${dto.orderId}`,
          dbError.stack,
        );
        await this.cancelApprovedPaymentAfterFailure(
          approvedPayment,
          reservation.id,
          '판매 불가능 좌석으로 인한 자동 취소',
        );
        throw dbError;
      }

      if (approvedPayment.existingPaymentId) {
        this.logger.error(
          `DB transaction failed after existing payment recovery. paymentKey=${approvedPayment.paymentKey}, orderId=${dto.orderId}`,
          dbError instanceof Error ? dbError.stack : String(dbError),
        );
        await this.cancelApprovedPaymentAfterFailure(
          approvedPayment,
          reservation.id,
          '서버 오류로 인한 자동 취소',
        );
        throw new InternalServerErrorException(
          '결제는 승인되었으나 처리 중 오류가 발생했습니다. 자동 취소를 시도했습니다. 고객센터에 문의해주세요.',
        );
      }

      try {
        const [committedPayment] = await this.db
          .select()
          .from(payments)
          .where(eq(payments.tossOrderId, dto.orderId));

        if (committedPayment) {
          this.logger.warn(
            `Payment row already exists after confirm transaction failure. orderId=${dto.orderId}, reservationId=${committedPayment.reservationId}`,
          );
          return this.getReservationDetail(committedPayment.reservationId, userId);
        }
      } catch (lookupError) {
        this.logger.error(
          `Failed to re-read payment after confirm transaction failure. orderId=${dto.orderId}`,
          lookupError instanceof Error ? lookupError.stack : String(lookupError),
        );
      }

      // Compensation: attempt to cancel the Toss payment
      this.logger.error(
        `DB transaction failed after payment approval. paymentKey=${approvedPayment.paymentKey}, orderId=${dto.orderId}`,
        dbError instanceof Error ? dbError.stack : String(dbError),
      );
      await this.cancelConfirmedPaymentOrThrow(approvedPayment.paymentKey, '서버 오류로 인한 자동 취소');
      throw new InternalServerErrorException(
        '결제는 승인되었으나 처리 중 오류가 발생했습니다. 자동 취소를 시도했습니다. 고객센터에 문의해주세요.',
      );
    }

    clearInterval(seatLockRefreshTimer);
    try {
      await this.bookingService.consumeOwnedSeatLocks(
        userId,
        reservation.showtimeId,
        pendingSeatIds,
        { skipUnavailableCheck: true },
      );
    } catch (cleanupError) {
      this.logger.warn(
        `Post-commit seat lock cleanup failed. reservationId=${reservation.id}`,
        cleanupError instanceof Error ? cleanupError.stack : String(cleanupError),
      );
    }

    // Broadcast sold status via WebSocket after the DB transaction commits.
    for (const seat of pendingSeats) {
      this.bookingGateway.broadcastSeatUpdate(
        reservation.showtimeId,
        seat.seatKey,
        'sold',
        userId,
      );
    }

    if (this.qrTicketService && committedPaymentId) {
      await this.qrTicketService.ensureIssuedTicketForReservation({
        reservationId: reservation.id,
        paymentId: committedPaymentId,
      });
    }

    return this.getReservationDetail(reservation.id, userId);
    } finally {
      clearInterval(seatLockRefreshTimer);
    }
  }

  private assertExistingDonePaymentMatchesRequest(
    existingPayment: {
      reservationId: string;
      paymentKey: string;
      tossOrderId: string;
      amount: number;
    },
    reservation: {
      id: string;
      totalAmount: number;
    },
    dto: ConfirmPaymentRequest,
  ): void {
    if (
      existingPayment.reservationId !== reservation.id
      || existingPayment.paymentKey !== dto.paymentKey
      || existingPayment.tossOrderId !== dto.orderId
    ) {
      throw new BadRequestException('결제 정보가 예매와 일치하지 않습니다');
    }

    if (
      existingPayment.amount !== reservation.totalAmount
      || existingPayment.amount !== dto.amount
    ) {
      throw new BadRequestException('금액이 일치하지 않습니다');
    }
  }

  async getMyReservations(userId: string, status?: ReservationStatus): Promise<ReservationListItem[]> {
    const conditions = [eq(reservations.userId, userId)];
    if (status) {
      conditions.push(
        eq(reservations.status, status as typeof reservations.status.enumValues[number]),
      );
    }

    const rows = await this.db
      .select({
        reservation: {
          id: reservations.id,
          reservationNumber: reservations.reservationNumber,
          status: reservations.status,
          totalAmount: reservations.totalAmount,
          createdAt: reservations.createdAt,
        },
        showtime: {
          dateTime: showtimes.dateTime,
        },
        performance: {
          title: performances.title,
          posterUrl: performances.posterUrl,
        },
        venue: {
          name: venues.name,
        },
      })
      .from(reservations)
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(venues, eq(performances.venueId, venues.id))
      .where(and(...conditions))
      .orderBy(desc(reservations.createdAt));

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

    const result: ReservationListItem[] = rows.map((row) => {
      const seats = seatsByReservation.get(row.reservation.id) ?? [];
      return {
        id: row.reservation.id,
        reservationNumber: row.reservation.reservationNumber,
        status: row.reservation.status as ReservationStatus,
        performanceTitle: row.performance.title,
        posterUrl: row.performance.posterUrl,
        showDateTime: row.showtime.dateTime?.toISOString() ?? '',
        venue: row.venue?.name ?? '',
        seats: seats.map((s) => toFloorAwareSeatSelection({
          seatId: s.seatId,
          tierName: s.tierName,
          price: s.price,
          row: s.row,
          number: s.number,
        })),
        totalAmount: row.reservation.totalAmount,
        createdAt: row.reservation.createdAt?.toISOString() ?? '',
      };
    });

    return result;
  }

  async getReservationDetail(reservationId: string, userId: string): Promise<ReservationDetail> {
    const [row] = await this.db
      .select({
        reservation: {
          id: reservations.id,
          userId: reservations.userId,
          showtimeId: reservations.showtimeId,
          reservationNumber: reservations.reservationNumber,
          status: reservations.status,
          totalAmount: reservations.totalAmount,
          queueSessionId: reservations.queueSessionId,
          admissionToken: reservations.admissionToken,
          refreshFamilyId: reservations.refreshFamilyId,
          deviceSlotKey: reservations.deviceSlotKey,
          admittedAt: reservations.admittedAt,
          admissionActiveUntilAt: reservations.admissionActiveUntilAt,
          reentryGraceUntilAt: reservations.reentryGraceUntilAt,
          paymentDeadlineAt: reservations.paymentDeadlineAt,
          cancelDeadline: reservations.cancelDeadline,
          cancelledAt: reservations.cancelledAt,
          cancelReason: reservations.cancelReason,
          createdAt: reservations.createdAt,
        },
        showtime: {
          dateTime: showtimes.dateTime,
        },
        performance: {
          title: performances.title,
          posterUrl: performances.posterUrl,
        },
        venue: {
          name: venues.name,
        },
      })
      .from(reservations)
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .leftJoin(venues, eq(performances.venueId, venues.id))
      .where(and(eq(reservations.id, reservationId), eq(reservations.userId, userId)));

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

    const qrTicket: ReservationDetail['qrTicket'] =
      row.reservation.status === 'CONFIRMED'
      && payment?.id
      && payment.status === 'DONE'
      && this.qrTicketService
        ? await this.qrTicketService.getOrIssueTicketForReservation({
            reservationId,
            paymentId: payment.id,
          })
        : this.createBlockingQrTicket(row.reservation.createdAt);

    return {
      id: row.reservation.id,
      reservationNumber: row.reservation.reservationNumber,
      status: row.reservation.status as ReservationStatus,
      performanceTitle: row.performance.title,
      posterUrl: row.performance.posterUrl,
      showDateTime: row.showtime.dateTime?.toISOString() ?? '',
      venue: row.venue?.name ?? '',
      seats: seats.map((s) => toFloorAwareSeatSelection({
        seatId: s.seatId,
        tierName: s.tierName,
        price: s.price,
        row: s.row,
        number: s.number,
      })),
      totalAmount: row.reservation.totalAmount,
      createdAt: row.reservation.createdAt?.toISOString() ?? '',
      paymentMethod: payment?.method ?? '',
      paidAt: payment?.paidAt?.toISOString() ?? '',
      cancelDeadline: row.reservation.cancelDeadline?.toISOString() ?? '',
      cancelledAt: row.reservation.cancelledAt?.toISOString() ?? null,
      cancelReason: row.reservation.cancelReason ?? null,
      paymentKey: payment?.paymentKey ?? '',
      queueAdmission: {
        queueSessionId: row.reservation.queueSessionId ?? '',
        admissionToken: row.reservation.admissionToken ?? '',
        refreshFamilyId: row.reservation.refreshFamilyId ?? '',
        deviceSlotKey: row.reservation.deviceSlotKey ?? '',
        admittedAt: row.reservation.admittedAt?.toISOString() ?? new Date(0).toISOString(),
        activeUntilAt: row.reservation.admissionActiveUntilAt?.toISOString() ?? new Date(0).toISOString(),
        reentryGraceUntilAt: row.reservation.reentryGraceUntilAt?.toISOString() ?? new Date(0).toISOString(),
      },
      paymentDeadlineAt: row.reservation.paymentDeadlineAt?.toISOString() ?? new Date(0).toISOString(),
      bookingPolicy: mapPerformanceBookingPolicy(undefined, { forceCancelOnly: true }),
      refundTimeline: {
        currentState: row.reservation.status === 'CANCELLED' ? 'REQUESTED' : 'COMPLETED',
        requestedAt: row.reservation.cancelledAt?.toISOString() ?? row.reservation.createdAt?.toISOString() ?? new Date(0).toISOString(),
        completedAt: row.reservation.cancelledAt?.toISOString() ?? null,
        customerServiceCtaVisible: false,
      },
      cancelledSeatHold: null,
      qrTicket,
    };
  }

  private createBlockingQrTicket(createdAt?: Date | null): QrTicket {
    return {
      token: '',
      jti: '',
      status: 'REVOKED',
      entryStatus: 'NOT_ENTERED',
      enteredAt: null,
      issuedAt: createdAt?.toISOString() ?? new Date(0).toISOString(),
      emailScheduledAt: null,
      emailedAt: null,
    };
  }

  async getReservationByOrderId(orderId: string, userId: string): Promise<ReservationDetail | null> {
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.tossOrderId, orderId));

    if (!payment) {
      return null;
    }

    // Verify ownership
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, payment.reservationId), eq(reservations.userId, userId)));

    if (!reservation) {
      return null;
    }

    return this.getReservationDetail(payment.reservationId, userId);
  }

  async cancelReservation(reservationId: string, userId: string, reason: string): Promise<void> {
    let showtimeId: string | undefined;

    try {
      await this.db.transaction(async (tx) => {
        // 1. SELECT FOR UPDATE to lock the reservation row (prevents double-cancel race)
        const result = await tx.execute(
          sql`SELECT id, user_id, showtime_id, status, cancel_deadline FROM reservations WHERE id = ${reservationId} FOR UPDATE`,
        );
        const row = result.rows[0] as
          | { id: string; user_id: string; showtime_id: string; status: string; cancel_deadline: Date }
          | undefined;

        if (!row || row.user_id !== userId) {
          throw new NotFoundException('예매를 찾을 수 없습니다');
        }

        if (row.status !== 'CONFIRMED') {
          throw new BadRequestException('취소할 수 없는 상태입니다');
        }

        if (new Date(row.cancel_deadline) <= new Date()) {
          throw new ForbiddenException('취소 마감시간이 지났습니다');
        }

        showtimeId = row.showtime_id;

        // 2. Get payment within transaction
        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.reservationId, reservationId));

        // 3. Call Toss cancel before DB updates
        if (payment) {
          await this.tossClient.cancelPayment(payment.paymentKey, reason);
        }

        // 4. Update reservation + payment + restore seats
        const now = new Date();
        await tx
          .update(reservations)
          .set({
            status: 'CANCELLED',
            cancelledAt: now,
            cancelReason: reason,
            updatedAt: now,
          })
          .where(eq(reservations.id, reservationId));

        if (payment) {
          await tx
            .update(payments)
            .set({
              status: 'CANCELED',
              cancelledAt: now,
              cancelReason: reason,
            })
            .where(eq(payments.reservationId, reservationId));
        }

        // Restore seat_inventories to available
        const cancelledSeats = await tx
          .select({ seatId: reservationSeats.seatId })
          .from(reservationSeats)
          .where(eq(reservationSeats.reservationId, reservationId));

        for (const seat of cancelledSeats) {
          const seatIdentity = normalizeSeatIdentity({ seatId: seat.seatId });
          await tx
            .update(seatInventories)
            .set({ status: 'available', soldAt: null, lockedBy: null, lockedUntil: null })
            .where(
              and(
                eq(seatInventories.showtimeId, row.showtime_id),
                eq(seatInventories.floorKey, seatIdentity.floorKey),
                or(
                  eq(seatInventories.seatKey, seatIdentity.seatKey),
                  and(
                    sql`${seatInventories.seatKey} IS NULL`,
                    eq(seatInventories.seatId, seatIdentity.seatId),
                  ),
                ),
              ),
            );
        }
      });
    } catch (error) {
      // Re-throw business exceptions as-is
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      // Toss cancel succeeded but DB failed — log CRITICAL for manual reconciliation
      this.logger.error(
        `CRITICAL: DB transaction failed after Toss cancel. reservationId=${reservationId}. Manual reconciliation required.`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        '취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.',
      );
    }

    // Broadcast available status via WebSocket for each cancelled seat
    if (showtimeId) {
      const freedSeats = await this.db
        .select({ seatId: reservationSeats.seatId })
        .from(reservationSeats)
        .where(eq(reservationSeats.reservationId, reservationId));

      for (const seat of freedSeats) {
        this.bookingGateway.broadcastSeatUpdate(showtimeId, seat.seatId, 'available');
      }
    }
  }

  async cancelPendingReservation(reservationId: string, userId: string): Promise<void> {
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.userId, userId),
          eq(reservations.status, 'PENDING_PAYMENT'),
        ),
      );

    if (!reservation) {
      // Already cancelled or doesn't exist — idempotent
      return;
    }

    const [cancelled] = await this.db
      .update(reservations)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: '좌석 점유 만료',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reservations.id, reservation.id),
          eq(reservations.userId, userId),
          eq(reservations.status, 'PENDING_PAYMENT'),
        ),
      )
      .returning({ id: reservations.id });

    if (!cancelled) {
      return;
    }
  }
}
