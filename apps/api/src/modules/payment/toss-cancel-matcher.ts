import type { TossPaymentCancelOptions, TossPaymentResponse } from './toss-payments.client.js';
import { legacyCancelAttemptSuffix, readStoredPaymentCancelReceipt, type StoredCancelReceipt } from './payment-cancel-policy.js';

export type TossPaymentCancelRecord = NonNullable<TossPaymentResponse['cancels']>[number];

export type TossCompletedCancelExpectation = {
  cancelAmount?: number;
  cancelRequestId?: string | null;
  cancelReason?: string;
  attemptSuffix?: string;
  transactionKey?: string;
  requestedAt?: Date | string | null;
};

export function getCompletedProviderCancels(
  providerResponse: TossPaymentResponse,
): TossPaymentCancelRecord[] {
  return providerResponse.cancels?.filter((cancel) =>
    typeof cancel.cancelAmount === 'number'
    && cancel.cancelAmount > 0
    && cancel.cancelStatus === 'DONE'
  ) ?? [];
}

export function hasMatchingCompletedProviderCancel(
  completedCancels: readonly TossPaymentCancelRecord[],
  expected: TossCompletedCancelExpectation,
): boolean {
  const matches = completedCancels.filter(cancel => matchesCancelRecord(cancel, expected));
  return expected.transactionKey || expected.cancelReason || expected.cancelRequestId ? matches.length === 1 : matches.length > 0;
}

function matchesFrozenBalance(response: TossPaymentResponse, { ledger }: StoredCancelReceipt): boolean {
  return !ledger || (response.paymentKey === ledger.paymentKey && response.currency === ledger.currency
    && response.totalAmount === ledger.total && response.balanceAmount === ledger.remaining);
}

export function isTossPaymentCancelCompleted(
  response: TossPaymentResponse,
  cancelRequestId?: string | null,
  options: StoredCancelReceipt & {
    allowPartialStatus?: boolean;
    allowUnidentifiedPartialCancel?: boolean;
    requestedAt?: Date | string | null;
  } = {},
): boolean {
  if (!matchesFrozenBalance(response, options)) return false;
  const completedPaymentStatuses = options.allowPartialStatus
    ? new Set(['CANCELED', 'PARTIAL_CANCELED'])
    : new Set(['CANCELED']);
  const normalizedCancelRequestId = normalizeCancelRequestId(cancelRequestId);

  if (options.expectedCancelReason !== undefined || options.expectedTransactionKey) {
    const scale = response.currency === 'USD' ? 100 : 1;
    const exhausted = response.status === 'PARTIAL_CANCELED' && response.balanceAmount === 0
      && getCompletedProviderCancels(response).reduce((sum, row) => sum + Math.round(row.cancelAmount * scale), 0)
        === Math.round(response.totalAmount * scale);
    return (completedPaymentStatuses.has(response.status) || exhausted)
      && hasMatchingCompletedProviderCancel(getCompletedProviderCancels(response), {
        transactionKey: options.expectedTransactionKey, cancelReason: options.expectedCancelReason, cancelAmount: options.expectedCancelAmount,
        attemptSuffix: options.expectedAttemptSuffix,
        cancelRequestId: normalizedCancelRequestId, requestedAt: options.requestedAt,
      });
  }

  if (normalizedCancelRequestId) {
    if (!completedPaymentStatuses.has(response.status)) {
      return false;
    }

    return hasMatchingCompletedProviderCancel(getCompletedProviderCancels(response), {
      cancelRequestId: normalizedCancelRequestId,
      cancelAmount: options.expectedCancelAmount,
    });
  }

  if (response.status === 'PARTIAL_CANCELED') {
    return options.allowUnidentifiedPartialCancel === true
      && typeof options.expectedCancelAmount === 'number'
      && hasMatchingCompletedProviderCancel(getCompletedProviderCancels(response), {
        cancelAmount: options.expectedCancelAmount,
        requestedAt: options.requestedAt,
      });
  }

  return completedPaymentStatuses.has(response.status);
}

