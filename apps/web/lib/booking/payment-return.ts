import type { ConfirmPaymentRequest } from '@grabit/shared';

interface ConfirmPaymentReturnParams {
  paymentKey: string;
  orderId: string;
  amount: string | null;
  provider: string | null;
  providerChargeAmount: string | null;
}

export function hasValidConfirmPaymentReturn({
  provider,
  amount,
  providerChargeAmount,
}: Pick<ConfirmPaymentReturnParams, 'provider' | 'amount' | 'providerChargeAmount'>): boolean {
  const parsedAmount = Number(amount);
  const hasValidAmount = amount !== null && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const hasValidProviderChargeAmount = !!providerChargeAmount?.trim();

  if (provider === 'PAYPAL') {
    return hasValidProviderChargeAmount;
  }
  if (provider === 'OVERSEAS_CARD') {
    return hasValidProviderChargeAmount || hasValidAmount;
  }
  return hasValidAmount;
}

export function buildConfirmPaymentPayload({
  paymentKey,
  orderId,
  amount,
  provider,
  providerChargeAmount,
}: ConfirmPaymentReturnParams): ConfirmPaymentRequest {
  if (provider === 'PAYPAL') {
    return {
      paymentKey,
      orderId,
      provider: 'PAYPAL',
      providerChargeAmount: providerChargeAmount ?? '',
    };
  }

  if (provider === 'OVERSEAS_CARD') {
    if (!providerChargeAmount?.trim()) {
      return {
        paymentKey,
        orderId,
        provider: 'OVERSEAS_CARD',
        amount: Number(amount),
      };
    }
    return {
      paymentKey,
      orderId,
      provider: 'OVERSEAS_CARD',
      providerChargeAmount: providerChargeAmount ?? '',
    };
  }

  return {
    paymentKey,
    orderId,
    amount: Number(amount),
  };
}
