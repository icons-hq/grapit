import { createHash } from 'node:crypto';
import type { payments } from '../../database/schema/index.js';
import {
  buildFullPaymentCancelRequest,
  resolvePaymentCancelSecretScope,
  type PaymentCancelPaymentSnapshot,
  type PaymentCancelRequest,
} from './payment-cancel-policy.js';

/**
 * Async DONE payments that must not be issued are cancelled in full. The
 * record lives in payments.provider_metadata so cancel webhooks and the
 * recovery sweep can resume the same cancellation without a schema change.
 */
export type AsyncDoneCompensationKind =
  | 'seat_conflict'
  | 'ticket_limit'
  | 'amount_mismatch'
  | 'unsupported_provider'
  | 'payment_method_not_allowed'
  | 'duplicate_payment_key';
export type AsyncDoneCompensationState =
  | 'pending'
  | 'error'
  | 'aborted'
  | 'cancelled'
  | 'attention';

export interface AsyncDoneCompensationRecord {
  version: 1;
  kind: AsyncDoneCompensationKind;
  paymentKey: string;
  reason: string;
  payment: {
    method: string;
    provider: string;
    currency: string;
    amount: number;
    providerChargeCurrency?: string | null;
    providerChargeAmountMinor?: number | null;
    secretKeyScope: NonNullable<PaymentCancelRequest['options']['secretKeyScope']>;
  };
  /** The latest request sent to the PG. */
  cancelRequest: PaymentCancelRequest;
  /** Every cancelRequestId sent for this charge, oldest first. */
  cancelRequestIds: string[];
  attempts: number;
  state: AsyncDoneCompensationState;
  requestedAt: string;
  lastAttemptAt: string;
  lastCheckedAt?: string;
  lastError?: string;
  /** Consecutive failed provider queries; cleared by the next successful query. */
  queryFailures?: number;
  queryFailingSince?: string;
}

export type CompensationCancelOutcome =
  | { state: 'cancelled' | 'pending' | 'aborted' }
  | { state: 'error'; error: string };

export type CompensationPaymentRow = Pick<
  typeof payments.$inferSelect,
  | 'id'
  | 'reservationId'
  | 'paymentKey'
  | 'tossOrderId'
  | 'method'
  | 'provider'
  | 'currency'
  | 'amount'
  | 'status'
  | 'asyncStatus'
  | 'paidAt'
  | 'cancelReason'
  | 'providerMetadata'
  | 'providerChargeCurrency'
  | 'providerChargeAmountMinor'
>;

export const ASYNC_DONE_COMPENSATION_METADATA_KEY = 'asyncDoneCompensation';
export const DUPLICATE_PAYMENT_COMPENSATIONS_METADATA_KEY = 'duplicatePaymentCompensations';
/** True while any compensation on the row still needs the recovery sweep. */
export const ASYNC_DONE_COMPENSATION_OPEN_METADATA_KEY = 'asyncDoneCompensationOpen';
/**
 * Set on the DONE/cancel_pending row that payment confirm (or its reconcile
 * job) claims for an approval it could not issue. The `payment-confirm-reconcile`
 * job owns that cancel, so the async DONE recovery sweep never adopts the row
 * as a pre-record legacy compensation (two owners would re-query, re-cancel
 * and raise attention for the same order).
 */
export const CONFIRM_COMPENSATION_CLAIM_METADATA_KEY = 'confirmCompensationClaim';

/**
 * The single ownership rule for an unfinished compensation row: payment
 * confirm's `payment-confirm-reconcile` job owns a row it claimed
 * (`confirmCompensationClaim: true`) that carries no async DONE compensation
 * record; the async DONE recovery owns every other row (its own records, and
 * legacy rows from before either marker existed). Each side resumes, re-cancels
 * and records diagnostics only for rows it owns, so one row never gets two
 * owners' attention or diagnostics.
 */
export function isConfirmCompensationClaimOwned(providerMetadata: unknown): boolean {
  return isRecord(providerMetadata)
    && providerMetadata[CONFIRM_COMPENSATION_CLAIM_METADATA_KEY] === true
    && readAsyncDoneCompensation(providerMetadata) === null;
}

export const ASYNC_DONE_SEAT_FAILURE_CANCEL_REASON = '판매 불가능 좌석으로 인한 자동 취소';
export const ASYNC_DONE_COMPENSATION_REASONS: Record<AsyncDoneCompensationKind, string> = {
  seat_conflict: ASYNC_DONE_SEAT_FAILURE_CANCEL_REASON,
  ticket_limit: '예매 매수 제한 초과로 인한 자동 취소',
  amount_mismatch: '결제 금액 불일치로 인한 자동 취소',
  unsupported_provider: '지원하지 않는 결제수단으로 인한 자동 취소',
  payment_method_not_allowed: '허용되지 않은 결제수단으로 인한 자동 취소',
  duplicate_payment_key: '중복 결제로 인한 자동 취소',
};
export const ASYNC_DONE_COMPENSATION_DIAGNOSTIC_CODES: Record<AsyncDoneCompensationKind, string> = {
  seat_conflict: 'ASYNC_DONE_SEAT_UNAVAILABLE_CANCELLED',
  ticket_limit: 'ASYNC_DONE_TICKET_LIMIT_CANCELLED',
  amount_mismatch: 'ASYNC_DONE_AMOUNT_MISMATCH_CANCELLED',
  unsupported_provider: 'ASYNC_DONE_UNSUPPORTED_PROVIDER_CANCELLED',
  payment_method_not_allowed: 'ASYNC_DONE_PAYMENT_METHOD_NOT_ALLOWED_CANCELLED',
  duplicate_payment_key: 'ASYNC_DONE_DUPLICATE_PAYMENT_CANCELLED',
};

