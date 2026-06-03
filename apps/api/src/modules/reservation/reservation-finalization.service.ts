import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import {
  toFloorAwareSeatSelection,
  type ConfirmPaymentRequest,
  type FloorAwareSeatSelection,
} from '@grabit/shared';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  payments,
  reservationSeats,
  reservations,
  seatInventories,
  ticketItems,
} from '../../database/schema/index.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import {
  BookingService,
  PAYMENT_CONFIRM_LOCK_TTL,
} from '../booking/booking.service.js';
import { TossPaymentsClient } from '../payment/toss-payments.client.js';
import { ProviderChargeQuoteService } from '../payment/provider-charge-quote.service.js';
import { QrTicketService } from '../ticket/qr-ticket.service.js';

type ApprovedPaymentSnapshot = {
  existingPaymentId?: string;
  paymentKey: string;
  orderId: string;
  method: string;
  provider: string;
  currency: string;
  totalAmount: number;
  approvedAt: string;
  asyncStatus?: string | null;
  providerChargeCurrency?: string | null;
  providerChargeAmountMinor?: number | null;
  providerChargeRate?: string | null;
  providerChargeQuotedAt?: Date | null;
  providerMetadata?: Record<string, unknown> | null;
};
type PaypalConfirmPaymentRequest = Extract<ConfirmPaymentRequest, { provider: 'PAYPAL' }>;
type OverseasCardConfirmPaymentRequest = Extract<ConfirmPaymentRequest, { provider: 'OVERSEAS_CARD' }>;
type PaypalResolvedProviderCharge = {
  currency: 'USD';
  amountMinor: number;
  amountDecimal: string;
  rate: string;
  quotedAt: Date;
};

const TICKET_SERVICE_FEE_KRW = 2000;
const OVERSEAS_CARD_PROVIDER_METADATA = {
  requestedProvider: 'OVERSEAS_CARD',
  secretKeyScope: 'overseas-card',
} as const;

function isPaypalConfirmPaymentRequest(
  dto: ConfirmPaymentRequest,
): dto is PaypalConfirmPaymentRequest {
  return 'provider' in dto && dto.provider === 'PAYPAL';
}

function isOverseasCardConfirmPaymentRequest(
  dto: ConfirmPaymentRequest,
): dto is OverseasCardConfirmPaymentRequest {
  return 'provider' in dto && dto.provider === 'OVERSEAS_CARD';
}

function createOverseasCardProviderMetadata(): Record<string, unknown> {
  return { ...OVERSEAS_CARD_PROVIDER_METADATA };
}

