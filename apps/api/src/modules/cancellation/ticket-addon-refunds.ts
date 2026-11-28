import { providerRefundReason } from '../payment/toss-cancel-receipt.js';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql, type SQLWrapper } from 'drizzle-orm';
import type { AddonRefundReceipt, BuyerRefundSummary, CancellationQuote, TicketItemCancellationPolicyCode } from '@grabit/shared';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { payments, refunds, reservations, ticketItems } from '../../database/schema/index.js';
import { buildFullReservationPaymentCancelRequest, describeLocalOnlyCancellation, describePaymentCancellation } from '../payment/payment-cancel-policy.js';
import { ticketCancellationFeeForSubtotal } from './ticket-cancellation-policy.js';

type Tx = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];

// Product names and quantities come from the original order, even after a product is renamed.
export function addonRefundProducts(orderId: SQLWrapper) {
  return sql<AddonRefundReceipt['products']>`(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'displayCopy', units.display_copy, 'quantity', units.qty) ORDER BY units.addon_id, units.display_copy), '[]'::jsonb)
    FROM (SELECT h.addon_id, h.display_copy, count(*) AS qty FROM booking_addon_holds h
      WHERE h.reservation_id = ${orderId} GROUP BY h.addon_id, h.display_copy) units)`;
}

async function quoteTicketAddonOrders(tx: Pick<Tx, 'select'>, ticketIds: string[], fixedFee: boolean,
  policyForTicket: (ticketId: string) => TicketItemCancellationPolicyCode) {
  if (!ticketIds.length) return [];
  const orders = await tx.select({ ticketId: ticketItems.id, base: ticketItems.price, bundled: ticketItems.addonAmount,
    orderId: reservations.id, number: reservations.reservationNumber, products: addonRefundProducts(reservations.id), payment: payments })
    .from(reservations).innerJoin(ticketItems, eq(ticketItems.id, reservations.addonTicketItemId))
    .innerJoin(payments, eq(payments.reservationId, reservations.id))
    .where(and(inArray(reservations.addonTicketItemId, ticketIds), eq(reservations.status, 'CONFIRMED')))
    .orderBy(asc(reservations.createdAt), asc(reservations.id));
  const subtotals = new Map<string, number>();
  return orders.map(order => {
    const policy = policyForTicket(order.ticketId);
    const before = subtotals.get(order.ticketId) ?? order.base + order.bundled;
    const after = before + order.payment.amount;
    const fee = ticketCancellationFeeForSubtotal(policy, after, fixedFee) - ticketCancellationFeeForSubtotal(policy, before, fixedFee);
    subtotals.set(order.ticketId, after);
    const quote: CancellationQuote = { originalPaymentAmount: order.payment.amount, ticketSubtotal: 0,
      addonSubtotal: order.payment.amount, ticketServiceFeeTotal: 0, cancellationFeeTotal: fee, serviceFeeRefundTotal: 0,
      refundableAmount: order.payment.amount - fee, policyCodes: [policy], items: [] };
    return { order, quote };
  });
}

export async function quoteBuyerRefund(db: Pick<Tx, 'select'>, parent: CancellationQuote, fixedFee: boolean): Promise<BuyerRefundSummary> {
  const policies = new Map(parent.items.map(item => [item.ticketItemId, item.policyCode]));
  const orders = await quoteTicketAddonOrders(db, [...policies.keys()], fixedFee, id => policies.get(id)!);
  const charges = orders.map(({ order, quote }) => {
    let providerRefund = null;
    try {
      providerRefund = quote.refundableAmount ? describePaymentCancellation(order.payment,
        buildFullReservationPaymentCancelRequest({ payment: order.payment, cancellationQuote: quote,
          reason: 'Refund preview', cancelRequestIdSeed: order.payment.id })) : describeLocalOnlyCancellation(order.payment);
    } catch {
      // Missing legacy currency evidence requires manual review before the buyer confirms.
    }
    return { reservationNumber: order.number, products: order.products, paidAmount: quote.originalPaymentAmount,
      refundableAmount: quote.refundableAmount, providerRefund };
  });
  const refundableAmount = charges.reduce((sum, charge) => sum + charge.refundableAmount, parent.refundableAmount);
  const cancellationFeeTotal = orders.reduce((sum, item) => sum + item.quote.cancellationFeeTotal, parent.cancellationFeeTotal);
  const version = createHash('sha256').update(JSON.stringify([parent.ticketSubtotal, parent.addonSubtotal ?? 0,
    parent.serviceFeeRefundTotal, cancellationFeeTotal, refundableAmount, charges])).digest('hex');
  return { version, refundableAmount, cancellationFeeTotal, charges };
}

/** Freeze one refund per original provider charge in the same transaction that cancels the ticket. */
export async function prepareTicketAddonRefunds(tx: Tx, ticketIds: string[], fixedFee: boolean,
  policyForTicket: (ticketId: string) => TicketItemCancellationPolicyCode, reason: string) {
  const orders = await quoteTicketAddonOrders(tx, ticketIds, fixedFee, policyForTicket);
  const refundIds: string[] = [];
  for (const { order, quote } of orders) {
    const id = randomUUID();
    const cancelReason = `${Array.from(reason).slice(0, 125).join('')} [${id}]`;
    const metadata = { cancelReason, requestedBy: 'system', ticketItemId: order.ticketId,
      reservationNumber: order.number, cancellationQuote: quote };
    let values: typeof refunds.$inferInsert;
    const base = { id, reservationId: order.orderId, paymentId: order.payment.id, provider: 'toss_payments' };
    try {
      const command = quote.refundableAmount ? buildFullReservationPaymentCancelRequest({
        payment: order.payment, cancellationQuote: quote, reason: providerRefundReason(id),
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