/** Local rejections of a provider DONE whose PG charge may still need a refund. */
export const REJECTED_DONE_ASYNC_STATUSES: ReadonlySet<string> = new Set([
  'payment_amount_mismatch',
  'payment_provider_unsupported',
]);

/**
 * The order already holds an accepted, cancelled or compensated payment, so a
 * provider-verified DONE for another paymentKey of the same order can never be
 * issued and must be refunded as a duplicate. The webhook controller and the
 * DONE processing path share this predicate so neither filters the other's case.
 */
export function isSettledOrCompensatedPaymentState(input: {
  reservationStatus: string;
  paymentStatus?: string | null;
  paymentAsyncStatus?: string | null;
}): boolean {
  const asyncStatus = input.paymentAsyncStatus ?? '';
  return input.reservationStatus === 'CONFIRMED'
    || input.reservationStatus === 'CANCELLED'
    || input.paymentStatus === 'DONE'
    || input.paymentStatus === 'PARTIAL_CANCELED'
    || input.paymentStatus === 'CANCELED'
    || asyncStatus === 'cancel_pending'
    || asyncStatus === 'compensation_cancelled'
    || REJECTED_DONE_ASYNC_STATUSES.has(asyncStatus);
}

/** Cancel requests per charge (first request included) before operator attention. */
export const ASYNC_DONE_COMPENSATION_MAX_ATTEMPTS = 5;
/**
 * A provider that keeps answering a compensation cancel with IN_PROGRESS is
 * surfaced for operators once this long has passed since the first request.
 */
export const ASYNC_DONE_COMPENSATION_IN_PROGRESS_ATTENTION_MS = 24 * 60 * 60 * 1000;
/**
 * A compensation whose provider query keeps failing (secret scope or key
 * misconfiguration, provider outage) is surfaced for operators once it has
 * failed this many consecutive times over at least this long.
 */
export const ASYNC_DONE_COMPENSATION_QUERY_FAILURE_ATTENTION_COUNT = 3;
export const ASYNC_DONE_COMPENSATION_QUERY_FAILURE_ATTENTION_MS = 60 * 60 * 1000;
/** Provider IN_PROGRESS cancellations normally finish through CANCEL_STATUS_CHANGED. */
const ASYNC_DONE_COMPENSATION_PENDING_RECHECK_MS = 10 * 60 * 1000;
const ASYNC_DONE_COMPENSATION_RETRY_BACKOFF_MS = 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function buildCompensationRecord(input: {
  kind: AsyncDoneCompensationKind;
  paymentKey: string;
  reason: string;
  payment: PaymentCancelPaymentSnapshot;
  cancelCommand: PaymentCancelRequest;
  outcome: CompensationCancelOutcome;
  now: Date;
  previous?: AsyncDoneCompensationRecord;
}): AsyncDoneCompensationRecord {
  const { previous, cancelCommand, outcome, now } = input;
  const cancelRequestId = cancelCommand.options.cancelRequestId;
  const previousIds = previous?.cancelRequestIds ?? [];
  const cancelRequestIds = cancelRequestId && !previousIds.includes(cancelRequestId)
    ? [...previousIds, cancelRequestId]
    : previousIds;
  return {
    version: 1,
    kind: input.kind,
    paymentKey: input.paymentKey,
    reason: input.reason,
    payment: previous?.payment ?? {
      method: input.payment.method,
      provider: input.payment.provider,
      currency: input.payment.currency,
      amount: input.payment.amount,
      providerChargeCurrency: input.payment.providerChargeCurrency ?? null,
      providerChargeAmountMinor: input.payment.providerChargeAmountMinor ?? null,
      secretKeyScope: cancelCommand.options.secretKeyScope ?? resolvePaymentCancelSecretScope(input.payment),
    },
    cancelRequest: cancelCommand,
    cancelRequestIds,
    attempts: (previous?.attempts ?? 0) + 1,
    state: outcome.state,
    requestedAt: previous?.requestedAt ?? now.toISOString(),
    lastAttemptAt: now.toISOString(),
    lastCheckedAt: now.toISOString(),
    ...(outcome.state === 'error' ? { lastError: outcome.error } : {}),
  };
}

