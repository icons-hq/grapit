import {
  CHECKOUT_CONFIGURABLE_PAYMENT_METHODS,
  DEFAULT_PERFORMANCE_BOOKING_POLICY,
  type PaymentMethod,
  type PaymentProvider,
} from '@grabit/shared';

/**
 * Payment method policy shared by every path that can issue a ticket for a
 * provider approval: synchronous confirm (new, looked-up and cutoff
 * approvals), async DONE (webhook and pending return) and checkout branch.
 *
 * The server-enforced set is `CHECKOUT_CONFIGURABLE_PAYMENT_METHODS` from
 * `@grabit/shared`, the same list the admin performance form offers. A method
 * outside it (virtual account, mobile phone, gift certificates, unsupported
 * easy pay providers) is never issued, whatever the performance policy says.
 */
export type CheckoutConfigurablePaymentMethod = typeof CHECKOUT_CONFIGURABLE_PAYMENT_METHODS[number];

export type ApprovedPaymentMethodCategory =
  | CheckoutConfigurablePaymentMethod
  | 'VIRTUAL_ACCOUNT'
  | 'MOBILE_PHONE'
  | 'UNSUPPORTED';

export interface ApprovedPaymentMethod {
  category: ApprovedPaymentMethodCategory;
  /**
   * The easy pay provider, set for SIMPLE_PAY and a recognised FOREIGN_EASY_PAY
   * wallet. A FOREIGN_EASY_PAY without it is an unknown wallet.
   */
  provider?: PaymentProvider;
}

export type ApprovedMethodPolicyMismatch =
  /** Virtual account, mobile phone, gift certificate, unknown label, easy pay provider or foreign wallet. */
  | 'unsupported_method'
  /** The performance policy (or the platform default) does not allow the category. */
  | 'not_allowed_by_policy'
  /** The order has no frozen checkout method to compare with. */
  | 'checkout_method_missing'
  /** The approved category differs from the order's frozen checkout method. */
  | 'checkout_method_mismatch'
  /** An easy pay (domestic or foreign wallet) approved with another provider than the one checked out. */
  | 'checkout_provider_mismatch';

/**
 * Toss `Payment.method` labels. Toss answers in Korean by default and in
 * English with `Accept-Language: en-US` (ENUM 코드 > 결제수단 응답 타입).
 * `SIMPLE_PAY` is this platform's own category name, accepted as an alias.
 */
const METHOD_CATEGORY_BY_LABEL: Readonly<Record<string, ApprovedPaymentMethodCategory>> = {
  카드: 'CARD',
  CARD: 'CARD',
  계좌이체: 'TRANSFER',
  TRANSFER: 'TRANSFER',
  간편결제: 'SIMPLE_PAY',
  EASY_PAY: 'SIMPLE_PAY',
  SIMPLE_PAY: 'SIMPLE_PAY',
  해외간편결제: 'FOREIGN_EASY_PAY',
  FOREIGN_EASY_PAY: 'FOREIGN_EASY_PAY',
  가상계좌: 'VIRTUAL_ACCOUNT',
  VIRTUAL_ACCOUNT: 'VIRTUAL_ACCOUNT',
  휴대폰: 'MOBILE_PHONE',
  MOBILE_PHONE: 'MOBILE_PHONE',
};

/**
 * `Payment.easyPay.provider` codes (기관 코드 > 간편결제사 코드) that checkout
 * can submit. Toss renamed `토스결제` to `토스페이`; both are accepted. Every
 * other provider (PAYCO, 삼성페이, 애플페이, 엘페이, 핀페이, SSG페이) is unsupported.
 */
const SIMPLE_PAY_PROVIDER_BY_LABEL: Readonly<Record<string, PaymentProvider>> = {
  토스페이: 'TOSS_PAY',
  토스결제: 'TOSS_PAY',
  TOSSPAY: 'TOSS_PAY',
  TOSS_PAY: 'TOSS_PAY',
  네이버페이: 'NAVER_PAY',
  NAVERPAY: 'NAVER_PAY',
  NAVER_PAY: 'NAVER_PAY',
  카카오페이: 'KAKAOPAY',
  KAKAOPAY: 'KAKAOPAY',
};

/**
 * Foreign wallet `easyPay` codes (해외 간편결제 연동하기 > 응답 확인하기). The
 * provider is compared with the frozen checkout provider like a domestic easy
 * pay. Checkout sells Toss `ALIPAY` as `ALIPAY_PLUS`; the other asynchronous
 * wallets Toss groups with it (중국 및 동남아 간편결제: AlipayHK, BillEase,
 * Boost, BPI, DANA, GCash, Rabbit LINE Pay, Touch 'n Go) settle through the
 * same Alipay+ checkout, key and quote, so they read as `ALIPAY_PLUS` and a
 * wallet that checkout settled with is never refunded as a mismatch. TrueMoney
 * stays its own provider (unsupported, refunded by the async DONE provider
 * check) and PayPal its own synchronous route. Any other code, or none, is an
 * unknown wallet and never passes the policy.
 */
const FOREIGN_EASY_PAY_PROVIDER_BY_LABEL: Readonly<Record<string, PaymentProvider>> = {
  PAYPAL: 'PAYPAL',
  페이팔: 'PAYPAL',
  ALIPAY: 'ALIPAY_PLUS',
  ALIPAY_PLUS: 'ALIPAY_PLUS',
  알리페이: 'ALIPAY_PLUS',
  ALIPAYHK: 'ALIPAY_PLUS',
  BILLEASE: 'ALIPAY_PLUS',
  BOOST: 'ALIPAY_PLUS',
  BPI: 'ALIPAY_PLUS',
  DANA: 'ALIPAY_PLUS',
  다나: 'ALIPAY_PLUS',
  GCASH: 'ALIPAY_PLUS',
  지캐시: 'ALIPAY_PLUS',
  RABBIT_LINE_PAY: 'ALIPAY_PLUS',
  TOUCHNGO: 'ALIPAY_PLUS',
  터치앤고: 'ALIPAY_PLUS',
  TRUEMONEY: 'TRUEMONEY',
  트루머니: 'TRUEMONEY',
};

