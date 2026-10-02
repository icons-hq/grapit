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
 * A browser releases its own Provider Handoff whenever the provider SDK rejects
 * `requestPayment`: a pre-checkout validation error (card issuer not selected, a
 * selection race, invalid parameters) and also a checkout the buyer opened and then
 * closed (`USER_CANCEL`). Both reject within seconds of the handoff.
 *
 * The window is not what keeps release safe. Release also requires the order's confirm
 * lease (no confirm in flight) and no confirm-attempt marker (no confirm ever started
 * for the order; the marker outlives the window by far), plus no Payment row. The
 * window only bounds how long a stale or scripted caller can reopen a handoff whose
 * provider checkout may still be open in another tab.
 */
export const PAYMENT_HANDOFF_RELEASE_WINDOW_MS = 45_000;

/**
 * Toss keeps a payment that was opened but never authenticated in READY and expires it
 * after 30 minutes (EXPIRED webhook); an authenticated but unconfirmed one expires
 * after 10 minutes.
 */
export const TOSS_UNAUTHENTICATED_CHECKOUT_EXPIRY_MS = 30 * 60 * 1000;

/**
 * Upper bound of a Prepared Checkout's payment deadline, counted from reservation
 * creation, however often checkout is re-entered (branch grace extends the deadline up
 * to this cap).
 *
 * Release reuse depends on this cap staying below Toss' 30-minute READY expiry
 * ({@link TOSS_UNAUTHENTICATED_CHECKOUT_EXPIRY_MS}). A released handoff keeps the same
 * orderId, so the checkout the buyer closed may still turn READY -> EXPIRED at Toss and
 * send a late EXPIRED webhook for that orderId. The order's payment deadline (at most
 * this cap after creation) has passed before that expiry, so the late EXPIRED can only
 * meet a confirmed, failed or expired order, never a retry still in progress, and the
 * stale webhook filters keep it from rewriting that outcome. Raising the cap to 30
 * minutes or more breaks that guarantee (asserted in payment-handoff-policy.spec.ts).
 */
export const PAYMENT_PROCESSING_TOTAL_CAP_MS = 15 * 60 * 1000;

/**
 * Orphan sweeps start only after the provider-owned resolution (READY expiry after
 * {@link TOSS_UNAUTHENTICATED_CHECKOUT_EXPIRY_MS}, reported through the EXPIRED webhook)
 * had time to land.
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
