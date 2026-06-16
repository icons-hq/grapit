import type { PaymentFailureDiagnostic } from '@grabit/shared';
import type { VisibleCopy } from '@/lib/i18n/visible-copy';

type PaymentFailureGuidanceCopy = VisibleCopy['booking']['paymentFailureGuidance'];

export interface PaymentFailureGuidance {
  label: string;
  title: string;
  body: string;
  providerMessage: string | null;
}

const INSTALLMENT_UNSUPPORTED_CODES = new Set([
  'NOT_SUPPORTED_INSTALLMENT_PLAN_CARD_OR_MERCHANT',
]);

const EXPIRED_CODES = new Set([
  'PAYMENT_DEADLINE_EXPIRED',
  'PAYMENT_EXPIRED',
]);

const ABORTED_CODES = new Set([
  'PAYMENT_ABORTED',
  'PAY_PROCESS_ABORTED',
]);

const CANCELLED_CODES = new Set([
  'PAY_PROCESS_CANCELED',
  'PAYMENT_CANCELED_BEFORE_CONFIRM',
]);

function normalizeCode(code: string | null | undefined): string {
  return code?.trim().toUpperCase() ?? '';
}

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

function resolveGuidanceCopy(
  code: string | null | undefined,
  copy: PaymentFailureGuidanceCopy,
) {
  const normalizedCode = normalizeCode(code);
  if (INSTALLMENT_UNSUPPORTED_CODES.has(normalizedCode)) {
    return copy.installmentUnsupported;
  }
  if (EXPIRED_CODES.has(normalizedCode)) {
    return copy.expired;
  }
  if (ABORTED_CODES.has(normalizedCode)) {
    return copy.aborted;
  }
  if (CANCELLED_CODES.has(normalizedCode)) {
    return copy.cancelled;
  }
  return copy.unknown;
}

function resolveProviderMessage(
  providerMessage: string | null | undefined,
  guidance: { title: string; body: string },
  providerMessagePrefix: string,
): string | null {
  const normalized = normalizeMessage(providerMessage ?? '');
  if (!normalized) return null;

  const hiddenMessages = new Set([
    normalizeMessage(guidance.title),
    normalizeMessage(guidance.body),
  ]);
  if (hiddenMessages.has(normalized)) return null;

  return `${providerMessagePrefix}: ${normalized}`;
}

export function getPaymentFailureGuidance({
  code,
  providerMessage,
  copy,
  providerMessagePrefix,
}: {
  code: string | null | undefined;
  providerMessage: string | null | undefined;
  copy: PaymentFailureGuidanceCopy;
  providerMessagePrefix: string;
}): PaymentFailureGuidance {
  const guidanceCopy = resolveGuidanceCopy(code, copy);
  return {
    label: copy.label,
    title: guidanceCopy.title,
    body: guidanceCopy.body,
    providerMessage: resolveProviderMessage(
      providerMessage,
      guidanceCopy,
      providerMessagePrefix,
    ),
  };
}

export function getDiagnosticPaymentFailureGuidance({
  diagnostic,
  copy,
  providerMessagePrefix,
}: {
  diagnostic: PaymentFailureDiagnostic | null | undefined;
  copy: PaymentFailureGuidanceCopy;
  providerMessagePrefix: string;
}): PaymentFailureGuidance | null {
  if (!diagnostic) return null;

  return getPaymentFailureGuidance({
    code: diagnostic.code,
    providerMessage: null,
    copy,
    providerMessagePrefix,
  });
}