/** The compensation kind of a row without a record, from its stored cancel reason. */
export function inferCompensationKindFromReason(reason: string | null | undefined): AsyncDoneCompensationKind {
  return (Object.entries(ASYNC_DONE_COMPENSATION_REASONS) as Array<[AsyncDoneCompensationKind, string]>)
    .find(([, candidate]) => candidate === reason)?.[0] ?? 'seat_conflict';
}

/** Historic cancel_pending rows predate the record; rebuild what the original request sent. */
export function synthesizeLegacyCompensationRecord(
  payment: CompensationPaymentRow,
  reservationId: string,
): AsyncDoneCompensationRecord {
  const snapshot: PaymentCancelPaymentSnapshot = {
    id: payment.id,
    paymentKey: payment.paymentKey,
    method: payment.method,
    provider: payment.provider,
    currency: payment.currency,
    amount: payment.amount,
    providerMetadata: payment.providerMetadata,
    providerChargeCurrency: payment.providerChargeCurrency,
    providerChargeAmountMinor: payment.providerChargeAmountMinor,
  };
  const reason = payment.cancelReason ?? ASYNC_DONE_SEAT_FAILURE_CANCEL_REASON;
  const cancelRequest = buildFullPaymentCancelRequest({
    payment: snapshot,
    reason,
    idempotencyKey: `async-done-compensation-recovery:${payment.id}`,
    cancelRequestIdSeed: reservationId,
  });
  const kind = inferCompensationKindFromReason(reason);
  const epoch = new Date(0).toISOString();
  return {
    version: 1,
    kind,
    paymentKey: payment.paymentKey,
    reason,
    payment: {
      method: payment.method,
      provider: payment.provider,
      currency: payment.currency,
      amount: payment.amount,
      providerChargeCurrency: payment.providerChargeCurrency,
      providerChargeAmountMinor: payment.providerChargeAmountMinor,
      secretKeyScope: resolvePaymentCancelSecretScope(snapshot),
    },
    cancelRequest,
    cancelRequestIds: cancelRequest.options.cancelRequestId ? [cancelRequest.options.cancelRequestId] : [],
    attempts: 1,
    state: 'pending',
    requestedAt: payment.paidAt?.toISOString() ?? epoch,
    lastAttemptAt: epoch,
  };
}

export function toCompensationCancelSnapshot(record: AsyncDoneCompensationRecord): PaymentCancelPaymentSnapshot {
  return {
    paymentKey: record.paymentKey,
    method: record.payment.method,
    provider: record.payment.provider,
    currency: record.payment.currency,
    amount: record.payment.amount,
    providerChargeCurrency: record.payment.providerChargeCurrency,
    providerChargeAmountMinor: record.payment.providerChargeAmountMinor,
    providerMetadata: { secretKeyScope: record.payment.secretKeyScope },
  };
}

export function isOpenCompensationState(state: AsyncDoneCompensationState): boolean {
  return state === 'pending' || state === 'error' || state === 'aborted';
}

export function isCompensationDue(record: AsyncDoneCompensationRecord, now: Date): boolean {
  if (!isOpenCompensationState(record.state)) {
    return false;
  }
  const lastTouchedAt = Math.max(
    Date.parse(record.lastAttemptAt) || 0,
    Date.parse(record.lastCheckedAt ?? '') || 0,
  );
  const waitMs = record.state === 'pending'
    ? ASYNC_DONE_COMPENSATION_PENDING_RECHECK_MS
    : ASYNC_DONE_COMPENSATION_RETRY_BACKOFF_MS;
  return lastTouchedAt + waitMs <= now.getTime();
}

function isCompensationRecord(value: unknown): value is AsyncDoneCompensationRecord {
  if (!isRecord(value)) {
    return false;
  }
  return value.version === 1
    && typeof value.paymentKey === 'string'
    && typeof value.reason === 'string'
    && Array.isArray(value.cancelRequestIds)
    && typeof value.attempts === 'number'
    && typeof value.state === 'string'
    && typeof value.lastAttemptAt === 'string'
    && isRecord(value.payment)
    && isRecord(value.cancelRequest)
    && isRecord(value.cancelRequest.options);
}

export function readAsyncDoneCompensation(metadata: unknown): AsyncDoneCompensationRecord | null {
  const value = isRecord(metadata) ? metadata[ASYNC_DONE_COMPENSATION_METADATA_KEY] : undefined;
  return isCompensationRecord(value) ? value : null;
}

export function readDuplicatePaymentCompensations(metadata: unknown): AsyncDoneCompensationRecord[] {
  const value = isRecord(metadata) ? metadata[DUPLICATE_PAYMENT_COMPENSATIONS_METADATA_KEY] : undefined;
  return Array.isArray(value) ? value.filter(isCompensationRecord) : [];
}

/** A stable, PG-safe cancelRequestId seed for a duplicate charge without a payment row. */
export function buildDuplicateCancelRequestSeed(paymentKey: string): string {
  return `dup-${createHash('sha256').update(paymentKey).digest('hex').slice(0, 32)}`;
}
