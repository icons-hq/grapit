import { NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { AdminBookingSupportEvidence } from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { payments, refunds, reservations, reservationPaymentFailureDiagnostics, tickets, ticketItems, ticketBenefitEntitlements } from '../../database/schema/index.js';
import { hasRestoredRefundRights, reservationProviderRefund, ticketItemRefundTimeline, toRefundTimeline } from '../cancellation/refund-timeline.js';

/** Read-only support view: no credential issuance, mail dispatch or PG request. */
export async function readBookingSupportEvidence(db: DrizzleDB, id: string): Promise<AdminBookingSupportEvidence> {
  const [order] = await db.select({ amount: reservations.totalAmount, status: reservations.status }).from(reservations).where(eq(reservations.id, id));
  if (!order) throw new NotFoundException('예매를 찾을 수 없습니다.');
  const [paymentRows, refundRows, items, credentials, diagnosticRows, benefits] = await Promise.all([
    db.select().from(payments).where(eq(payments.reservationId, id)),
    db.select().from(refunds).where(eq(refunds.reservationId, id)),
    db.select().from(ticketItems).where(eq(ticketItems.reservationId, id)),
    db.select({ id: tickets.id, ticketItemId: tickets.ticketItemId, status: tickets.status,
      emailScheduledAt: tickets.emailScheduledAt, emailSentAt: tickets.emailSentAt })
      .from(tickets).where(eq(tickets.reservationId, id)).orderBy(asc(tickets.issuedAt)),
    db.select({ checkedAt: reservationPaymentFailureDiagnostics.providerCheckedAt, checkStatus: reservationPaymentFailureDiagnostics.providerCheckStatus })
      .from(reservationPaymentFailureDiagnostics).where(eq(reservationPaymentFailureDiagnostics.reservationId, id)),
    db.select({ id: ticketBenefitEntitlements.id, seat: ticketItems.seatKey,
      copy: ticketBenefitEntitlements.displayCopySnapshot, state: ticketBenefitEntitlements.state, redeemedAt: ticketBenefitEntitlements.redeemedAt })
      .from(ticketBenefitEntitlements).innerJoin(ticketItems, eq(ticketItems.id, ticketBenefitEntitlements.ticketItemId))
      .where(eq(ticketItems.reservationId, id)),
  ]);
  const payment = paymentRows[0];
  const refund = refundRows[0] ?? null;
  const currency = payment?.providerChargeCurrency ?? payment?.currency ?? 'KRW';
  const diagnostic = diagnosticRows[0];
  const history = credentials.map((credential) => ({ id: credential.id,
    seat: items.find((item) => item.id === credential.ticketItemId)?.seatKey ?? '기존 예매 티켓',
    credentialStatus: credential.status, scheduledAt: credential.emailScheduledAt?.toISOString() ?? null,
    sentAt: credential.emailSentAt?.toISOString() ?? null }));
  return { generatedAt: new Date().toISOString(), originalOrderAmount: order.amount,
    provider: payment ? { currency, originalAmountMinor: currency === 'KRW' ? payment.amount
      : currency === payment.providerChargeCurrency ? payment.providerChargeAmountMinor : null,
    storedStatus: payment.status, approvedAt: payment.paidAt?.toISOString() ?? null,
    checkedAt: diagnostic?.checkedAt?.toISOString() ?? null, checkStatus: diagnostic?.checkStatus ?? null } : null,
    refundTimeline: refund && !hasRestoredRefundRights(refund) ? toRefundTimeline(refund) : ticketItemRefundTimeline(items),
    refundProviderAmount: reservationProviderRefund(items, refund, payment),
    rights: { seatStatesKnown: items.length > 0 || order.status !== 'CONFIRMED',
      activeSeats: items.filter((item) => item.status === 'active').length,
      cancelledSeats: items.filter((item) => item.status === 'cancelled').length,
      pendingSeats: items.filter((item) => item.status === 'cancellation_pending').length,
      enteredSeats: items.filter((item) => item.admissionState === 'entered').length,
      benefits: benefits.map((benefit) => ({ id: benefit.id, seat: benefit.seat, name: benefit.copy.ko.name,
        state: benefit.state, redeemedAt: benefit.redeemedAt?.toISOString() ?? null })) },
    delivery: { scheduledAt: history.map((item) => item.scheduledAt).filter((time): time is string => Boolean(time)).sort().at(-1) ?? null,
      lastSentAt: history.map((item) => item.sentAt).filter((time): time is string => Boolean(time)).sort().at(-1) ?? null,
      inboxReceipt: 'unverified', history },
  };
}
