import type { TossPaymentCancelOptions, TossPaymentResponse } from './toss-payments.client.js';
import { readStoredPaymentCancelReceipt } from './payment-cancel-policy.js';

export type TossPaymentCancelRecord = NonNullable<TossPaymentResponse['cancels']>[number];

export type TossCompletedCancelExpectation = {
  cancelAmount?: number;
  cancelRequestId?: string | null;
  cancelReason?: string;
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
  return completedCancels.some((cancel) =>
    isMatchingCompletedProviderCancel(cancel, expected),
  );
}

export function isTossPaymentCancelCompleted(
  response: TossPaymentResponse,
  cancelRequestId?: string | null,
  options: {
    allowPartialStatus?: boolean;
    expectedCancelAmount?: number;
    expectedCancelReason?: string;
    allowUnidentifiedPartialCancel?: boolean;
    requestedAt?: Date | string | null;
  } = {},
): boolean {
  const completedPaymentStatuses = options.allowPartialStatus
    ? new Set(['CANCELED', 'PARTIAL_CANCELED'])
    : new Set(['CANCELED']);
  const normalizedCancelRequestId = normalizeCancelRequestId(cancelRequestId);

  if (options.expectedCancelReason !== undefined) {
    return completedPaymentStatuses.has(response.status)
      && hasMatchingCompletedProviderCancel(getCompletedProviderCancels(response), {
        cancelReason: options.expectedCancelReason, cancelAmount: options.expectedCancelAmount,
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

export function buildCompletedCancelExpectation(
  options: TossPaymentCancelOptions,
  requestedAt?: Date | string | null,
  frozenMetadata?: unknown,
): TossCompletedCancelExpectation {
  const receipt = readStoredPaymentCancelReceipt(frozenMetadata);
  return {
    cancelAmount: receipt.expectedCancelAmount ?? options.cancelAmount,
    cancelReason: receipt.expectedCancelReason,
    cancelRequestId: options.cancelRequestId,
    requestedAt,
  };
}

function isMatchingCompletedProviderCancel(
  cancel: TossPaymentCancelRecord,
  expected: TossCompletedCancelExpectation,
): boolean {
  const expectedCancelRequestId = normalizeCancelRequestId(expected.cancelRequestId);
  if (expected.cancelReason !== undefined && cancel.cancelReason !== expected.cancelReason) return false;
  if (expectedCancelRequestId) {
    if (cancel.cancelRequestId !== expectedCancelRequestId) {
      return false;
    }
  } else if (expected.cancelReason === undefined && !isCancelAtOrAfterRequest(cancel, expected.requestedAt)) {
    return false;
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
