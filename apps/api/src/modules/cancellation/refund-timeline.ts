import type { RefundTimeline, RefundPreviewResponse, ReservationDetail } from '@grabit/shared';
import type { refunds, ticketItems } from '../../database/schema/index.js';
type RefundRecord = typeof refunds.$inferSelect;
type RefundStateMachineStatus = RefundRecord['status'];
const MS_PER_DAY = 86400000;

export function hasRestoredRefundRights(refund: Pick<RefundRecord, 'status' | 'providerMetadata'> | null | undefined): boolean {
  if (refund?.status !== 'failed' || !refund.providerMetadata || typeof refund.providerMetadata !== 'object') return false;
  return typeof (refund.providerMetadata as Record<string, unknown>).rightsRestoredAt === 'string';
}

const REFUND_TIMELINE_STATE_MAP: Record<
  RefundStateMachineStatus,
  RefundTimeline['currentState']
> = {
  requested: 'REQUESTED',
  sent_to_pg: 'SENT_TO_PG',
  processing_at_pg: 'PROCESSING_AT_PG',
  completed: 'COMPLETED',
  failed: 'FAILED',
};

export function toRefundTimeline(refund: RefundRecord, now: Date = new Date()): RefundTimeline {
  // Historical expected_deposit_at values were created locally as +3 days.
  // Keep the processing follow-up threshold separate from issuer settlement.
  const isDelayed = refund.status !== 'completed'
    && refund.requestedAt.getTime() + 3 * MS_PER_DAY < now.getTime();

  return {
    currentState: REFUND_TIMELINE_STATE_MAP[refund.status],
    requestedAt: refund.requestedAt.toISOString(),
    sentToPgAt: refund.sentToPgAt?.toISOString() ?? null,
    processedAtPgAt: refund.processingAtPgAt?.toISOString() ?? null,
    completedAt: refund.completedAt?.toISOString() ?? null,
    failedAt: refund.failedAt?.toISOString() ?? null,
    expectedDepositAt: null,
    customerServiceCtaVisible: refund.customerServiceCtaVisible || isDelayed,
  };
}

export function ticketItemRefundTimeline(items: Array<typeof ticketItems.$inferSelect>): RefundTimeline | null {
  const cancelled = items.filter((item) => item.status === 'cancelled' || item.status === 'cancellation_pending');
  if (!cancelled.length) return null;
  const pending = cancelled.find((item) => item.status === 'cancellation_pending');
  const times = cancelled.map((item) => item.cancellationCommand?.requestedAt ?? item.cancelledAt?.toISOString()).filter((time): time is string => Boolean(time)).sort();
  if (!times.length) return null;
  return {
    currentState: pending ? (pending.cancellationCommand?.processingAtPgAt ? 'PROCESSING_AT_PG'
      : pending.cancellationCommand?.sentToPgAt ? 'SENT_TO_PG' : 'REQUESTED') : 'COMPLETED',
    sentToPgAt: pending?.cancellationCommand?.sentToPgAt,
    processedAtPgAt: pending?.cancellationCommand?.processingAtPgAt,
    requestedAt: times[0]!, completedAt: pending ? null : cancelled.map((item) => item.cancellationCommand?.completedAt ?? item.cancelledAt?.toISOString()).filter(Boolean).sort().at(-1)!,
    expectedDepositAt: null,
    customerServiceCtaVisible: Boolean(pending && pending.cancelledAt && pending.cancelledAt.getTime() + 3 * MS_PER_DAY < Date.now()),
  };
}

export function reservationProviderRefund(items: Array<typeof ticketItems.$inferSelect>, refund: RefundRecord | null,
  payment: { amount: number; providerChargeAmountMinor?: number | null; providerChargeCurrency?: string | null } | undefined,
): RefundPreviewResponse['providerRefund'] {
  const amounts: Array<{ currency: string; amountMinor: number }> = items
    .filter((item) => item.status === 'cancelled' && item.cancellationCommand)
    .map((item) => item.cancellationCommand!);
  if (refund?.status === 'completed' && refund.providerMetadata && typeof refund.providerMetadata === 'object') {
    const amount = (refund.providerMetadata as Record<string, unknown>).providerRefund;
    if (amount && typeof amount === 'object') {
      const value = amount as { currency?: unknown; amountMinor?: unknown };
      if (typeof value.currency === 'string' && typeof value.amountMinor === 'number') {
        amounts.push({ currency: value.currency, amountMinor: value.amountMinor });
      }
    }
  }
  if (!amounts.length || !payment) return null;
  const currency = amounts[0]!.currency;
  if (!['KRW', 'USD'].includes(currency) || amounts.some((amount) => amount.currency !== currency
    || !Number.isSafeInteger(amount.amountMinor) || amount.amountMinor < 0)) return null;
  const amountMinor = amounts.reduce((sum, amount) => sum + amount.amountMinor, 0);
  const cap = currency === 'USD' ? payment.providerChargeAmountMinor : payment.amount;
  if (!Number.isSafeInteger(amountMinor) || cap === null || cap === undefined || amountMinor > cap) return null;
  return { currency: currency as 'KRW' | 'USD', amountMinor,
    amountDecimal: (amountMinor / (currency === 'USD' ? 100 : 1)).toFixed(currency === 'USD' ? 2 : 0) };
}

export function reservationCancellationRecovery(items: Array<typeof ticketItems.$inferSelect>, refund: RefundRecord | null): ReservationDetail['cancellationRecovery'] {
  if (refund && ['requested', 'sent_to_pg', 'processing_at_pg'].includes(refund.status)) return { kind: 'reservation' };
  const item = items.find((item) => item.status === 'cancellation_pending' && item.cancellationCommand);
  return item ? { kind: 'ticket', ticketItemId: item.id } : null;
}
