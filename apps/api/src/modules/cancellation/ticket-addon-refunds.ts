import { randomUUID } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import type { CancellationQuote, TicketItemCancellationPolicyCode } from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { payments, refunds, reservations, ticketItems } from '../../database/schema/index.js';
import { buildFullReservationPaymentCancelRequest, describeLocalOnlyCancellation, describePaymentCancellation } from '../payment/payment-cancel-policy.js';
import { ticketCancellationFeeForSubtotal } from './ticket-cancellation-policy.js';

type Tx = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];

/** Freeze one refund per original provider charge in the same transaction that cancels the ticket. */
export async function prepareTicketAddonRefunds(tx: Tx, ticketIds: string[], fixedFee: boolean,
  policyForTicket: (ticketId: string) => TicketItemCancellationPolicyCode, reason: string) {
  if (!ticketIds.length) return [];
  const orders = await tx.select({ ticketId: ticketItems.id, base: ticketItems.price, bundled: ticketItems.addonAmount,
    orderId: reservations.id, number: reservations.reservationNumber, status: reservations.status, payment: payments })
    .from(reservations).innerJoin(ticketItems, eq(ticketItems.id, reservations.addonTicketItemId))
    .innerJoin(payments, eq(payments.reservationId, reservations.id))
    .where(inArray(reservations.addonTicketItemId, ticketIds))
    .orderBy(asc(reservations.createdAt), asc(reservations.id));
  const subtotals = new Map<string, number>();
  const refundIds: string[] = [];
  for (const order of orders) {
    if (order.status !== 'CONFIRMED') continue;
    const policy = policyForTicket(order.ticketId);
    const before = subtotals.get(order.ticketId) ?? order.base + order.bundled;
    const after = before + order.payment.amount;
    const fee = ticketCancellationFeeForSubtotal(policy, after, fixedFee) - ticketCancellationFeeForSubtotal(policy, before, fixedFee);
    subtotals.set(order.ticketId, after);
    const quote: CancellationQuote = { originalPaymentAmount: order.payment.amount, ticketSubtotal: 0,
      addonSubtotal: order.payment.amount, ticketServiceFeeTotal: 0, cancellationFeeTotal: fee, serviceFeeRefundTotal: 0,
      refundableAmount: order.payment.amount - fee, policyCodes: [policy], items: [] };
    const id = randomUUID();
    const cancelReason = `${Array.from(reason).slice(0, 125).join('')} [${id}]`;
    const metadata = { cancelReason, requestedBy: 'system', ticketItemId: order.ticketId,
      reservationNumber: order.number, cancellationQuote: quote };
    let values: typeof refunds.$inferInsert;
    const base = { id, reservationId: order.orderId, paymentId: order.payment.id, provider: 'toss_payments' };
    try {
      const command = quote.refundableAmount ? buildFullReservationPaymentCancelRequest({
        payment: order.payment, cancellationQuote: quote, reason: cancelReason,
        idempotencyKey: `refund-cancel:${id}`, cancelRequestIdSeed: id,
      }) : null;
      values = { ...base, status: 'requested', resultCode: 'REQUESTED',
        providerMetadata: { ...metadata, ...(command ? { cancelRequest: command,
          providerRefund: describePaymentCancellation(order.payment, command) } : {
          localOnlyCancellation: true, providerRefund: describeLocalOnlyCancellation(order.payment) }) } };
    } catch {
      // A legacy foreign charge lacking an attributable currency amount needs finance review.
      // The ticket's own provider cancellation has already succeeded.
      values = { ...base, status: 'failed', resultCode: 'CANCEL_COMMAND_UNAVAILABLE', failedAt: new Date(),
        customerServiceCtaVisible: true, providerMetadata: { ...metadata, manualReviewRequired: true } };
    }
    const [row] = await tx.insert(refunds).values(values).onConflictDoNothing({ target: refunds.reservationId })
      .returning({ id: refunds.id, status: refunds.status });
    if (row?.status === 'requested') refundIds.push(row.id);
  }
  return refundIds;
}