function getExistingPaymentProviderMetadata(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export interface ReservationFinalizationResult {
  reservationId: string;
}

@Injectable()
export class ReservationFinalizationService {
  private readonly logger = new Logger(ReservationFinalizationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly tossClient: TossPaymentsClient,
    private readonly bookingService: BookingService,
    private readonly bookingGateway: BookingGateway,
    @Optional() private readonly qrTicketService?: QrTicketService,
    @Optional() private readonly providerChargeQuoteService?: ProviderChargeQuoteService,
  ) {}

  async confirmAndCreateReservation(
    dto: ConfirmPaymentRequest,
    userId: string,
  ): Promise<ReservationFinalizationResult> {
    const confirmLockToken = randomUUID();
    const confirmLockAcquired = await this.bookingService.acquirePaymentConfirmLock(
      dto.orderId,
      confirmLockToken,
    );

    if (!confirmLockAcquired) {
      throw new ConflictException('결제 확인이 이미 진행 중입니다.');
    }

    const refreshTimer = this.startPaymentConfirmLockRefresh(
      dto.orderId,
      confirmLockToken,
    );

    try {
      const lockStillOwned = await this.bookingService.refreshPaymentConfirmLock(
        dto.orderId,
        confirmLockToken,
      );
      if (!lockStillOwned) {
        throw new ConflictException('결제 확인이 이미 진행 중입니다.');
      }

      return await this.confirmAndCreateReservationLocked(
        dto,
        userId,
        confirmLockToken,
      );
    } finally {
      clearInterval(refreshTimer);
      try {
        await this.bookingService.releasePaymentConfirmLock(
          dto.orderId,
          confirmLockToken,
        );
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
    const refreshEveryMs = Math.max(
      1000,
      Math.floor(PAYMENT_CONFIRM_LOCK_TTL * 1000 / 2),
    );
    return setInterval(() => {
      void this.bookingService
        .refreshPaymentConfirmLock(orderId, lockToken)
        .catch((refreshError) => {
          this.logger.error(
            `Payment confirm lock refresh failed. orderId=${orderId}`,
            refreshError instanceof Error
              ? refreshError.stack
              : String(refreshError),
          );
        });
    }, refreshEveryMs);
  }

  private startOwnedSeatLockRefresh(
    userId: string,
    showtimeId: string,
    seatIds: string[],
  ): ReturnType<typeof setInterval> {
    const refreshEveryMs = Math.max(
      1000,
      Math.floor(PAYMENT_CONFIRM_LOCK_TTL * 1000 / 2),
    );
    return setInterval(() => {
      void this.bookingService
        .extendOwnedSeatLocks(
          userId,
          showtimeId,
          seatIds,
          PAYMENT_CONFIRM_LOCK_TTL,
        )
        .catch((refreshError) => {
          this.logger.error(
            `Seat lock refresh failed during payment confirm. showtimeId=${showtimeId}`,
            refreshError instanceof Error
              ? refreshError.stack
              : String(refreshError),
          );
        });
    }, refreshEveryMs);
  }

  private async cancelConfirmedPaymentOrThrow(
    paymentKey: string,
    reason: string,
  ): Promise<void> {
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
  ): Promise<ReservationFinalizationResult> {
    const [existingPayment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.tossOrderId, dto.orderId));

    const legacyExistingPayment = existingPayment as
      | { reservationId: string; status?: unknown }
      | undefined;
    if (legacyExistingPayment && !legacyExistingPayment.status) {
      return { reservationId: legacyExistingPayment.reservationId };
    }

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

    if (reservation.status !== 'CONFIRMED' && reservation.status !== 'PENDING_PAYMENT') {
      throw new ConflictException('좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.');
    }

    const pendingSeats = await this.getReservationSeatSelections(reservation.id);
    const expectedAmount = this.calculatePayableTotal(pendingSeats);
    let paypalProviderCharge: PaypalResolvedProviderCharge | null = null;
    let overseasCardProviderCharge: PaypalResolvedProviderCharge | null = null;
    const isOverseasCardConfirm = isOverseasCardConfirmPaymentRequest(dto);
    let confirmAmount: number;
    if (isPaypalConfirmPaymentRequest(dto)) {
      paypalProviderCharge = this.resolvePaypalProviderCharge(dto, reservation);
      confirmAmount = Number(paypalProviderCharge.amountDecimal);
    } else if (
      isOverseasCardConfirm
      && 'providerChargeAmount' in dto
      && dto.providerChargeAmount
    ) {
      overseasCardProviderCharge = this.resolveOverseasCardProviderCharge(dto, reservation);
      confirmAmount = Number(overseasCardProviderCharge.amountDecimal);
    } else if (typeof dto.amount === 'number') {
      confirmAmount = dto.amount;
    } else {
      throw new BadRequestException('해외카드 결제 금액이 필요합니다');
    }
    const providerCharge = paypalProviderCharge ?? overseasCardProviderCharge;
    if (
      reservation.totalAmount !== expectedAmount
      || (!providerCharge && confirmAmount !== expectedAmount)
    ) {
      throw new BadRequestException('금액이 일치하지 않습니다');
    }

    if (reservation.status === 'CONFIRMED') {
      return { reservationId: reservation.id };
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

    if (existingPayment?.status === 'DONE') {
      this.assertExistingDonePaymentMatchesRequest(existingPayment, reservation, dto);
    }

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

    const seatLockRefreshTimer = this.startOwnedSeatLockRefresh(
      userId,
      reservation.showtimeId,
      pendingSeatIds,
    );
    try {
      let approvedPayment: ApprovedPaymentSnapshot;
      if (existingPayment?.status === 'DONE') {
        const hasExistingProviderMetadata =
          existingPayment.providerMetadata !== null
          && existingPayment.providerMetadata !== undefined;
        const existingProviderMetadata = getExistingPaymentProviderMetadata(
          existingPayment.providerMetadata,
        );
        approvedPayment = {
          existingPaymentId: existingPayment.id,
          paymentKey: existingPayment.paymentKey,
          orderId: existingPayment.tossOrderId,
          method: existingPayment.method,
          provider: existingPayment.provider,
          currency: existingPayment.currency,
          totalAmount: existingPayment.amount,
          approvedAt:
            existingPayment.paidAt?.toISOString()
            ?? new Date().toISOString(),
          asyncStatus: existingPayment.asyncStatus,
          providerChargeCurrency: existingPayment.providerChargeCurrency,
          providerChargeAmountMinor: existingPayment.providerChargeAmountMinor,
          providerChargeRate: existingPayment.providerChargeRate,
          providerChargeQuotedAt: existingPayment.providerChargeQuotedAt,
          providerMetadata: existingProviderMetadata
            ?? (!hasExistingProviderMetadata && isOverseasCardConfirm
              ? createOverseasCardProviderMetadata()
              : null),
        };
      } else {
        const tossResponse = await this.tossClient.confirmPayment({
          paymentKey: dto.paymentKey,
          orderId: dto.orderId,
          amount: confirmAmount,
          ...(isOverseasCardConfirm ? { secretKeyScope: 'overseas-card' as const } : {}),
        });

        approvedPayment = {
          paymentKey: tossResponse.paymentKey,
          orderId: tossResponse.orderId,
          method: paypalProviderCharge
            ? tossResponse.method || 'FOREIGN_EASY_PAY'
            : tossResponse.method,
          provider: paypalProviderCharge ? 'PAYPAL' : 'CARD',
          currency: 'KRW',
          totalAmount: providerCharge
            ? reservation.totalAmount
            : tossResponse.totalAmount,
          approvedAt: tossResponse.approvedAt,
          asyncStatus: 'sync',
          providerMetadata: isOverseasCardConfirm
            ? createOverseasCardProviderMetadata()
            : null,
          ...(providerCharge
            ? {
                providerChargeCurrency: providerCharge.currency,
                providerChargeAmountMinor: providerCharge.amountMinor,
                providerChargeRate: providerCharge.rate,
                providerChargeQuotedAt: providerCharge.quotedAt,
              }
            : {}),
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
        await this.bookingService.assertOwnedSeatLocks(
          userId,
          reservation.showtimeId,
          pendingSeatIds,
        );
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
            const providerChargeValues = this.toPaymentProviderChargeValues(approvedPayment);
            const providerMetadataValues = this.toPaymentProviderMetadataValues(approvedPayment);
            await tx
              .update(payments)
              .set({
                status: 'DONE',
                amount: approvedPayment.totalAmount,
                paidAt: new Date(approvedPayment.approvedAt),
                asyncStatus: approvedPayment.asyncStatus ?? 'pending_webhook',
                ...providerChargeValues,
                ...providerMetadataValues,
              })
              .where(eq(payments.id, approvedPayment.existingPaymentId));
          } else {
            const providerChargeValues = this.toPaymentProviderChargeValues(approvedPayment);
            const providerMetadataValues = this.toPaymentProviderMetadataValues(approvedPayment);
            const insertedPayments = await tx
              .insert(payments)
              .values({
                reservationId: reservation.id,
                paymentKey: approvedPayment.paymentKey,
                tossOrderId: approvedPayment.orderId,
                method: approvedPayment.method,
                provider: approvedPayment.provider,
                currency: approvedPayment.currency,
                asyncStatus: approvedPayment.asyncStatus ?? 'sync',
                amount: approvedPayment.totalAmount,
                status: 'DONE',
                paidAt: new Date(approvedPayment.approvedAt),
                ...providerChargeValues,
                ...providerMetadataValues,
              })
              .returning({ id: payments.id });

            committedPaymentId = insertedPayments[0]?.id ?? null;
          }

          if (!committedPaymentId) {
            throw new InternalServerErrorException('결제 정보 저장에 실패했습니다');
          }
          const ticketItemPaymentId = committedPaymentId;

          await tx.insert(ticketItems).values(
            pendingSeats.map((seat) => ({
              reservationId: reservation.id,
              paymentId: ticketItemPaymentId,
              showtimeId: reservation.showtimeId,
              seatId: seat.seatId,
              seatKey: seat.seatKey,
              floorKey: seat.floorKey,
              floorLabel: seat.floorLabel,
              tierName: seat.tierName,
              row: seat.row,
              number: seat.number,
              price: seat.price,
              serviceFee: TICKET_SERVICE_FEE_KRW,
              status: 'active' as const,
              admissionState: 'not_entered' as const,
            })),
          );

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
            return { reservationId: committedPayment.reservationId };
          }
        } catch (lookupError) {
          this.logger.error(
            `Failed to re-read payment after confirm transaction failure. orderId=${dto.orderId}`,
            lookupError instanceof Error ? lookupError.stack : String(lookupError),
          );
        }

        this.logger.error(
          `DB transaction failed after payment approval. paymentKey=${approvedPayment.paymentKey}, orderId=${dto.orderId}`,
          dbError instanceof Error ? dbError.stack : String(dbError),
        );
        await this.cancelConfirmedPaymentOrThrow(
          approvedPayment.paymentKey,
          '서버 오류로 인한 자동 취소',
        );
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

      for (const seat of pendingSeats) {
        this.bookingGateway.broadcastSeatUpdate(
          reservation.showtimeId,
          seat.seatKey,
          'sold',
          userId,
        );
      }

      if (this.qrTicketService && committedPaymentId) {
        await this.qrTicketService.ensureIssuedTicketsForReservation({
          reservationId: reservation.id,
          paymentId: committedPaymentId,
        });
      }

      return { reservationId: reservation.id };
    } finally {
      clearInterval(seatLockRefreshTimer);
    }
  }

  private async getReservationSeatSelections(
    reservationId: string,
  ): Promise<FloorAwareSeatSelection[]> {
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

  private resolvePaypalProviderCharge(
    dto: PaypalConfirmPaymentRequest,
    reservation: {
      providerChargeCurrency?: string | null;
      providerChargeAmountMinor?: number | null;
      providerChargeRate?: string | null;
      providerChargeQuotedAt?: Date | null;
    },
  ): PaypalResolvedProviderCharge {
    if (!this.providerChargeQuoteService) {
      throw new BadRequestException('PayPal 결제 금액을 검증할 수 없습니다');
    }

    let amountMinor: number;
    try {
      amountMinor = this.providerChargeQuoteService.parseProviderDecimalToMinor(
        dto.providerChargeAmount,
      );
    } catch {
      throw new BadRequestException('PayPal 결제 금액이 올바르지 않습니다');
    }

    if (
      reservation.providerChargeCurrency !== 'USD'
      || typeof reservation.providerChargeAmountMinor !== 'number'
      || !reservation.providerChargeRate
      || !reservation.providerChargeQuotedAt
      || reservation.providerChargeAmountMinor !== amountMinor
    ) {
      throw new BadRequestException('PayPal 결제 금액이 일치하지 않습니다');
    }

    return {
      currency: 'USD',
      amountMinor,
      amountDecimal: dto.providerChargeAmount,
      rate: reservation.providerChargeRate,
      quotedAt: reservation.providerChargeQuotedAt,
    };
  }

  private resolveOverseasCardProviderCharge(
    dto: Extract<OverseasCardConfirmPaymentRequest, { providerChargeAmount: string }>,
    reservation: {
      providerChargeCurrency?: string | null;
      providerChargeAmountMinor?: number | null;
      providerChargeRate?: string | null;
      providerChargeQuotedAt?: Date | null;
    },
  ): PaypalResolvedProviderCharge {
    if (!this.providerChargeQuoteService) {
      throw new BadRequestException('해외카드 결제 금액을 검증할 수 없습니다');
    }

    let amountMinor: number;
    try {
      amountMinor = this.providerChargeQuoteService.parseProviderDecimalToMinor(
        dto.providerChargeAmount,
      );
    } catch {
      throw new BadRequestException('해외카드 결제 금액이 올바르지 않습니다');
    }

    if (
      reservation.providerChargeCurrency !== 'USD'
      || typeof reservation.providerChargeAmountMinor !== 'number'
      || !reservation.providerChargeRate
      || !reservation.providerChargeQuotedAt
      || reservation.providerChargeAmountMinor !== amountMinor
    ) {
      throw new BadRequestException('해외카드 결제 금액이 일치하지 않습니다');
    }

    return {
      currency: 'USD',
      amountMinor,
      amountDecimal: dto.providerChargeAmount,
      rate: reservation.providerChargeRate,
      quotedAt: reservation.providerChargeQuotedAt,
    };
  }

  private toPaymentProviderChargeValues(
    approvedPayment: ApprovedPaymentSnapshot,
  ): {
    providerChargeCurrency?: string;
    providerChargeAmountMinor?: number;
    providerChargeRate?: string;
    providerChargeQuotedAt?: Date;
  } {
    if (
      !approvedPayment.providerChargeCurrency
      || typeof approvedPayment.providerChargeAmountMinor !== 'number'
      || !approvedPayment.providerChargeRate
      || !approvedPayment.providerChargeQuotedAt
    ) {
      return {};
    }

    return {
      providerChargeCurrency: approvedPayment.providerChargeCurrency,
      providerChargeAmountMinor: approvedPayment.providerChargeAmountMinor,
      providerChargeRate: approvedPayment.providerChargeRate,
      providerChargeQuotedAt: approvedPayment.providerChargeQuotedAt,
    };
  }

  private toPaymentProviderMetadataValues(
    approvedPayment: ApprovedPaymentSnapshot,
  ): {
    providerMetadata?: Record<string, unknown>;
  } {
    if (!approvedPayment.providerMetadata) {
      return {};
    }

    return { providerMetadata: approvedPayment.providerMetadata };
  }

  private calculatePayableTotal(seats: FloorAwareSeatSelection[]): number {
    const seatTotal = seats.reduce((total, seat) => total + seat.price, 0);
    return seatTotal + seats.length * TICKET_SERVICE_FEE_KRW;
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

  private isPastWindow(
    value: Date | null | undefined,
    now: Date = new Date(),
  ): boolean {
    return value instanceof Date
      && !Number.isNaN(value.getTime())
      && value.getTime() < now.getTime();
  }

  private assertExistingDonePaymentMatchesRequest(
    existingPayment: {
      reservationId: string;
      paymentKey: string;
      tossOrderId: string;
      amount: number;
      provider?: string | null;
      providerChargeAmountMinor?: number | null;
    },
    reservation: {
      id: string;
      totalAmount: number;
      providerChargeAmountMinor?: number | null;
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

    if (isPaypalConfirmPaymentRequest(dto)) {
      const amountMinor =
        this.providerChargeQuoteService?.parseProviderDecimalToMinor(
          dto.providerChargeAmount,
        );

      if (
        existingPayment.provider !== 'PAYPAL'
        || existingPayment.amount !== reservation.totalAmount
        || existingPayment.providerChargeAmountMinor !== amountMinor
        || reservation.providerChargeAmountMinor !== amountMinor
      ) {
        throw new BadRequestException('PayPal 결제 금액이 일치하지 않습니다');
      }
      return;
    }

    if (
      isOverseasCardConfirmPaymentRequest(dto)
      && 'providerChargeAmount' in dto
      && dto.providerChargeAmount
    ) {
      const amountMinor =
        this.providerChargeQuoteService?.parseProviderDecimalToMinor(
          dto.providerChargeAmount,
        );

      if (
        existingPayment.provider !== 'CARD'
        || existingPayment.amount !== reservation.totalAmount
        || existingPayment.providerChargeAmountMinor !== amountMinor
        || reservation.providerChargeAmountMinor !== amountMinor
      ) {
        throw new BadRequestException('해외카드 결제 금액이 일치하지 않습니다');
      }
      return;
    }

    if (
      existingPayment.amount !== reservation.totalAmount
      || existingPayment.amount !== dto.amount
    ) {
      throw new BadRequestException('금액이 일치하지 않습니다');
    }
  }
}
