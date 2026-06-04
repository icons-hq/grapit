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
import { eq, and, or, sql, desc, inArray, asc, ne } from 'drizzle-orm';
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
  ticketItems,
  tickets,
  users,
} from '../../database/schema/index.js';
import {
  TossPaymentError,
  TossPaymentsClient,
  type TossPaymentResponse,
} from '../payment/toss-payments.client.js';
import {
  ProviderChargeQuoteService,
  type ForeignEasyPayProviderChargeQuote,
} from '../payment/provider-charge-quote.service.js';
import {
  buildTicketItemPaymentCancelRequest,
  type PaymentCancelRequest,
  type PaymentCancelTicketItemSnapshot,
} from '../payment/payment-cancel-policy.js';
import {
  PaymentCancellationFinalizerService,
  type FullPaymentCancellationContext,
} from '../cancellation/payment-cancellation-finalizer.service.js';
import {
  BookingService,
  BOOKING_ENDED_MESSAGE,
  BOOKING_VERIFICATION_REQUIRED_MESSAGE,
  buildMaxTicketsPerUserExceededMessage,
} from '../booking/booking.service.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js';
import { ConsentService, type ConsentRequestMeta } from '../consent/consent.service.js';
import { QrTicketService } from '../ticket/qr-ticket.service.js';
import { resolveTicketEmailDelivery } from '../ticket/ticket-email-delivery.js';
import { ReservationFinalizationService } from './reservation-finalization.service.js';
import {
  DEFAULT_PERFORMANCE_BOOKING_POLICY,
  DEFAULT_SEAT_FLOOR_KEY,
  DEFAULT_SEAT_FLOOR_LABEL,
  normalizeSeatIdentity,
  toFloorAwareSeatSelection,
} from '@grabit/shared';
import type {
  BookingPolicy,
  ConsentCaptureItem,
  FloorAwareSeatSelection,
  PerformanceBookingPolicy,
  PaymentStatus,
  QrTicket,
  SeatSelection,
  TicketItem,
  ReservationStatus,
  ReservationListItem,
  ReservationDetail,
  ConfirmPaymentRequest,
  PrepareReservationRequest,
  PrepareReservationResponse,
  SeatMapConfig,
} from '@grabit/shared';

export const PAYMENT_DEADLINE_MINUTES = 7;
const TICKET_SERVICE_FEE_KRW = 2000;

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
type ReservationSeatRow = typeof reservationSeats.$inferSelect;
type TicketItemRow = typeof ticketItems.$inferSelect;
type TicketItemCancellationContext = {
  reservationId: string;
  userId: string;
  showtimeId: string;
  reservationNumber?: string;
  reservationStatus: string;
  reservationCreatedAt: Date;
  showtimeAt: Date;
  paymentId: string;
  paymentKey: string;
  paymentMethod: string;
  paymentProvider: string;
  paymentCurrency: string;
  paymentAmount: number;
  providerMetadata?: unknown;
  providerChargeCurrency?: string | null;
  providerChargeAmountMinor?: number | null;
  paymentStatus: string;
  bookingPolicy: FullPaymentCancellationContext['bookingPolicy'];
  ticketItemId: string;
  ticketItemStatus: string;
  admissionState: string;
  seatId: string;
  seatKey: string;
  floorKey: string;
  price: number;
  serviceFee: number;
  cancelledAt: Date | null;
  cancelReason: string | null;
  cancellationFee: number;
  serviceFeeRefund: number;
  refundableAmount: number;
};
type TicketItemCancellationQuote = {
  cancellationFee: number;
  serviceFeeRefund: number;
  refundableAmount: number;
};
type PreparedTicketItemCancellation = {
  context: TicketItemCancellationContext;
  quote: TicketItemCancellationQuote;
  reason: string;
  isPendingRetry: boolean;
  paymentCancelRequest: PaymentCancelRequest;
  isFullPaymentCancellation: boolean;
  finalizerContext: FullPaymentCancellationContext;
  now: Date;
};
type TicketItemPaymentCancelOutcome =
  | { status: 'cancelled'; providerResponse: TossPaymentResponse }
  | { status: 'definite_failure' }
  | { status: 'ambiguous' };
type TicketItemCancellationSnapshot = PaymentCancelTicketItemSnapshot & {
  seatId: string;
};
type ProviderChargeQuote = {
  currency: 'USD';
  amountMinor: number;
  amountDecimal: string;
  rate: string;
  quotedAt: string;
};

