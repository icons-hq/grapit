import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { CancellationExpectation, TicketItemRefundPreviewResponse } from '@grabit/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { bookingPolicies, payments, refunds, reservations, ticketItems } from '../../src/database/schema/index.js';
import type { TicketItemCancellationCommand } from '../../src/database/schema/ticket-items.js';
import { hasRestoredRefundRights } from '../../src/modules/cancellation/refund-timeline.js';
import { calculateTicketItemCancellationQuote } from '../../src/modules/cancellation/ticket-cancellation-policy.js';
import { buildTicketItemPaymentCancelRequest, withCompletedRefunds, type PaymentCancelRequest, type PaymentCancelTicketItemSnapshot } from '../../src/modules/payment/payment-cancel-policy.js';
import { providerRefundReason } from '../../src/modules/payment/toss-cancel-receipt.js';
import { ReservationService, type PreparedTicketItemCancellation, type TicketItemCancellationContext } from '../../src/modules/reservation/reservation.service.js';

type TicketItemCancellationQuote = PreparedTicketItemCancellation['quote'];
type TicketItemCancellationSnapshot = PaymentCancelTicketItemSnapshot & {
  seatId: string;
  floorKey: string;
  seatKey: string;
};

/** Recreates the retired checkout's quotes and frozen commands to test historical settlements. */
export class HistoricalSeatCancellationFixture extends ReservationService {
  private toPaymentCancelTicketItemSnapshot(
    row: Record<string, unknown>,
  ): TicketItemCancellationSnapshot {
    return {
      id: String(row['id']),
      refundableAmount: Number(row['refundable_amount'] ?? 0),
      seatId: String(row['seat_id']),
      floorKey: String(row['floor_key']),
      seatKey: String(row['seat_key']),
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
      payment: this.buildTicketItemPaymentSnapshot(input.context),
      ticketItem: currentTicketItem,
      activeTicketItems,
      reason: input.reason,
    });
  }

  private buildTicketItemPaymentSnapshot(context: TicketItemCancellationContext) {
    return {
      id: context.paymentId,
      paymentKey: context.paymentKey,
      method: context.paymentMethod,
      provider: context.paymentProvider,
      currency: context.paymentCurrency,
      amount: context.paymentAmount,
      providerMetadata: context.providerMetadata,
      providerChargeCurrency: context.providerChargeCurrency,
      providerChargeAmountMinor: context.providerChargeAmountMinor,
      refundedAmount: context.refundedAmount,
      providerRefundedAmountMinor: context.providerRefundedAmountMinor,
    };
  }

  async getTicketItemCancellationPreview(reservationId: string, ticketItemId: string, userId: string): Promise<TicketItemRefundPreviewResponse> {
    const detail = await this.getReservationDetail(reservationId, userId);
    const selected = detail.ticketItems.find((item) => item.id === ticketItemId && !item.isLegacyFallback);
    if (!selected) throw new NotFoundException('티켓을 찾을 수 없습니다');
    if (selected.status !== 'ACTIVE' || detail.status !== 'CONFIRMED') throw new BadRequestException('취소할 수 없는 티켓 상태입니다');
    const [booking] = await this.db
      .select({ payment: payments, fixedCancellationFee: reservations.fixedCancellationFee })
      .from(reservations)
      .innerJoin(payments, eq(payments.reservationId, reservations.id))
      .where(eq(reservations.id, reservationId));
    if (!booking || booking.payment.status !== 'DONE') throw new BadRequestException('취소할 수 없는 결제 상태입니다');
    const { payment, fixedCancellationFee } = booking;
    const rows = await this.db.select().from(ticketItems).where(eq(ticketItems.reservationId, reservationId));
    const quote = calculateTicketItemCancellationQuote({
      price: selected.price + (selected.addonAmount ?? 0),
      serviceFee: selected.serviceFee,
      bookedAt: payment.paidAt ?? new Date(detail.createdAt),
      showtimeAt: new Date(detail.showDateTime),
      fixedCancellationFee,
    });
    const snapshot = withCompletedRefunds(payment, rows);
    // Nothing refundable means no provider command and no provider balance requirement.
    const command = quote.refundableAmount === 0 ? null : buildTicketItemPaymentCancelRequest({ payment: snapshot,
      ticketItem: { id: ticketItemId, refundableAmount: quote.refundableAmount },
      activeTicketItems: rows.filter((item) => item.status === 'active'), reason: 'Refund preview' });
    const currency = payment.providerChargeCurrency === 'USD' ? 'USD' : 'KRW';
    const scale = currency === 'USD' ? 100 : 1;
    const chargeMinor = payment.providerChargeAmountMinor ?? payment.amount;
    const balanceMinor = chargeMinor - (snapshot.providerRefundedAmountMinor ?? 0);
    const amountMinor = !command ? 0
      : command.options.cancelAmount === undefined ? balanceMinor : Math.round(command.options.cancelAmount * scale);
    const provider = command
      ? await this.tossClient.queryPayment(payment.paymentKey, { secretKeyScope: command.options.secretKeyScope })
      : null;
    const [fullRefund] = await this.db.select({ id: refunds.id, status: refunds.status, providerMetadata: refunds.providerMetadata })
      .from(refunds).where(eq(refunds.reservationId, reservationId)).limit(1);
    const [policy] = await this.db.select({ min: bookingPolicies.cancelledSeatHoldMinMinutes,
      max: bookingPolicies.cancelledSeatHoldMaxMinutes }).from(bookingPolicies).where(eq(bookingPolicies.performanceId, detail.performanceId!));
    let blockedReason: string | null = null;
    if (new Date(detail.cancelDeadline) <= new Date()) blockedReason = '취소 가능한 기한이 지났습니다';
    else if (selected.admissionState === 'ENTERED') blockedReason = '입장 처리된 티켓은 취소할 수 없습니다';
    else if (selected.benefitEntitlements.some((benefit) => benefit.state === 'redeemed')) blockedReason = '특전을 수령한 티켓은 취소할 수 없습니다';
    else if ((fullRefund && !hasRestoredRefundRights(fullRefund)) || rows.some((item) => item.status === 'cancellation_pending')) blockedReason = '다른 취소가 처리 중입니다. 결과 확인 후 다시 시도해주세요.';
    else if (command && provider && command.options.cancelAmount !== undefined && provider.isPartialCancelable !== true) blockedReason = '이 결제수단은 자동 부분취소를 지원하지 않습니다. 고객센터로 문의해주세요.';
    else if (provider && (Math.round((provider.balanceAmount ?? -1) * scale) !== balanceMinor
      || Math.round(provider.totalAmount * scale) !== chargeMinor)) blockedReason = '결제사 환불 잔액을 확인해야 합니다. 고객센터로 문의해주세요.';
    return { reservationId, reservationNumber: detail.reservationNumber, paymentKey: payment.paymentKey,
      refundableAmount: quote.refundableAmount, canRequestRefund: !blockedReason, blockedReason,
      selectedTicketItemId: ticketItemId, remainingTicketItemIds: rows.filter((item) => item.id !== ticketItemId && item.status === 'active').map((item) => item.id),
      providerRefund: { currency, amountMinor, amountDecimal: (amountMinor / scale).toFixed(currency === 'USD' ? 2 : 0) },
      cancelledSeatHoldWindowMinutes: { min: policy?.min ?? 1, max: policy?.max ?? 10 }, refundTimeline: detail.refundTimeline,
      cancellationQuote: { originalPaymentAmount: payment.amount, ticketSubtotal: selected.price,
        ...((selected.addonAmount ?? 0) > 0 ? { addonSubtotal: selected.addonAmount } : {}),
        ticketServiceFeeTotal: selected.serviceFee, cancellationFeeTotal: quote.cancellationFee,
        serviceFeeRefundTotal: quote.serviceFeeRefund, refundableAmount: quote.refundableAmount,
        policyCodes: [quote.policyCode], items: [{ ticketItemId, ticketPrice: selected.price, addonAmount: selected.addonAmount ?? 0, serviceFee: selected.serviceFee,
          cancellationFee: quote.cancellationFee, serviceFeeRefund: quote.serviceFeeRefund,
          refundableAmount: quote.refundableAmount, policyCode: quote.policyCode }] },
    };
  }

  async cancelTicketItem(reservationId: string, ticketItemId: string, userId: string, reason: string, expected?: Partial<CancellationExpectation>) {
    const prepared = await this.db.transaction(async (tx) => {
      const context = await this.lockTicketCancellationContext(tx, reservationId, ticketItemId, userId);
      if (context.ticketItemStatus === 'cancelled') return null;
      this.assertTicketItemCancellable(context);

      const now = new Date();
      const isPendingRetry = context.ticketItemStatus === 'cancellation_pending';
      // Zero refunds have no provider command. A positive-price ticket must have a stored fee covering its price.
      const pendingLocalOnly = isPendingRetry && !context.cancellationCommand
        && context.refundableAmount === 0 && context.cancellationFee === context.price;
      if (isPendingRetry && !context.cancellationCommand && !pendingLocalOnly) {
        throw new ConflictException('이전 취소 요청의 결제사 결과를 확인해야 합니다. 고객센터로 문의해주세요.');
      }
      const quote = isPendingRetry
        ? {
            cancellationFee: context.cancellationFee,
            policyCode: context.cancellationCommand?.policyCode,
            serviceFeeRefund: context.serviceFeeRefund,
            refundableAmount: context.refundableAmount,
          }
        : calculateTicketItemCancellationQuote({
            price: context.price,
            serviceFee: context.serviceFee,
            bookedAt: context.bookingConfirmedAt,
            fixedCancellationFee: context.fixedCancellationFee,
            showtimeAt: context.showtimeAt,
          });
      const cancellationReason = isPendingRetry && context.cancelReason
        ? context.cancelReason
        : reason;
      if (!isPendingRetry && expected?.expectedRefundableAmount !== undefined
        && expected.expectedRefundableAmount !== quote.refundableAmount) {
        throw new ConflictException('환불 금액이 변경되었습니다. 견적을 다시 확인해주세요.');
      }
      const preparedAt = isPendingRetry && context.cancelledAt
        ? context.cancelledAt
        : now;
      const activeTicketItemResult = await tx.execute(sql`
        SELECT
          ti.id,
          ti.status,
          ti.refundable_amount,
          ti.cancellation_fee,
          ti.price,
          ti.addon_amount,
          ti.cancellation_command,
          ti.seat_id,
          ti.floor_key,
          ti.seat_key
        FROM ticket_items ti
        WHERE ti.reservation_id = ${reservationId}
          AND ti.payment_id = ${context.paymentId}
        ORDER BY ti.id
        FOR UPDATE OF ti
      `);
      if (activeTicketItemResult.rows.some((row) => row['id'] !== ticketItemId && row['status'] === 'cancellation_pending')) {
        throw new ConflictException('다른 좌석의 취소가 처리 중입니다. 결과 확인 후 다시 시도해주세요.');
      }
      const [fullRefund] = await tx.select({ id: refunds.id, status: refunds.status, providerMetadata: refunds.providerMetadata }).from(refunds)
        .where(eq(refunds.reservationId, reservationId)).limit(1);
      if (fullRefund && !hasRestoredRefundRights(fullRefund)) throw new ConflictException('전체 예매 취소가 접수되어 있습니다. 환불 상태를 확인해주세요.');
      try {
        const ledger = withCompletedRefunds(
          this.buildTicketItemPaymentSnapshot(context),
          activeTicketItemResult.rows.map((row) => ({
            status: String(row['status']),
            refundableAmount: Number(row['refundable_amount']),
            cancellationFee: Number(row['cancellation_fee']),
            price: Number(row['price']),
            addonAmount: Number(row['addon_amount'] ?? 0),
            cancellationCommand: row['cancellation_command'] as TicketItemCancellationCommand | null,
          })),
        );
        context.refundedAmount = ledger.refundedAmount ?? 0;
        context.providerRefundedAmountMinor = ledger.providerRefundedAmountMinor ?? 0;
      } catch {
        throw new ConflictException('이전 외화 환불 원장을 확인해야 합니다. 고객센터로 문의해주세요.');
      }
      const activeTicketItems = activeTicketItemResult.rows
        .filter((row) => ['active', 'cancellation_pending'].includes(String(row['status']))).map((row) =>
        this.toPaymentCancelTicketItemSnapshot(row as Record<string, unknown>)
      );
      const finalizerContext = this.buildTicketItemFinalizerContext(context);
      // Nothing refundable (for example a 0 KRW tier after the booking day): no provider command can carry
      // a zero amount, so the item is cancelled locally and its seat reopens without a PG call.
      const localOnlyCancellation = !context.cancellationCommand && quote.refundableAmount === 0;
      const paymentCancelRequest: PaymentCancelRequest | null = context.cancellationCommand ? {
        paymentKey: context.paymentKey, reason: context.cancellationCommand.reason,
        options: context.cancellationCommand.options,
      } : localOnlyCancellation ? null : this.buildTicketItemPaymentCancelRequest({
        context,
        quote,
        activeTicketItems,
        reason: cancellationReason,
      });
      if (paymentCancelRequest && !context.cancellationCommand) {
        const commandId = randomUUID();
        paymentCancelRequest.reason = context.paymentMethod === 'VIRTUAL_ACCOUNT'
          ? providerRefundReason(commandId) : `${Array.from(cancellationReason).slice(0, 150).join('')} [${commandId}]`;
        paymentCancelRequest.options.idempotencyKey = `ticket-item-cancel:${ticketItemId}:${commandId}`;
        if (paymentCancelRequest.options.cancelRequestId) paymentCancelRequest.options.cancelRequestId = `cancel_${commandId}`;
        const currency = context.providerChargeCurrency === 'USD' ? 'USD' : 'KRW';
        const chargeMinor = context.providerChargeAmountMinor ?? context.paymentAmount;
        context.cancellationCommand = {
          version: 1, id: commandId, requestedAt: preparedAt.toISOString(), policyCode: quote.policyCode,
          reason: paymentCancelRequest.reason,
          options: { ...paymentCancelRequest.options, idempotencyKey: paymentCancelRequest.options.idempotencyKey,
            secretKeyScope: paymentCancelRequest.options.secretKeyScope ?? 'default' },
          currency,
          originalAmountMinor: chargeMinor,
          amountMinor: paymentCancelRequest.options.cancelAmount === undefined
            ? chargeMinor - context.providerRefundedAmountMinor
            : Math.round(paymentCancelRequest.options.cancelAmount * (currency === 'USD' ? 100 : 1)),
          balanceBeforeMinor: chargeMinor - context.providerRefundedAmountMinor,
        };
      }
      if (!isPendingRetry && expected?.expectedProviderRefundAmountMinor !== undefined
        && expected.expectedProviderRefundAmountMinor !== (context.cancellationCommand?.amountMinor ?? 0)) {
        throw new ConflictException('환불 금액이 변경되었습니다. 견적을 다시 확인해주세요.');
      }
      await tx
        .update(ticketItems)
        .set({
          status: 'cancellation_pending',
          cancelledAt: preparedAt,
          cancelReason: cancellationReason,
          cancellationFee: quote.cancellationFee,
          serviceFeeRefund: quote.serviceFeeRefund,
          refundableAmount: quote.refundableAmount,
          cancellationCommand: context.cancellationCommand,
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

      await this.holdTicketCancellationRights(tx, ticketItemId, now);

      return {
        context,
        quote,
        reason: cancellationReason,
        isPendingRetry,
        paymentCancelRequest,
        isFullPaymentCancellation:
          paymentCancelRequest !== null && paymentCancelRequest.options.cancelAmount === undefined,
        finalizerContext,
        now: preparedAt,
      };
    });
    return this.settleTicketItemCancellation(reservationId, ticketItemId, userId, prepared);
  }
}