export function matchesCompletedRefundWebhook(
  response: TossPaymentResponse,
  options: TossPaymentCancelOptions,
  requestedAt?: Date | string | null,
  frozenMetadata?: unknown,
): boolean {
  const receipt = readStoredPaymentCancelReceipt(frozenMetadata);
  return matchesFrozenBalance(response, receipt) && hasMatchingCompletedProviderCancel(getCompletedProviderCancels(response), {
    cancelAmount: receipt.expectedCancelAmount ?? options.cancelAmount,
    transactionKey: receipt.expectedTransactionKey, cancelReason: receipt.expectedCancelReason,
    attemptSuffix: receipt.expectedAttemptSuffix,
    cancelRequestId: options.cancelRequestId,
    requestedAt,
  });
}

export function matchingTicketCancelRows(
  cancels: readonly TossPaymentCancelRecord[],
  command: { reason: string; transactionKey?: string; currency: string; amountMinor: number; options: TossPaymentCancelOptions },
) {
  return cancels.filter(cancel => cancel.cancelStatus === 'DONE' && matchesCancelRecord(cancel, {
    cancelAmount: command.amountMinor / (command.currency === 'USD' ? 100 : 1),
    cancelReason: command.reason, transactionKey: command.transactionKey, cancelRequestId: command.options.cancelRequestId,
    attemptSuffix: legacyCancelAttemptSuffix(command),
  }));
}

export function matchesPendingOrAbortedCancel(
  response: Pick<TossPaymentResponse, 'cancels'>, status: 'IN_PROGRESS' | 'ABORTED',
  cancelRequestId: string | undefined, receipt: StoredCancelReceipt,
): boolean {
  if (!cancelRequestId && !receipt.expectedCancelReason && !receipt.expectedTransactionKey) return false;
  return response.cancels?.filter(cancel => cancel.cancelStatus === status && matchesCancelRecord(cancel, {
    cancelRequestId, cancelAmount: receipt.expectedCancelAmount, cancelReason: receipt.expectedCancelReason,
    attemptSuffix: receipt.expectedAttemptSuffix, transactionKey: receipt.expectedTransactionKey,
  })).length === 1;
}

function matchesCancelRecord(
  cancel: TossPaymentCancelRecord,
  expected: TossCompletedCancelExpectation,
): boolean {
  const expectedCancelRequestId = normalizeCancelRequestId(expected.cancelRequestId);
  if (expected.transactionKey && cancel.transactionKey !== expected.transactionKey) return false;
  if (expectedCancelRequestId && cancel.cancelRequestId !== expectedCancelRequestId) return false;
  if (!expected.transactionKey && !expectedCancelRequestId) {
    if (expected.cancelReason === undefined) {
      if (!isCancelAtOrAfterRequest(cancel, expected.requestedAt)) return false;
    } else if (cancel.cancelReason !== expected.cancelReason) {
      if (!expected.attemptSuffix || !cancel.transactionKey || !expected.cancelAmount
        || !cancel.cancelReason?.endsWith(expected.attemptSuffix)) return false;
    }
  }

  if (
    expected.cancelAmount !== undefined
    && cancel.cancelAmount !== expected.cancelAmount
  ) {
    return false;
  }

  return true;
}

function normalizeCancelRequestId(cancelRequestId: string | null | undefined): string | null {
  if (typeof cancelRequestId !== 'string') {
    return null;
  }
  const trimmed = cancelRequestId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isCancelAtOrAfterRequest(
  cancel: TossPaymentCancelRecord,
  requestedAt: Date | string | null | undefined,
): boolean {
  const requestTime = toTimestamp(requestedAt);
  const canceledTime = toTimestamp(cancel.canceledAt);

  return requestTime !== null && canceledTime !== null && canceledTime >= requestTime;
}

function toTimestamp(value: Date | string | null | undefined): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return null;
}
