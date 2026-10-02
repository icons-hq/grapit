import type { PaymentMethod, PaymentProvider } from '@grabit/shared';

/**
 * Foreign wallets that the provider can approve without this server's confirm call.
 * Their handoff outcome is owned by the provider webhook, never by local release or review.
 */
export const ASYNC_APPROVAL_FOREIGN_EASY_PAY_PROVIDERS = [
  'ALIPAY_PLUS',
  'TRUEMONEY',
] as const satisfies readonly PaymentProvider[];

const ASYNC_APPROVAL_FOREIGN_EASY_PAY_PROVIDER_SET = new Set<PaymentProvider>(
  ASYNC_APPROVAL_FOREIGN_EASY_PAY_PROVIDERS,
);

/**
 * The single list of asynchronously approved foreign wallets: checkout branching,
 * webhook method resolution, secret key scope, Provider Handoff release and the
 * abandoned handoff review all read it.
 */
export function isAsyncApprovalForeignEasyPayProvider(
  provider: PaymentProvider | null | undefined,
): boolean {
  return provider !== null
    && provider !== undefined
    && ASYNC_APPROVAL_FOREIGN_EASY_PAY_PROVIDER_SET.has(provider);
}

/**
 * A browser may release its own Provider Handoff only right after the provider SDK
 * rejected before opening checkout, which happens within seconds of the handoff.
 *
 * The window is not what keeps release safe. Release also requires the order's confirm
 * lease (no confirm in flight) and no confirm-attempt marker (no confirm ever started
 * for the order; the marker outlives the window by far), plus no Payment row. The
 * window only bounds how long a stale or scripted caller can reopen a handoff whose
 * provider checkout may still be open in another tab.
 */
export const PAYMENT_HANDOFF_RELEASE_WINDOW_MS = 45_000;

/**
 * Toss expires an unauthenticated checkout after 30 minutes and an authenticated but
 * unconfirmed one after 10 minutes, and reports both through the EXPIRED webhook.
 * Orphan sweeps start only after that provider-owned resolution had time to land.
 */
export const ABANDONED_PAYMENT_HANDOFF_GRACE_MS = 45 * 60 * 1000;

export const PAYMENT_HANDOFF_UNKNOWN_MESSAGE =
  '결제 상태를 확인 중입니다. 기존 예매를 다시 확인해주세요.';

/**
 * Card, transfer, domestic easy pay, overseas card and PayPal are charged only when
 * this server calls the Toss confirm API. Asynchronous foreign wallets can be
 * approved at the provider without a merchant confirm, so their unknown handoff is
 * never released or abandoned locally.
 */
export function isMerchantConfirmedCheckoutMethod(paymentMethod: PaymentMethod): boolean {
  return !(
    paymentMethod.method === 'FOREIGN_EASY_PAY'
    && isAsyncApprovalForeignEasyPayProvider(paymentMethod.provider)
  );
}
