import type { ConfirmPaymentRequest } from '@grabit/shared';

interface ConfirmPaymentReturnParams {
  paymentKey: string;
  orderId: string;
  amount: string | null;
  provider: string | null;
  providerChargeAmount: string | null;
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