const PLACEHOLDER_UUID = '00000000-0000-4000-8000-000000000000';
const SEOUL_TIME_ZONE = 'Asia/Seoul';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const seoulDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SEOUL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

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
  private readonly reservationFinalizationService: ReservationFinalizationService;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly tossClient: TossPaymentsClient,
    private readonly bookingService: BookingService,
    private readonly bookingGateway: BookingGateway,
    private readonly featureFlags: FeatureFlagsService,
    private readonly consentService: ConsentService,
    @Optional() private readonly qrTicketService?: QrTicketService,
    @Optional() reservationFinalizationService?: ReservationFinalizationService,
    @Optional() private readonly providerChargeQuoteService?: ProviderChargeQuoteService,
    @Optional() private readonly paymentCancellationFinalizer?: PaymentCancellationFinalizerService,
  ) {
    this.reservationFinalizationService =
      reservationFinalizationService
      ?? new ReservationFinalizationService(
        db,
        tossClient,
        bookingService,
        bookingGateway,
        qrTicketService,
        providerChargeQuoteService,
      );
  }

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

  private async countUserActiveTicketsForPerformance(
    userId: string,
    performanceId: string,
  ): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT count(*)::int AS active_ticket_count
      FROM ticket_items ti
      INNER JOIN reservations r ON r.id = ti.reservation_id
      INNER JOIN showtimes s ON s.id = ti.showtime_id
      WHERE r.user_id = ${userId}
        AND s.performance_id = ${performanceId}
        AND r.status = 'CONFIRMED'
        AND ti.status IN ('active', 'cancellation_pending')
    `);
    const count = (result.rows[0] as { active_ticket_count?: unknown } | undefined)
      ?.active_ticket_count;

    return typeof count === 'number' ? count : Number(count ?? 0);
  }

  private async assertUserTicketLimitAvailable(input: {
    userId: string;
    performanceId: string;
    requestedSeatCount: number;
    maxTicketsPerUser: number;
  }): Promise<void> {
    const activeTicketCount = await this.countUserActiveTicketsForPerformance(
      input.userId,
      input.performanceId,
    );

    if (activeTicketCount + input.requestedSeatCount > input.maxTicketsPerUser) {
      throw new ConflictException(
        buildMaxTicketsPerUserExceededMessage(input.maxTicketsPerUser),
      );
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

  private calculateTicketServiceFeeTotal(seats: SeatSelection[]): number {
    return seats.length * TICKET_SERVICE_FEE_KRW;
  }

  private calculatePayableTotal(seats: SeatSelection[]): number {
    return this.calculateSeatTotal(seats) + this.calculateTicketServiceFeeTotal(seats);
  }

  private buildForeignProviderChargePrepare(input: {
    paymentMethod: PrepareReservationRequest['paymentMethod'];
    reservationPayableAmount: number;
    now: Date;
  }): {
    checkoutEnabled: boolean;
    disabledReason?: string;
    providerChargeQuote?: ProviderChargeQuote;
    reservationQuoteValues: {
      providerChargeCurrency?: 'USD';
      providerChargeAmountMinor?: number;
      providerChargeRate?: string;
      providerChargeQuotedAt?: Date;
    };
  } | undefined {
    if (!this.usesProviderChargeQuoteForPaymentMethod(input.paymentMethod)) {
      return undefined;
    }

    const availability =
      this.getProviderChargeAvailability(input.paymentMethod.provider)
      ?? {
        enabled: false,
        disabledReason: 'PAYPAL_CHECKOUT_UNAVAILABLE',
      };

    if (!availability.enabled) {
      return {
        checkoutEnabled: false,
        disabledReason: availability.disabledReason,
        reservationQuoteValues: {},
      };
    }

    const quote = this.createProviderChargeQuote({
      provider: input.paymentMethod.provider,
      reservationPayableAmount: input.reservationPayableAmount,
      now: input.now,
    });

    return {
      checkoutEnabled: true,
      providerChargeQuote: quote,
      reservationQuoteValues: this.toReservationProviderQuoteValues(quote),
    };
  }

  private toReservationProviderQuoteValues(
    quote: ForeignEasyPayProviderChargeQuote,
  ): {
    providerChargeCurrency: 'USD';
    providerChargeAmountMinor: number;
    providerChargeRate: string;
    providerChargeQuotedAt: Date;
  } {
    return {
      providerChargeCurrency: quote.currency,
      providerChargeAmountMinor: quote.amountMinor,
      providerChargeRate: quote.rate,
      providerChargeQuotedAt: new Date(quote.quotedAt),
    };
  }

  private buildStoredForeignProviderCharge(input: {
    paymentMethod: PrepareReservationRequest['paymentMethod'];
    providerChargeCurrency?: string | null;
    providerChargeAmountMinor?: number | null;
    providerChargeRate?: string | null;
    providerChargeQuotedAt?: Date | null;
  }): {
    checkoutEnabled: boolean;
    disabledReason?: string;
    providerChargeQuote?: ProviderChargeQuote;
  } | undefined {
    if (!this.usesProviderChargeQuoteForPaymentMethod(input.paymentMethod)) {
      return undefined;
    }

    const availability =
      this.getProviderChargeAvailability(input.paymentMethod.provider)
      ?? {
        enabled: false,
        disabledReason: 'PAYPAL_CHECKOUT_UNAVAILABLE',
      };
    const providerChargeQuote =
      input.providerChargeCurrency === 'USD'
      && typeof input.providerChargeAmountMinor === 'number'
      && input.providerChargeRate
      && input.providerChargeQuotedAt
        ? {
            currency: 'USD' as const,
            amountMinor: input.providerChargeAmountMinor,
            amountDecimal: this.formatProviderMinorToDecimal(
              input.providerChargeAmountMinor,
            ),
            rate: input.providerChargeRate,
            quotedAt: input.providerChargeQuotedAt.toISOString(),
          }
        : undefined;
    const checkoutEnabled = availability.enabled && !!providerChargeQuote;
    const disabledReason = availability.enabled
      ? providerChargeQuote ? undefined : 'PAYPAL_PROVIDER_CHARGE_QUOTE_MISSING'
      : availability.disabledReason;

    return {
      checkoutEnabled,
      ...(disabledReason ? { disabledReason } : {}),
      ...(providerChargeQuote ? { providerChargeQuote } : {}),
    };
  }

  private formatProviderMinorToDecimal(amountMinor: number): string {
    const whole = Math.floor(amountMinor / 100);
    const fraction = String(amountMinor % 100).padStart(2, '0');
    return `${whole}.${fraction}`;
  }

  private usesProviderChargeQuote(
    provider: PrepareReservationRequest['paymentMethod']['provider'],
  ): boolean {
    return provider === 'PAYPAL' || provider === 'ALIPAY_PLUS';
  }

  private usesProviderChargeQuoteForPaymentMethod(
    paymentMethod: PrepareReservationRequest['paymentMethod'] | undefined,
  ): boolean {
    if (!paymentMethod) {
      return false;
    }

    return (
      paymentMethod.method === 'FOREIGN_EASY_PAY'
      && this.usesProviderChargeQuote(paymentMethod.provider)
    ) || (
      paymentMethod.method === 'CARD'
      && paymentMethod.provider === 'CARD'
      && paymentMethod.currency?.toUpperCase() === 'USD'
      && paymentMethod.overseasPaymentConsent?.required === true
    );
  }

  private getProviderChargeAvailability(
    provider: PrepareReservationRequest['paymentMethod']['provider'],
  ):
    | { enabled: boolean; disabledReason?: string }
    | undefined {
    const service = this.providerChargeQuoteService as
      | {
          getAlipayAvailability?: () => { enabled: boolean; disabledReason?: string };
          getForeignEasyPayAvailability?: () => { enabled: boolean; disabledReason?: string };
          getPaypalAvailability?: () => { enabled: boolean; disabledReason?: string };
        }
      | undefined;

    if (provider === 'ALIPAY_PLUS') {
      return service?.getAlipayAvailability?.()
        ?? service?.getForeignEasyPayAvailability?.();
    }

    return service?.getPaypalAvailability?.()
      ?? service?.getForeignEasyPayAvailability?.();
  }

  private createProviderChargeQuote(input: {
    provider: PrepareReservationRequest['paymentMethod']['provider'];
    reservationPayableAmount: number;
    now: Date;
  }): ForeignEasyPayProviderChargeQuote {
    const service = this.providerChargeQuoteService as {
      createForeignEasyPayQuote?: (quoteInput: {
        reservationPayableAmount: number;
        now: Date;
      }) => ForeignEasyPayProviderChargeQuote;
      createPaypalQuote?: (quoteInput: {
        reservationPayableAmount: number;
        now: Date;
      }) => ForeignEasyPayProviderChargeQuote;
    };

    const createQuote = input.provider === 'ALIPAY_PLUS'
      ? service.createForeignEasyPayQuote ?? service.createPaypalQuote
      : service.createPaypalQuote ?? service.createForeignEasyPayQuote;
    if (!createQuote) {
      throw new Error('Provider charge quote service is not configured');
    }

    return createQuote.call(service, {
      reservationPayableAmount: input.reservationPayableAmount,
      now: input.now,
    });
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
        row.floorKey ?? DEFAULT_SEAT_FLOOR_KEY,
        {
          floorLabel: row.floorLabel ?? DEFAULT_SEAT_FLOOR_LABEL,
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
    return this.calculatePayableTotal(canonicalSeats);
  }

  calculateCancelDeadline(showDateTime: Date): Date {
    return new Date(showDateTime.getTime() - 24 * 60 * 60 * 1000);
  }

  private toDate(value: Date | string | null | undefined, fieldName: string): Date {
    const date = value instanceof Date ? value : new Date(value ?? '');
    if (Number.isNaN(date.getTime())) {
      throw new InternalServerErrorException(`${fieldName} 값이 유효하지 않습니다`);
    }

    return date;
  }

  private getSeoulDayOrdinal(date: Date): number {
    const parts = seoulDateFormatter.formatToParts(date);
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);

    return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
  }

  private calculateTicketItemCancellationQuote(input: {
    price: number;
    serviceFee: number;
    reservationCreatedAt: Date;
    showtimeAt: Date;
    now?: Date;
  }): TicketItemCancellationQuote {
    const now = input.now ?? new Date();
    const today = this.getSeoulDayOrdinal(now);
    const bookingDay = this.getSeoulDayOrdinal(input.reservationCreatedAt);
    const showDay = this.getSeoulDayOrdinal(input.showtimeAt);
    const daysBeforeShow = showDay - today;

    if (daysBeforeShow <= 0) {
      throw new ForbiddenException('관람일 당일에는 취소할 수 없습니다');
    }

    if (today === bookingDay) {
      return {
        cancellationFee: 0,
        serviceFeeRefund: input.serviceFee,
        refundableAmount: input.price + input.serviceFee,
      };
    }

    let cancellationFee = 0;
    if (daysBeforeShow <= 2) {
      cancellationFee = Math.floor(input.price * 0.3);
    } else if (daysBeforeShow <= 6) {
      cancellationFee = Math.floor(input.price * 0.2);
    } else if (daysBeforeShow <= 9) {
      cancellationFee = Math.floor(input.price * 0.1);
    } else {
      const daysAfterBooking = Math.max(0, today - bookingDay);
      cancellationFee =
        daysAfterBooking <= 7
          ? 0
          : Math.min(4000, Math.floor(input.price * 0.1));
    }

    return {
      cancellationFee,
      serviceFeeRefund: 0,
      refundableAmount: Math.max(0, input.price - cancellationFee),
    };
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
    if (performanceStatus === 'ended') {
      throw new ForbiddenException(BOOKING_ENDED_MESSAGE);
    }
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
        providerChargeCurrency: reservations.providerChargeCurrency,
        providerChargeAmountMinor: reservations.providerChargeAmountMinor,
        providerChargeRate: reservations.providerChargeRate,
        providerChargeQuotedAt: reservations.providerChargeQuotedAt,
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
      await this.assertUserTicketLimitAvailable({
        userId,
        performanceId: existingShowtime.performanceId,
        requestedSeatCount: canonicalSeats.length,
        maxTicketsPerUser: existingShowtime.maxTicketsPerUser,
      });
      const expectedAmount = this.calculatePayableTotal(canonicalSeats);
      if (existing.totalAmount !== expectedAmount || dto.amount !== expectedAmount) {
        throw new ConflictException('기존 예매 요청과 일치하지 않습니다. 새 주문 ID로 다시 시도해주세요.');
      }

      const existingSeats = await this.getReservationSeatSelections(existing.id);
      if (!this.hasSameSeatSelections(existingSeats, canonicalSeats)) {
        throw new ConflictException('기존 예매 요청과 일치하지 않습니다. 새 주문 ID로 다시 시도해주세요.');
      }

      const existingSeatIds = existingSeats.map((seat) => seat.seatKey);
      await this.bookingService.assertOwnedSeatLocks(userId, existing.showtimeId, existingSeatIds);
      const existingForeignEasyPayCharge = this.buildStoredForeignProviderCharge({
        paymentMethod: dto.paymentMethod,
        providerChargeCurrency: existing.providerChargeCurrency,
        providerChargeAmountMinor: existing.providerChargeAmountMinor,
        providerChargeRate: existing.providerChargeRate,
        providerChargeQuotedAt: existing.providerChargeQuotedAt,
      });

      return {
        reservationId: existing.id,
        orderId: dto.orderId,
        queueAdmission: dto.queueAdmission,
        paymentDeadlineAt:
          existing.paymentDeadlineAt?.toISOString()
          ?? dto.paymentDeadlineAt,
        bookingPolicy: existingShowtime.bookingPolicy,
        paymentMethod: dto.paymentMethod,
        ...(existingForeignEasyPayCharge ?? {}),
      };
    }

    // 2. Get showtime to determine performanceId and dateTime
    const showtime = await this.getShowtimeBookingContext(dto.showtimeId);
    this.assertPerformanceBookingOpen(showtime.performanceStatus, actor);

    // 3. Calculate expected amount from DB and canonical seat map metadata
    const canonicalSeats = await this.getCanonicalSeatSelections(dto.seats, showtime.performanceId);
    this.assertSeatCountWithinPolicy(canonicalSeats, showtime.maxTicketsPerUser);
    await this.assertUserTicketLimitAvailable({
      userId,
      performanceId: showtime.performanceId,
      requestedSeatCount: canonicalSeats.length,
      maxTicketsPerUser: showtime.maxTicketsPerUser,
    });
    const expectedAmount = this.calculatePayableTotal(canonicalSeats);

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
    const foreignEasyPayCharge = this.buildForeignProviderChargePrepare({
      paymentMethod: dto.paymentMethod,
      reservationPayableAmount: expectedAmount,
      now: preparedAt,
    });

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
          ...(foreignEasyPayCharge?.reservationQuoteValues ?? {}),
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
      ...(foreignEasyPayCharge
        ? {
            checkoutEnabled: foreignEasyPayCharge.checkoutEnabled,
            ...(foreignEasyPayCharge.disabledReason
              ? { disabledReason: foreignEasyPayCharge.disabledReason }
              : {}),
            ...(foreignEasyPayCharge.providerChargeQuote
              ? { providerChargeQuote: foreignEasyPayCharge.providerChargeQuote }
              : {}),
          }
        : {}),
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

    const result = await this.reservationFinalizationService.confirmAndCreateReservation(
      dto,
      userId,
    );

    return this.getReservationDetail(result.reservationId, userId);
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

    const ticketItemRows = await this.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.reservationId, reservationId))
      .orderBy(asc(ticketItems.createdAt), asc(ticketItems.id));

    let qrTickets: QrTicket[] = [];
    if (
      row.reservation.status === 'CONFIRMED'
      && payment?.id
      && payment.status === 'DONE'
      && this.qrTicketService
      && ticketItemRows.some((ticketItem) => ticketItem.status === 'active')
    ) {
      qrTickets = await this.qrTicketService.ensureIssuedTicketsForReservation({
        reservationId,
        paymentId: payment.id,
      });
    }
    const ticketItemDtos = ticketItemRows.length > 0
      ? this.mapTicketItems(ticketItemRows, qrTickets)
      : this.mapReservationSeatsToTicketItems({
          seats,
          reservationId,
          paymentId: payment?.id ?? PLACEHOLDER_UUID,
          showtimeId: row.reservation.showtimeId,
        });
    const qrTicket = qrTickets.find((ticket) => ticket.status === 'ACTIVE' && ticket.token)
      ?? this.createBlockingQrTicket(row.reservation.createdAt);
    const [ticketEmailUser] = await this.db
      .select({
        email: users.email,
        isEmailVerified: users.isEmailVerified,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!ticketEmailUser) {
      throw new NotFoundException('사용자를 찾을 수 없습니다');
    }
    const scheduledAt =
      qrTickets.find((ticket) => ticket.emailScheduledAt)?.emailScheduledAt ?? null;
    const sentAtValues = qrTickets
      .map((ticket) => ticket.emailedAt)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .sort();
    const lastSentAt = sentAtValues.at(-1) ?? null;

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
      ticketEmailDelivery: resolveTicketEmailDelivery({
        email: ticketEmailUser.email,
        isEmailVerified: ticketEmailUser.isEmailVerified,
        scheduledAt,
        lastSentAt,
      }),
      ticketItems: ticketItemDtos,
    };
  }

  private mapTicketItems(rows: TicketItemRow[], qrTickets: QrTicket[]): TicketItem[] {
    const activeQrByTicketItemId = new Map(
      qrTickets
        .filter((ticket) => ticket.ticketItemId)
        .map((ticket) => [ticket.ticketItemId, ticket]),
    );

    return rows.map((row) => this.mapTicketItem(row, activeQrByTicketItemId.get(row.id)));
  }

  private mapReservationSeatsToTicketItems(input: {
    seats: ReservationSeatRow[];
    reservationId: string;
    paymentId: string;
    showtimeId: string;
  }): TicketItem[] {
    return input.seats.map((seat, index) => {
      const floorSeat = toFloorAwareSeatSelection({
        seatId: seat.seatId,
        tierName: seat.tierName,
        price: seat.price,
        row: seat.row,
        number: seat.number,
      });

      return {
        id: seat.id ?? `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        reservationId: input.reservationId,
        paymentId: input.paymentId,
        showtimeId: input.showtimeId,
        seatId: floorSeat.seatId,
        seatKey: floorSeat.seatKey,
        floorKey: floorSeat.floorKey,
        floorLabel: floorSeat.floorLabel,
        row: floorSeat.row,
        number: floorSeat.number,
        tierName: floorSeat.tierName,
        price: floorSeat.price,
        serviceFee: TICKET_SERVICE_FEE_KRW,
        status: 'ACTIVE',
        admissionState: 'NOT_ENTERED',
        enteredAt: null,
        qrCredential: null,
        cancellation: null,
      };
    });
  }

  private mapTicketItem(row: TicketItemRow, qrTicket?: QrTicket): TicketItem {
    return {
      id: row.id,
      reservationId: row.reservationId,
      paymentId: row.paymentId,
      showtimeId: row.showtimeId,
      seatId: row.seatId,
      seatKey: row.seatKey,
      floorKey: row.floorKey,
      floorLabel: row.floorLabel,
      row: row.row,
      number: row.number,
      tierName: row.tierName,
      price: row.price,
      serviceFee: row.serviceFee === 0 ? 0 : TICKET_SERVICE_FEE_KRW,
      status: this.mapTicketItemStatus(row.status),
      admissionState: this.mapTicketItemAdmissionState(row.admissionState),
      enteredAt: row.enteredAt?.toISOString() ?? null,
      qrCredential: this.mapTicketItemQrCredential(qrTicket),
      cancellation: this.mapTicketItemCancellation(row),
    };
  }

  private mapTicketItemStatus(status: TicketItemRow['status']): TicketItem['status'] {
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

  private mapTicketItemAdmissionState(
    admissionState: TicketItemRow['admissionState'],
  ): TicketItem['admissionState'] {
    return admissionState === 'entered' ? 'ENTERED' : 'NOT_ENTERED';
  }

  private mapTicketItemQrCredential(qrTicket?: QrTicket): TicketItem['qrCredential'] {
    if (
      !qrTicket
      || qrTicket.status !== 'ACTIVE'
      || !qrTicket.id
      || !qrTicket.token
      || !qrTicket.jti
    ) {
      return null;
    }

    return {
      id: qrTicket.id,
      token: qrTicket.token,
      jti: qrTicket.jti,
      status: 'ACTIVE',
      issuedAt: qrTicket.issuedAt,
      rotatedAt: null,
      revokedAt: null,
    };
  }

  private mapTicketItemCancellation(row: TicketItemRow): TicketItem['cancellation'] {
    if (!row.cancelledAt) {
      return null;
    }

    return {
      cancelledAt: row.cancelledAt.toISOString(),
      cancelReason: row.cancelReason ?? '취소',
      cancellationFee: row.cancellationFee,
      serviceFeeRefund: row.serviceFeeRefund,
      refundableAmount: row.refundableAmount,
      refundStatus: row.reopenState === 'available' || row.reopenState === 'manual_opened'
        ? 'COMPLETED'
        : 'PROCESSING_AT_PG',
      reopenState: this.mapTicketItemReopenState(row.reopenState),
      reopenAt: row.reopenHoldUntil?.toISOString() ?? null,
    };
  }

  private mapTicketItemReopenState(
    reopenState: TicketItemRow['reopenState'],
  ): NonNullable<TicketItem['cancellation']>['reopenState'] {
    switch (reopenState) {
      case 'held_cancelled':
        return 'HELD_CANCELLED';
      case 'manual_opened':
        return 'MANUAL_OPENED';
      case 'available':
      case 'not_required':
      default:
        return 'AVAILABLE';
    }
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

  private mapTicketItemCancellationContext(
    row: Record<string, unknown> | undefined,
    userId: string,
  ): TicketItemCancellationContext {
    if (!row || row['user_id'] !== userId) {
      throw new NotFoundException('예매를 찾을 수 없습니다');
    }

    return {
      reservationId: String(row['reservation_id']),
      userId: String(row['user_id']),
      showtimeId: String(row['showtime_id']),
      reservationNumber: row['reservation_number']
        ? String(row['reservation_number'])
        : undefined,
      reservationStatus: String(row['reservation_status']),
      reservationCreatedAt: this.toDate(
        row['reservation_created_at'] as Date | string,
        'reservation_created_at',
      ),
      showtimeAt: this.toDate(row['showtime_at'] as Date | string, 'showtime_at'),
      paymentId: String(row['payment_id']),
      paymentKey: String(row['payment_key']),
      paymentMethod: String(row['payment_method']),
      paymentProvider: String(row['payment_provider']),
      paymentCurrency: String(row['payment_currency']),
      paymentAmount: Number(row['payment_amount']),
      providerMetadata: row['provider_metadata'] ?? undefined,
      providerChargeCurrency: row['provider_charge_currency']
        ? String(row['provider_charge_currency'])
        : null,
      providerChargeAmountMinor:
        row['provider_charge_amount_minor'] === null
          || row['provider_charge_amount_minor'] === undefined
          ? null
          : Number(row['provider_charge_amount_minor']),
      paymentStatus: String(row['payment_status']),
      bookingPolicy:
        row['cancelled_seat_hold_min_minutes'] === null
          && row['cancelled_seat_hold_max_minutes'] === null
          ? null
          : {
              cancelledSeatHoldMinMinutes:
                row['cancelled_seat_hold_min_minutes'] === null
                  || row['cancelled_seat_hold_min_minutes'] === undefined
                  ? null
                  : Number(row['cancelled_seat_hold_min_minutes']),
              cancelledSeatHoldMaxMinutes:
                row['cancelled_seat_hold_max_minutes'] === null
                  || row['cancelled_seat_hold_max_minutes'] === undefined
                  ? null
                  : Number(row['cancelled_seat_hold_max_minutes']),
            },
      ticketItemId: String(row['ticket_item_id']),
      ticketItemStatus: String(row['ticket_item_status']),
      admissionState: String(row['admission_state']),
      seatId: String(row['seat_id']),
      seatKey: String(row['seat_key']),
      floorKey: String(row['floor_key']),
      price: Number(row['price']),
      serviceFee: Number(row['service_fee'] ?? 0),
      cancelledAt: row['cancelled_at']
        ? this.toDate(row['cancelled_at'] as Date | string, 'cancelled_at')
        : null,
      cancelReason: row['cancel_reason'] ? String(row['cancel_reason']) : null,
      cancellationFee: Number(row['cancellation_fee'] ?? 0),
      serviceFeeRefund: Number(row['service_fee_refund'] ?? 0),
      refundableAmount: Number(row['refundable_amount'] ?? 0),
    };
  }

  private assertTicketItemCancellable(context: TicketItemCancellationContext): void {
    if (context.reservationStatus !== 'CONFIRMED') {
      throw new BadRequestException('취소할 수 없는 예매 상태입니다');
    }
    if (context.paymentStatus !== 'DONE') {
      throw new BadRequestException('취소할 수 없는 결제 상태입니다');
    }
    if (
      context.ticketItemStatus !== 'active' &&
      context.ticketItemStatus !== 'cancellation_pending'
    ) {
      throw new BadRequestException('취소할 수 없는 티켓 상태입니다');
    }
    if (context.admissionState === 'entered') {
      throw new BadRequestException('입장 처리된 티켓은 취소할 수 없습니다');
    }
  }

  private countMatchingCompletedTossCancellations(
    payment: TossPaymentResponse,
    request: PaymentCancelRequest,
  ): number {
    return payment.cancels?.filter((cancel) => {
      if (!this.isTossCancelEntryCompleted(cancel)) {
        return false;
      }
      if (request.options.cancelRequestId) {
        return cancel.cancelRequestId === request.options.cancelRequestId;
      }
      return (
        request.options.cancelAmount !== undefined
        && cancel.cancelAmount === request.options.cancelAmount
        && cancel.cancelReason === request.reason
      );
    }).length ?? 0;
  }

  private hasMatchingInProgressTossCancellation(
    payment: TossPaymentResponse,
    request: PaymentCancelRequest,
  ): boolean {
    const cancelRequestId = request.options.cancelRequestId;
    if (!cancelRequestId) {
      return false;
    }
    return payment.cancels?.some((cancel) =>
      cancel.cancelRequestId === cancelRequestId
      && cancel.cancelStatus === 'IN_PROGRESS'
    ) ?? false;
  }

  private isTossCancelEntryCompleted(
    cancel: NonNullable<TossPaymentResponse['cancels']>[number],
  ): boolean {
    return cancel.cancelStatus === undefined || cancel.cancelStatus === 'DONE';
  }

  private isFullTossCancelCompleted(payment: TossPaymentResponse): boolean {
    return payment.status === 'CANCELED';
  }

  private async cancelTicketItemPaymentOrConfirm(input: {
    request: PaymentCancelRequest;
    ticketItemId: string;
    isPendingRetry: boolean;
    isFullPaymentCancellation: boolean;
  }): Promise<TicketItemPaymentCancelOutcome> {
    let matchingCancelsBefore: number | undefined;
    let matchingCancelsAfter: number | undefined;
    const queryOptions = {
      secretKeyScope: input.request.options.secretKeyScope,
    };
    try {
      const beforePayment = await this.tossClient.queryPayment(
        input.request.paymentKey,
        queryOptions,
      );
      if (
        input.isFullPaymentCancellation
        && this.isFullTossCancelCompleted(beforePayment)
      ) {
        return { status: 'cancelled', providerResponse: beforePayment };
      }
      matchingCancelsBefore = this.countMatchingCompletedTossCancellations(
        beforePayment,
        input.request,
      );
    } catch (queryError) {
      this.logger.error(
        `Toss ticket-item pre-cancel snapshot failed. ticketItemId=${input.ticketItemId}`,
        queryError instanceof Error ? queryError.stack : String(queryError),
      );
    }

    try {
      const response = await this.tossClient.cancelPayment(
        input.request.paymentKey,
        input.request.reason,
        input.request.options,
      );
      if (input.isFullPaymentCancellation) {
        return this.isFullTossCancelCompleted(response)
          ? { status: 'cancelled', providerResponse: response }
          : { status: 'ambiguous' };
      }
      return this.countMatchingCompletedTossCancellations(response, input.request) > 0
        ? { status: 'cancelled', providerResponse: response }
        : { status: 'ambiguous' };
    } catch (cancelError) {
      try {
        const payment = await this.tossClient.queryPayment(
          input.request.paymentKey,
          queryOptions,
        );
        if (
          input.isFullPaymentCancellation
          && this.isFullTossCancelCompleted(payment)
        ) {
          this.logger.warn(
            `Recovered Toss full ticket-item cancel from payment snapshot. ticketItemId=${input.ticketItemId}`,
          );
          return { status: 'cancelled', providerResponse: payment };
        }
        if (
          input.isFullPaymentCancellation
          && this.hasMatchingInProgressTossCancellation(payment, input.request)
        ) {
          return { status: 'ambiguous' };
        }
        matchingCancelsAfter = this.countMatchingCompletedTossCancellations(
          payment,
          input.request,
        );
        if (
          !input.isFullPaymentCancellation
          && input.request.options.cancelRequestId !== undefined
          && matchingCancelsBefore !== undefined
          && matchingCancelsAfter > matchingCancelsBefore
        ) {
          this.logger.warn(
            `Recovered Toss ticket-item cancel from payment snapshot. ticketItemId=${input.ticketItemId}`,
          );
          return { status: 'cancelled', providerResponse: payment };
        }
      } catch (queryError) {
        this.logger.error(
          `Toss ticket-item cancel reconciliation query failed. ticketItemId=${input.ticketItemId}`,
          queryError instanceof Error ? queryError.stack : String(queryError),
        );
      }

      if (this.isDefiniteTossCancelFailure(cancelError)) {
        if (input.isPendingRetry) {
          const snapshotCounts = [matchingCancelsBefore, matchingCancelsAfter];
          if (snapshotCounts.some((count) => count !== undefined && count > 0)) {
            return { status: 'ambiguous' };
          }
          if (snapshotCounts.some((count) => count === 0)) {
            return { status: 'definite_failure' };
          }
          return { status: 'ambiguous' };
        }
        return { status: 'definite_failure' };
      }

      return { status: 'ambiguous' };
    }
  }

  private toPaymentCancelTicketItemSnapshot(
    row: Record<string, unknown>,
  ): TicketItemCancellationSnapshot {
    return {
      id: String(row['id']),
      refundableAmount: Number(row['refundable_amount'] ?? 0),
      seatId: String(row['seat_id']),
    };
  }

  private buildTicketItemFinalizerContext(input: {
    context: TicketItemCancellationContext;
    activeTicketItems: TicketItemCancellationSnapshot[];
  }): FullPaymentCancellationContext {
    return {
      reservation: {
        id: input.context.reservationId,
        showtimeId: input.context.showtimeId,
        ...(input.context.reservationNumber
          ? { reservationNumber: input.context.reservationNumber }
          : {}),
      },
      payment: {
        id: input.context.paymentId,
        paymentKey: input.context.paymentKey,
        providerMetadata: input.context.providerMetadata,
      },
      bookingPolicy: input.context.bookingPolicy,
      seats: input.activeTicketItems.map((ticketItem) => ({
        seatId: ticketItem.seatId,
      })),
    };
  }

  private buildTicketItemPaymentCancelRequest(input: {
    context: TicketItemCancellationContext;
    quote: TicketItemCancellationQuote;
    activeTicketItems: TicketItemCancellationSnapshot[];
    reason: string;
  }): PaymentCancelRequest {
    const currentTicketItem = {
      id: input.context.ticketItemId,
      refundableAmount: input.quote.refundableAmount,
    };
    const activeTicketItems = input.activeTicketItems.some((item) =>
      item.id === currentTicketItem.id
    )
      ? input.activeTicketItems.map((item) =>
          item.id === currentTicketItem.id ? currentTicketItem : item
        )
      : [currentTicketItem, ...input.activeTicketItems];

    return buildTicketItemPaymentCancelRequest({
      payment: {
        id: input.context.paymentId,
        paymentKey: input.context.paymentKey,
        method: input.context.paymentMethod,
        provider: input.context.paymentProvider,
        currency: input.context.paymentCurrency,
        amount: input.context.paymentAmount,
        providerMetadata: input.context.providerMetadata,
        providerChargeCurrency: input.context.providerChargeCurrency,
        providerChargeAmountMinor: input.context.providerChargeAmountMinor,
      },
      ticketItem: currentTicketItem,
      activeTicketItems,
      reason: input.reason,
    });
  }

  private isDefiniteTossCancelFailure(error: unknown): boolean {
    if (error instanceof TossPaymentError) {
      return true;
    }

    const candidate = error as { name?: unknown; code?: unknown };
    return candidate.name === 'TossPaymentError' && typeof candidate.code === 'string';
  }

  async cancelTicketItem(
    reservationId: string,
    ticketItemId: string,
    userId: string,
    reason: string,
  ): Promise<ReservationDetail> {
    let seatToBroadcast: { showtimeId: string; seatKey: string } | undefined;
    let preparedCancellation: PreparedTicketItemCancellation | undefined;
    let tossCancelAttempted = false;
    let tossCancelSucceeded = false;

    try {
      preparedCancellation = await this.db.transaction(async (tx) => {
        const result = await tx.execute(sql`
          SELECT
            r.id AS reservation_id,
            r.user_id,
            r.showtime_id,
            r.reservation_number,
            r.status AS reservation_status,
            r.created_at AS reservation_created_at,
            s.date_time AS showtime_at,
            p.id AS payment_id,
            p.payment_key,
            p.method AS payment_method,
            p.provider AS payment_provider,
            p.currency AS payment_currency,
            p.amount AS payment_amount,
            p.provider_metadata,
            p.provider_charge_currency,
            p.provider_charge_amount_minor,
            p.status AS payment_status,
            bp.cancelled_seat_hold_min_minutes,
            bp.cancelled_seat_hold_max_minutes,
            ti.id AS ticket_item_id,
            ti.status AS ticket_item_status,
            ti.admission_state,
            ti.seat_id,
            ti.seat_key,
            ti.floor_key,
            ti.price,
            ti.service_fee,
            ti.cancelled_at,
            ti.cancel_reason,
            ti.cancellation_fee,
            ti.service_fee_refund,
            ti.refundable_amount
          FROM reservations r
          INNER JOIN payments p ON p.reservation_id = r.id
          INNER JOIN ticket_items ti
            ON ti.reservation_id = r.id
            AND ti.payment_id = p.id
          INNER JOIN showtimes s ON s.id = r.showtime_id
          LEFT JOIN booking_policies bp ON bp.performance_id = s.performance_id
          WHERE r.id = ${reservationId}
            AND ti.id = ${ticketItemId}
          FOR UPDATE OF r, p, ti
        `);
        const context = this.mapTicketItemCancellationContext(
          result.rows[0] as Record<string, unknown> | undefined,
          userId,
        );
        this.assertTicketItemCancellable(context);

        const now = new Date();
        const isPendingRetry = context.ticketItemStatus === 'cancellation_pending';
        const quote = isPendingRetry
          ? {
              cancellationFee: context.cancellationFee,
              serviceFeeRefund: context.serviceFeeRefund,
              refundableAmount: context.refundableAmount,
            }
          : this.calculateTicketItemCancellationQuote({
              price: context.price,
              serviceFee: context.serviceFee,
              reservationCreatedAt: context.reservationCreatedAt,
              showtimeAt: context.showtimeAt,
            });
        const cancellationReason = isPendingRetry && context.cancelReason
          ? context.cancelReason
          : reason;
        const preparedAt = isPendingRetry && context.cancelledAt
          ? context.cancelledAt
          : now;
        const activeTicketItemResult = await tx.execute(sql`
          SELECT
            ti.id,
            ti.refundable_amount,
            ti.seat_id
          FROM ticket_items ti
          WHERE ti.reservation_id = ${reservationId}
            AND ti.payment_id = ${context.paymentId}
            AND ti.status IN ('active', 'cancellation_pending')
          FOR UPDATE OF ti
        `);
        const activeTicketItems = activeTicketItemResult.rows.map((row) =>
          this.toPaymentCancelTicketItemSnapshot(row as Record<string, unknown>)
        );
        const finalizerContext = this.buildTicketItemFinalizerContext({
          context,
          activeTicketItems,
        });
        const paymentCancelRequest = this.buildTicketItemPaymentCancelRequest({
          context,
          quote,
          activeTicketItems,
          reason: cancellationReason,
        });

        await tx
          .update(ticketItems)
          .set({
            status: 'cancellation_pending',
            cancelledAt: preparedAt,
            cancelReason: cancellationReason,
            cancellationFee: quote.cancellationFee,
            serviceFeeRefund: quote.serviceFeeRefund,
            refundableAmount: quote.refundableAmount,
            reopenState: 'held_cancelled',
            reopenHoldUntil: null,
            reopenJobId: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(ticketItems.id, ticketItemId),
              eq(ticketItems.reservationId, reservationId),
              inArray(ticketItems.status, ['active', 'cancellation_pending']),
            ),
          );

        await tx
          .update(tickets)
          .set({
            status: 'revoked',
            revokedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(tickets.ticketItemId, ticketItemId),
              eq(tickets.status, 'active'),
            ),
          );

        return {
          context,
          quote,
          reason: cancellationReason,
          isPendingRetry,
          paymentCancelRequest,
          isFullPaymentCancellation:
            paymentCancelRequest.options.cancelAmount === undefined,
          finalizerContext,
          now: preparedAt,
        };
      });

      if (preparedCancellation.quote.refundableAmount > 0) {
        tossCancelAttempted = true;
        const cancelOutcome = await this.cancelTicketItemPaymentOrConfirm({
          request: preparedCancellation.paymentCancelRequest,
          ticketItemId,
          isPendingRetry: preparedCancellation.isPendingRetry,
          isFullPaymentCancellation: preparedCancellation.isFullPaymentCancellation,
        });

        if (cancelOutcome.status === 'definite_failure') {
          await this.restorePreparedTicketItemCancellation(
            reservationId,
            ticketItemId,
            preparedCancellation.now,
          );
          throw new InternalServerErrorException(
            '취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.',
          );
        }

        if (cancelOutcome.status === 'ambiguous') {
          this.logger.error(
            `CRITICAL: Toss ticket-item cancel outcome is unresolved. ticketItemId=${ticketItemId}. Ticket remains cancellation_pending pending manual reconciliation.`,
          );
          throw new InternalServerErrorException(
            '취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.',
          );
        }

        tossCancelSucceeded = true;
        if (preparedCancellation.isFullPaymentCancellation) {
          if (!this.paymentCancellationFinalizer) {
            throw new InternalServerErrorException(
              '취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.',
            );
          }
          try {
            await this.paymentCancellationFinalizer.finalizeFullPaymentCancellation({
              source: 'ticket_item',
              context: preparedCancellation.finalizerContext,
              reason: preparedCancellation.reason,
              ticketItemCancellation: {
                ticketItemId,
                cancellationFee: preparedCancellation.quote.cancellationFee,
                serviceFeeRefund: preparedCancellation.quote.serviceFeeRefund,
                refundableAmount: preparedCancellation.quote.refundableAmount,
              },
              providerResponse:
                cancelOutcome.providerResponse as unknown as Record<string, unknown>,
              actor: { kind: 'user' },
            });
          } catch (finalizerError) {
            this.logger.error(
              `CRITICAL: full ticket-item cancellation finalization failed after Toss cancel. ticketItemId=${ticketItemId}. Manual reconciliation required.`,
              finalizerError instanceof Error
                ? finalizerError.stack
                : String(finalizerError),
            );
            throw new InternalServerErrorException(
              '취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.',
            );
          }
          return this.getReservationDetail(reservationId, userId);
        }
      }

      const committedCancellation = preparedCancellation;
      seatToBroadcast = await this.db.transaction(async (tx) => {
        await tx
          .update(ticketItems)
          .set({
            status: 'cancelled',
            reopenState: 'available',
            reopenHoldUntil: null,
            reopenJobId: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ticketItems.id, ticketItemId),
              eq(ticketItems.reservationId, reservationId),
              eq(ticketItems.status, 'cancellation_pending'),
            ),
          );

        const unresolvedSiblings = await tx
          .select({ id: ticketItems.id })
          .from(ticketItems)
          .where(
            and(
              eq(ticketItems.reservationId, reservationId),
              ne(ticketItems.id, ticketItemId),
              inArray(ticketItems.status, ['active', 'cancellation_pending']),
            ),
          );

        await tx
          .update(seatInventories)
          .set({
            status: 'available',
            soldAt: null,
            lockedBy: null,
            lockedUntil: null,
            reopenHoldUntil: null,
            reopenJobId: null,
            heldCancelledAt: null,
          })
          .where(
            and(
              eq(seatInventories.showtimeId, committedCancellation.context.showtimeId),
              eq(seatInventories.floorKey, committedCancellation.context.floorKey),
              or(
                eq(seatInventories.seatKey, committedCancellation.context.seatKey),
                and(
                  sql`${seatInventories.seatKey} IS NULL`,
                  eq(seatInventories.seatId, committedCancellation.context.seatId),
                ),
              ),
            ),
          );

        if (unresolvedSiblings.length === 0) {
          await tx
            .update(reservations)
            .set({
              status: 'CANCELLED',
              cancelledAt: committedCancellation.now,
              cancelReason: committedCancellation.reason,
              updatedAt: new Date(),
            })
            .where(eq(reservations.id, reservationId));
        }

        return {
          showtimeId: committedCancellation.context.showtimeId,
          seatKey: committedCancellation.context.seatKey,
        };
      });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof InternalServerErrorException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      if (preparedCancellation && tossCancelSucceeded) {
        this.logger.error(
          `CRITICAL: ticket-item cancellation failed after Toss cancel. ticketItemId=${ticketItemId}. Manual reconciliation required.`,
          error instanceof Error ? error.stack : String(error),
        );
      } else if (preparedCancellation && tossCancelAttempted) {
        this.logger.error(
          `CRITICAL: Toss ticket-item cancel outcome is unresolved. ticketItemId=${ticketItemId}. Ticket remains cancellation_pending pending manual reconciliation.`,
          error instanceof Error ? error.stack : String(error),
        );
      } else if (preparedCancellation) {
        this.logger.error(
          `Ticket-item cancellation failed after DB prepare. ticketItemId=${ticketItemId}. Attempting compensation.`,
          error instanceof Error ? error.stack : String(error),
        );
        await this.restorePreparedTicketItemCancellation(
          reservationId,
          ticketItemId,
          preparedCancellation.now,
        )
          .catch((restoreError) => {
            this.logger.error(
              `CRITICAL: ticket-item cancellation compensation failed. ticketItemId=${ticketItemId}. Manual reconciliation required.`,
              restoreError instanceof Error ? restoreError.stack : String(restoreError),
            );
          });
      } else {
        this.logger.error(
          `Ticket-item cancellation failed. ticketItemId=${ticketItemId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
      throw new InternalServerErrorException(
        '취소 처리 중 오류가 발생했습니다. 고객센터에 문의해주세요.',
      );
    }

    if (seatToBroadcast) {
      this.bookingGateway.broadcastSeatUpdate(
        seatToBroadcast.showtimeId,
        seatToBroadcast.seatKey,
        'available',
      );
    }

    return this.getReservationDetail(reservationId, userId);
  }

  private async restorePreparedTicketItemCancellation(
    reservationId: string,
    ticketItemId: string,
    revokedAt: Date,
  ): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(ticketItems)
        .set({
          status: 'active',
          cancelledAt: null,
          cancelReason: null,
          cancellationFee: 0,
          serviceFeeRefund: 0,
          refundableAmount: 0,
          reopenState: 'not_required',
          reopenHoldUntil: null,
          reopenJobId: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(ticketItems.id, ticketItemId),
            eq(ticketItems.reservationId, reservationId),
            eq(ticketItems.status, 'cancellation_pending'),
            eq(ticketItems.reopenState, 'held_cancelled'),
          ),
        );

      await tx
        .update(tickets)
        .set({
          status: 'active',
          revokedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(tickets.ticketItemId, ticketItemId),
            eq(tickets.status, 'revoked'),
            eq(tickets.revokedAt, revokedAt),
          ),
        );
    });
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

        const ticketItemRows = await tx
          .select({ id: ticketItems.id })
          .from(ticketItems)
          .where(eq(ticketItems.reservationId, reservationId));

        if (ticketItemRows.length > 0) {
          throw new BadRequestException('좌석별 티켓은 개별 취소를 이용해주세요');
        }

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
