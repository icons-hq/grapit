import { Buffer } from 'node:buffer';
import { and, eq, sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { refunds } from '../../database/schema/index.js';
import type { PaymentCancelRequest } from './payment-cancel-policy.js';
import type { TossPaymentResponse } from './toss-payments.client.js';

/** Keep the complete attempt UUID in a short provider-facing reason for GET recovery after a lost POST.
 * The original buyer/operator reason is recorded separately in the local refund or ticket. */
export function providerRefundReason(attemptId: string) {
  return 'Refund ' + Buffer.from(attemptId.replaceAll('-', ''), 'hex').toString('base64url');
}

/** Only the response to our own idempotent cancel POST binds its last transaction to our command.
 * A later GET can have a different last transaction and must use a saved key or the frozen reference. */
export function transactionFromCancelPost(
  response: TossPaymentResponse, command: PaymentCancelRequest, snapshot: unknown, before?: TossPaymentResponse,
): string | undefined {
  if (!command.options.idempotencyKey || !snapshot || typeof snapshot !== 'object' || !before) return;
  const { currency, originalAmountMinor, balanceBeforeMinor, amountMinor } = snapshot as Record<string, unknown>;
  if (currency !== 'KRW' && currency !== 'USD') return;
  const scale = currency === 'USD' ? 100 : 1;
  if (before.paymentKey !== command.paymentKey || response.paymentKey !== command.paymentKey || before.orderId !== response.orderId
    || (response.status !== 'CANCELED' && response.status !== 'PARTIAL_CANCELED')
    || before.currency !== currency || response.currency !== currency
    || typeof originalAmountMinor !== 'number' || !Number.isSafeInteger(originalAmountMinor)
    || response.totalAmount !== originalAmountMinor / scale || before.totalAmount !== response.totalAmount
    || typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0
    || typeof balanceBeforeMinor !== 'number' || !Number.isSafeInteger(balanceBeforeMinor)
    || balanceBeforeMinor < amountMinor || balanceBeforeMinor > originalAmountMinor
    || before.balanceAmount !== balanceBeforeMinor / scale
    || response.balanceAmount !== (balanceBeforeMinor - amountMinor) / scale) return;
  let key = response.lastTransactionKey;
  if (!key) {
    const previous = before.cancels ?? [];
    if (previous.some(row => !row.transactionKey)) return;
    const seen = new Set(previous.map(row => row.transactionKey));
    const added = response.cancels?.filter(row => !seen.has(row.transactionKey));
    if (added?.length === 1) key = added[0]!.transactionKey;
  }
  if (typeof key !== 'string' || !key || before.cancels?.some(row => row.transactionKey === key && row.cancelStatus === 'DONE')) return;
  const rows = response.cancels?.filter(cancel => cancel.transactionKey === key);
  const cancel = rows?.length === 1 ? rows[0] : undefined;
  if (cancel?.cancelStatus === 'DONE' && cancel.cancelAmount === amountMinor / scale
    && (!command.options.cancelRequestId || cancel.cancelRequestId === command.options.cancelRequestId)) return key;
}

export async function bindRefundCancelPost(db: DrizzleDB, refundId: string, response: TossPaymentResponse,
  command: PaymentCancelRequest, snapshot: unknown, before?: TossPaymentResponse) {
  const key = transactionFromCancelPost(response, command, snapshot, before);
  if (!key) return undefined;
  const written = await db.update(refunds).set({
    providerMetadata: sql`${refunds.providerMetadata} || jsonb_build_object('providerTransactionKey', ${key}::text)`,
  }).where(and(eq(refunds.id, refundId),
    sql`${refunds.providerMetadata}->'cancelRequest'->'options'->>'idempotencyKey' = ${command.options.idempotencyKey}`,
    sql`(${refunds.providerMetadata}->>'providerTransactionKey' IS NULL OR ${refunds.providerMetadata}->>'providerTransactionKey' = ${key})`,
  )).returning({ id: refunds.id });
  if (!written.length) throw new Error('환불 거래 키가 현재 취소 요청과 일치하지 않습니다.');
  return key;
}