function lookupLabel<T>(table: Readonly<Record<string, T>>, label: string | null | undefined): T | undefined {
  const trimmed = label?.trim();
  if (!trimmed) {
    return undefined;
  }
  return table[trimmed] ?? table[trimmed.toUpperCase()];
}

/**
 * `Payment.easyPay` is an object (`{ provider, amount, discountAmount }`) in
 * the Payment API; webhook payloads of foreign wallets carry it as a string.
 */
export function readTossEasyPayProvider(easyPay: unknown): string | undefined {
  if (typeof easyPay === 'string') {
    return easyPay.trim() || undefined;
  }
  if (easyPay && typeof easyPay === 'object' && !Array.isArray(easyPay)) {
    const provider = (easyPay as { provider?: unknown }).provider;
    return typeof provider === 'string' && provider.trim() ? provider.trim() : undefined;
  }
  return undefined;
}

/**
 * The category of a Toss `method` label alone (Korean or English), without
 * the easy pay provider check. Used to store the method of a payment row; the
 * policy decision uses {@link normalizeTossApprovedMethod}.
 */
export function categorizeTossMethodLabel(
  method: string | null | undefined,
): ApprovedPaymentMethodCategory {
  return lookupLabel(METHOD_CATEGORY_BY_LABEL, method) ?? 'UNSUPPORTED';
}

/**
 * Maps a provider-verified `method` (and `easyPay`) to a checkout category.
 * Only provider responses (confirm, payment lookup) may be passed in: client
 * or callback values never decide the policy.
 */
export function normalizeTossApprovedMethod(
  method: string | null | undefined,
  easyPay?: unknown,
): ApprovedPaymentMethod {
  const category = lookupLabel(METHOD_CATEGORY_BY_LABEL, method);
  if (!category) {
    return { category: 'UNSUPPORTED' };
  }

  const easyPayProvider = readTossEasyPayProvider(easyPay);
  if (category === 'SIMPLE_PAY') {
    const provider = lookupLabel(SIMPLE_PAY_PROVIDER_BY_LABEL, easyPayProvider);
    return provider ? { category, provider } : { category: 'UNSUPPORTED' };
  }
  if (category === 'FOREIGN_EASY_PAY') {
    const provider = lookupLabel(FOREIGN_EASY_PAY_PROVIDER_BY_LABEL, easyPayProvider);
    return provider ? { category, provider } : { category };
  }
  return { category };
}

const CHECKOUT_CONFIGURABLE_PAYMENT_METHOD_SET: ReadonlySet<string> = new Set(
  CHECKOUT_CONFIGURABLE_PAYMENT_METHODS,
);

/** A raw jsonb text value; anything unparseable reads as no stored policy. */
function parseJsonArray(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * The methods the server enforces for a performance: its stored
 * `booking_policies.allowed_payment_methods` (an empty or missing policy means
 * the platform default, as in reservation prepare), intersected with
 * `CHECKOUT_CONFIGURABLE_PAYMENT_METHODS`.
 */
export function resolveEnforcedAllowedPaymentMethods(
  stored: unknown,
): readonly CheckoutConfigurablePaymentMethod[] {
  const parsed = typeof stored === 'string' ? parseJsonArray(stored) : stored;
  const methods: readonly unknown[] = Array.isArray(parsed) && parsed.length > 0
    ? parsed
    : DEFAULT_PERFORMANCE_BOOKING_POLICY.allowedPaymentMethods;
  return CHECKOUT_CONFIGURABLE_PAYMENT_METHODS.filter((method) => methods.includes(method));
}

/** Whether a checkout method category is in the enforced set (branch pre-check). */
export function isEnforcedCheckoutPaymentMethod(
  paymentMethod: Pick<PaymentMethod, 'method'>,
  enforced: readonly string[],
): boolean {
  return CHECKOUT_CONFIGURABLE_PAYMENT_METHOD_SET.has(paymentMethod.method)
    && enforced.includes(paymentMethod.method);
}

/**
 * Compares a provider-verified approval with the order's frozen checkout
 * method and the enforced policy. An easy pay, domestic or foreign wallet,
 * must also be approved with the frozen checkout provider; an unknown provider
 * is unsupported in both, since it cannot be proven to be the one checked out.
 * Returns null when the approval may be issued.
 */
export function findApprovedMethodPolicyMismatch(
  approved: ApprovedPaymentMethod,
  checkoutPaymentMethod: Pick<PaymentMethod, 'method' | 'provider'> | null | undefined,
  enforced: readonly string[],
): ApprovedMethodPolicyMismatch | null {
  const { category } = approved;
  if (
    category === 'UNSUPPORTED'
    || category === 'VIRTUAL_ACCOUNT'
    || category === 'MOBILE_PHONE'
    || (category === 'FOREIGN_EASY_PAY' && !approved.provider)
  ) {
    return 'unsupported_method';
  }
  if (!enforced.includes(category)) {
    return 'not_allowed_by_policy';
  }
  if (!checkoutPaymentMethod) {
    return 'checkout_method_missing';
  }
  if (checkoutPaymentMethod.method !== category) {
    return 'checkout_method_mismatch';
  }
  if (
    (category === 'SIMPLE_PAY' || category === 'FOREIGN_EASY_PAY')
    && approved.provider !== checkoutPaymentMethod.provider
  ) {
    return 'checkout_provider_mismatch';
  }
  return null;
}
