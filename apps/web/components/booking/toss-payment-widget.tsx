'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { useLocale } from 'next-intl';
import {
  loadTossPayments,
  type TossPaymentsPayment,
  type TossPaymentsWidgets,
  type WidgetAgreementStatus,
} from '@tosspayments/tosspayments-sdk';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { TICKET_SERVICE_FEE_KRW } from '@grabit/shared';
import type {
  FloorAwareSeatSelection,
  PaymentMethod,
  PaymentProvider,
  PrepareReservationResponse,
  ProviderChargeQuote,
} from '@grabit/shared';

const OVERSEAS_PAYMENT_CONSENT_VERSION = '2026-05-08';
const PAYPAL_VARIANT_KEY = 'paypal';
const ALIPAY_VARIANT_KEY = 'alipay';
const PAYPAL_WIDGET_USD_ESTIMATE_RATE = 0.00068;
const FOREIGN_WALLET_CODES = new Set(['ALIPAY', 'ALIPAY_PLUS', 'TRUEMONEY', 'PAYPAL', '페이팔']);
const PROVIDER_CHARGE_QUOTE_PROVIDERS = new Set<PaymentProvider>(['ALIPAY_PLUS', 'PAYPAL']);
const PLACEHOLDER_PHONE_NUMBERS = new Set(['01000000000']);
const OVERSEAS_CARD_CODES = new Set([
  'VISA',
  'MASTER',
  'JCB',
  'UNIONPAY',
  'AMEX',
  'DISCOVER',
  'DINERS',
]);

const SIMPLE_PAY_PROVIDER_BY_CODE = {
  TOSSPAY: 'TOSS_PAY',
  NAVERPAY: 'NAVER_PAY',
  KAKAOPAY: 'KAKAOPAY',
} as const satisfies Record<string, PaymentProvider>;

const FOREIGN_PROVIDER_BY_CODE = {
  ALIPAY: 'ALIPAY_PLUS',
  ALIPAY_PLUS: 'ALIPAY_PLUS',
  TRUEMONEY: 'TRUEMONEY',
  PAYPAL: 'PAYPAL',
  페이팔: 'PAYPAL',
} as const satisfies Record<string, PaymentProvider>;

const LOCALE_TO_COUNTRY = {
  ko: 'KR',
  en: 'US',
  th: 'TH',
  'zh-CN': 'CN',
} as const;
type PaymentWidgetLocale = keyof typeof LOCALE_TO_COUNTRY;

type PaymentMethodWidget = Awaited<ReturnType<TossPaymentsWidgets['renderPaymentMethods']>>;
type AgreementWidget = Awaited<ReturnType<TossPaymentsWidgets['renderAgreement']>>;
type SelectedWidgetPaymentMethod = Awaited<ReturnType<PaymentMethodWidget['getSelectedPaymentMethod']>>;

interface TossPaymentWidgetProps {
  orderId: string;
  orderName: string;
  amount: number;
  performanceId: string;
  customerKey: string;
  customerName: string;
  customerEmail: string;
  customerMobilePhone?: string;
  selectedSeats: FloorAwareSeatSelection[];
  onReady: () => void;
  onPaymentMethodChange?: (selection: PaymentMethodSelection) => void;
  onWidgetAgreementChange?: (agreed: boolean) => void;
}

export interface TossPaymentWidgetRef {
  requestPayment: (prepareResult?: PrepareReservationResponse) => Promise<void>;
}

export interface PaymentMethodSelection {
  code: string;
  paymentMethod: PaymentMethod;
  requiresOverseasDisclaimer: boolean;
  requestFlow: 'widget' | 'direct_card';
}

export interface TossPaymentBranchResponse {
  orderId: string;
  method: PaymentMethod['method'];
  provider: PaymentMethod['provider'];
  currency: string;
  successUrl: string;
  failUrl: string;
  pendingUrl?: string;
  asyncStatus: 'sync' | 'pending_webhook';
  useInternationalCardOnly: boolean;
  providerChargeQuote?: ProviderChargeQuote;
  checkoutEnabled?: boolean;
  disabledReason?: string;
}

interface WidgetPaymentRequestPayload {
  orderId: string;
  orderName: string;
  successUrl: string;
  failUrl: string;
  pendingUrl?: string;
  customerEmail?: string;
  customerName?: string;
  customerMobilePhone?: string;
  card?: {
    useInternationalCardOnly?: boolean;
  };
  foreignEasyPay?: {
    country: string;
    products: Array<{
      name: string;
      quantity: number;
      unitAmount: number;
      currency: string;
      description: string;
    }>;
  };
}

interface DirectCardPaymentRequestPayload {
  method: 'CARD';
  amount: {
    currency: 'KRW';
    value: number;
  };
  orderId: string;
  orderName: string;
  successUrl: string;
  failUrl: string;
  customerEmail?: string;
  customerName?: string;
  customerMobilePhone?: string;
  card: {
    useInternationalCardOnly: true;
  };
}

function sanitizePhoneNumber(phone: string | undefined): string | undefined {
  if (!phone) {
    return undefined;
  }

  const normalized = phone.replace(/\D/g, '');
  if (PLACEHOLDER_PHONE_NUMBERS.has(normalized)) {
    return undefined;
  }
  return normalized.length > 0 ? normalized : undefined;
}

function createOverseasConsent(): PaymentMethod['overseasPaymentConsent'] {
  return {
    required: true,
    agreed: false,
    agreementVersion: OVERSEAS_PAYMENT_CONSENT_VERSION,
    agreedAt: null,
  };
}

function resolvePaymentWidgetLocale(locale: string | undefined): PaymentWidgetLocale {
  const visibleCopyLocale = resolveVisibleCopyLocale(locale);
  return visibleCopyLocale in LOCALE_TO_COUNTRY
    ? (visibleCopyLocale as PaymentWidgetLocale)
    : 'ko';
}

export function resolvePaymentWidgetVariantKey(): string {
  return resolvePaymentWidgetVariantKeys()[0] ?? 'DEFAULT';
}

export function resolvePaymentWidgetVariantKeys(): string[] {
  const rawVariantKeys = process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY ?? 'DEFAULT';
  const variantKeys = rawVariantKeys
    .split(',')
    .map((variantKey) => variantKey.trim())
    .filter((variantKey) => variantKey.length > 0);

  return variantKeys.length > 0 ? [...new Set(variantKeys)] : ['DEFAULT'];
}

export function resolvePaymentWidgetRenderVariantKey(variantKey: string): string {
  const trimmedVariantKey = variantKey.trim();
  if (trimmedVariantKey.toLowerCase() === PAYPAL_VARIANT_KEY) {
    return 'PAYPAL';
  }
  return trimmedVariantKey.length > 0 ? trimmedVariantKey : 'DEFAULT';
}

export function resolvePaymentWidgetClientKey(variantKey: string): string | undefined {
  if (isPaypalPaymentWidgetVariant(variantKey)) {
    return process.env.NEXT_PUBLIC_TOSS_FOREIGN_PAYMENT_WIDGET_CLIENT_KEY
      || process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  }
  return process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
}

export function isPaypalPaymentWidgetVariant(variantKey: string): boolean {
  return variantKey.toLowerCase() === PAYPAL_VARIANT_KEY;
}

function isAlipayPaymentWidgetVariant(variantKey: string): boolean {
  return variantKey.toLowerCase() === ALIPAY_VARIANT_KEY;
}

export function isForeignPaymentWidgetVariant(variantKey: string): boolean {
  const normalized = variantKey.toLowerCase();
  return normalized === PAYPAL_VARIANT_KEY || normalized === ALIPAY_VARIANT_KEY;
}

export function resolvePaymentWidgetVariantLabel(variantKey: string): string {
  const normalized = variantKey.toLowerCase();
  if (normalized === PAYPAL_VARIANT_KEY) {
    return '해외 결제';
  }
  if (normalized === ALIPAY_VARIANT_KEY) {
    return 'Alipay';
  }
  return '국내 결제';
}

export function resolvePaymentWidgetRenderAmount({
  amount,
  variantKey,
}: {
  amount: number;
  variantKey: string;
}): { currency: 'KRW' | 'USD'; value: number } {
  if (isForeignPaymentWidgetVariant(variantKey)) {
    return {
      currency: 'USD',
      value: Math.max(0.01, Math.round(amount * PAYPAL_WIDGET_USD_ESTIMATE_RATE * 100) / 100),
    };
  }

  return {
    currency: 'KRW',
    value: amount,
  };
}

function normalizePaymentMethodCode(code: string): string {
  return code === '페이팔' ? code : code.toUpperCase();
}

function usesProviderChargeQuote(provider: PaymentProvider): boolean {
  return PROVIDER_CHARGE_QUOTE_PROVIDERS.has(provider);
}

function usesProviderChargeQuoteForPaymentMethod(paymentMethod: PaymentMethod): boolean {
  return usesProviderChargeQuote(paymentMethod.provider)
    || (
      paymentMethod.method === 'CARD'
      && paymentMethod.provider === 'CARD'
      && paymentMethod.currency?.toUpperCase() === 'USD'
      && paymentMethod.overseasPaymentConsent?.required === true
    );
}

export function resolveProviderChargeDisabledMessage(
  provider: PaymentProvider,
  disabledReason?: string,
): string {
  if (provider === 'ALIPAY_PLUS') {
    return 'Alipay 결제 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.';
  }
  if (provider === 'PAYPAL') {
    return 'PayPal 결제 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.';
  }
  if (provider === 'CARD') {
    return '해외 카드 결제 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.';
  }
  return disabledReason ?? '해외 결제 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.';
}

export function resolvePaymentMethodSelection(
  code: string,
  variantKey = 'DEFAULT',
): PaymentMethodSelection {
  const normalizedCode = normalizePaymentMethodCode(code);

  if (
    isForeignPaymentWidgetVariant(variantKey)
    && (normalizedCode === 'ALIPAY' || normalizedCode === 'ALIPAY_PLUS')
  ) {
    return {
      code,
      requestFlow: 'widget',
      requiresOverseasDisclaimer: true,
      paymentMethod: {
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'USD',
        pendingUrlRequired: true,
        overseasPaymentConsent: createOverseasConsent(),
      },
    };
  }

  if (normalizedCode === 'CARD' && isForeignPaymentWidgetVariant(variantKey)) {
    return {
      code,
      requestFlow: 'widget',
      requiresOverseasDisclaimer: true,
      paymentMethod: {
        method: 'CARD',
        provider: 'CARD',
        currency: 'USD',
        overseasPaymentConsent: createOverseasConsent(),
      },
    };
  }

  if (FOREIGN_WALLET_CODES.has(normalizedCode)) {
    const provider = FOREIGN_PROVIDER_BY_CODE[normalizedCode as keyof typeof FOREIGN_PROVIDER_BY_CODE];
    return {
      code,
      requestFlow: 'widget',
      requiresOverseasDisclaimer: true,
      paymentMethod: {
        method: 'FOREIGN_EASY_PAY',
        provider,
        currency: 'USD',
        ...(provider === 'PAYPAL' ? {} : { pendingUrlRequired: true }),
        overseasPaymentConsent: createOverseasConsent(),
      },
    };
  }

  if (
    (normalizedCode === 'OVERSEAS_CARD' && isForeignPaymentWidgetVariant(variantKey))
    || OVERSEAS_CARD_CODES.has(normalizedCode)
  ) {
    return {
      code,
      requestFlow: 'direct_card',
      requiresOverseasDisclaimer: true,
      paymentMethod: {
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        overseasPaymentConsent: createOverseasConsent(),
      },
    };
  }

  if (code in SIMPLE_PAY_PROVIDER_BY_CODE) {
    return {
      code,
      requestFlow: 'widget',
      requiresOverseasDisclaimer: false,
      paymentMethod: {
        method: 'SIMPLE_PAY',
        provider: SIMPLE_PAY_PROVIDER_BY_CODE[code as keyof typeof SIMPLE_PAY_PROVIDER_BY_CODE],
        currency: 'KRW',
      },
    };
  }

  return {
    code,
    requestFlow: 'widget',
    requiresOverseasDisclaimer: false,
    paymentMethod: {
      method: 'CARD',
      provider: 'CARD',
      currency: 'KRW',
    },
  };
}

export function resolvePaymentRequestAmount({
  amount,
  currency,
  providerChargeQuote,
}: {
  amount: number;
  currency: string;
  providerChargeQuote?: ProviderChargeQuote;
}): { currency: string; value: number } {
  if (providerChargeQuote) {
    return {
      currency: providerChargeQuote.currency,
      value: providerChargeQuote.amountMinor / 100,
    };
  }

  return {
    currency,
    value: amount,
  };
}

function resolveInitialPaymentMethodSelection(variantKey: string): PaymentMethodSelection {
  return isAlipayPaymentWidgetVariant(variantKey)
    ? resolvePaymentMethodSelection('ALIPAY', variantKey)
    : resolvePaymentMethodSelection('CARD', variantKey);
}

function buildProviderChargeProducts({
  selectedSeats,
  providerChargeQuote,
}: {
  selectedSeats: FloorAwareSeatSelection[];
  providerChargeQuote: ProviderChargeQuote;
}): NonNullable<WidgetPaymentRequestPayload['foreignEasyPay']>['products'] {
  const totalKrw = selectedSeats.reduce((sum, seat) => sum + seat.price, 0)
    + selectedSeats.length * TICKET_SERVICE_FEE_KRW;
  let allocatedMinor = 0;
  const ticketProducts = selectedSeats.map((seat) => {
    const unitAmountMinor = Math.floor((providerChargeQuote.amountMinor * seat.price) / totalKrw);
    allocatedMinor += unitAmountMinor;

    return {
      name: `${seat.tierName} ${seat.row}열 ${seat.number}번`,
      quantity: 1,
      unitAmount: unitAmountMinor / 100,
      currency: providerChargeQuote.currency,
      description: `${seat.floorLabel} ${seat.row}열 ${seat.number}번`,
    };
  });

  return [
    ...ticketProducts,
    {
      name: 'Service fee / rounding adjustment',
      quantity: 1,
      unitAmount: (providerChargeQuote.amountMinor - allocatedMinor) / 100,
      currency: providerChargeQuote.currency,
      description: 'Service fee / rounding adjustment',
    },
  ];
}

export function buildWidgetPaymentRequest({
  branch,
  amount,
  customerEmail,
  customerName,
  customerMobilePhone,
  orderName,
  locale,
  selectedSeats = [],
}: {
  branch: TossPaymentBranchResponse;
  amount: number;
  customerEmail: string;
  customerName: string;
  customerMobilePhone?: string;
  orderName: string;
  locale: string;
  selectedSeats?: FloorAwareSeatSelection[];
}): WidgetPaymentRequestPayload {
  const resolvedLocale = resolvePaymentWidgetLocale(locale);
  const baseRequest: WidgetPaymentRequestPayload = {
    orderId: branch.orderId,
    orderName,
    successUrl: branch.successUrl,
    failUrl: branch.failUrl,
    customerEmail,
    customerName,
    customerMobilePhone: sanitizePhoneNumber(customerMobilePhone),
  };

  if (branch.pendingUrl) {
    baseRequest.pendingUrl = branch.pendingUrl;
  }

  if (branch.method === 'FOREIGN_EASY_PAY') {
    const products = branch.providerChargeQuote
      ? buildProviderChargeProducts({
          selectedSeats,
          providerChargeQuote: branch.providerChargeQuote,
        })
      : [
          {
            name: orderName,
            quantity: 1,
            unitAmount: amount,
            currency: branch.currency,
            description: orderName,
          },
        ];

    return {
      ...baseRequest,
      foreignEasyPay: {
        country: LOCALE_TO_COUNTRY[resolvedLocale],
        products,
      },
    };
  }

  return baseRequest;
}

export function buildDirectCardPaymentRequest({
  branch,
  amount,
  customerEmail,
  customerName,
  customerMobilePhone,
  orderName,
}: {
  branch: TossPaymentBranchResponse;
  amount: number;
  customerEmail: string;
  customerName: string;
  customerMobilePhone?: string;
  orderName: string;
}): DirectCardPaymentRequestPayload {
  return {
    method: 'CARD',
    amount: {
      currency: 'KRW',
      value: amount,
    },
    orderId: branch.orderId,
    orderName,
    successUrl: branch.successUrl,
    failUrl: branch.failUrl,
    customerEmail,
    customerName,
    customerMobilePhone: sanitizePhoneNumber(customerMobilePhone),
    card: {
      useInternationalCardOnly: true,
    },
  };
}

export const TossPaymentWidget = forwardRef<TossPaymentWidgetRef, TossPaymentWidgetProps>(
  function TossPaymentWidget(
    {
      orderId,
      orderName,
      amount,
      performanceId,
      customerKey,
      customerName,
      customerEmail,
      customerMobilePhone,
      selectedSeats,
      onReady,
      onPaymentMethodChange,
      onWidgetAgreementChange,
    },
    ref,
  ) {
    const locale = resolvePaymentWidgetLocale(useLocale());
    const paymentWidgetVariantKeys = resolvePaymentWidgetVariantKeys();
    const [paymentWidgetVariantKey, setPaymentWidgetVariantKey] = useState(
      paymentWidgetVariantKeys[0] ?? 'DEFAULT',
    );
    const [widgets, setWidgets] = useState<TossPaymentsWidgets | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [foreignEasyPayCode, setForeignEasyPayCode] = useState<string | null>(null);
    const paymentWidgetClientKey = resolvePaymentWidgetClientKey(paymentWidgetVariantKey);
    const selectedPaymentMethodRef = useRef<PaymentMethodSelection>(
      resolveInitialPaymentMethodSelection(paymentWidgetVariantKey),
    );

    const updateSelectedPaymentMethod = useCallback((selection: SelectedWidgetPaymentMethod) => {
      const normalized = isAlipayPaymentWidgetVariant(paymentWidgetVariantKey)
        ? resolvePaymentMethodSelection('ALIPAY', paymentWidgetVariantKey)
        : resolvePaymentMethodSelection(selection.code, paymentWidgetVariantKey);
      setForeignEasyPayCode(
        normalized.paymentMethod.provider === 'ALIPAY_PLUS' ? 'ALIPAY' : null,
      );
      selectedPaymentMethodRef.current = normalized;
      onPaymentMethodChange?.(normalized);
    }, [onPaymentMethodChange, paymentWidgetVariantKey]);

    const selectAlipay = useCallback(() => {
      const normalized = resolvePaymentMethodSelection('ALIPAY', paymentWidgetVariantKey);
      setForeignEasyPayCode('ALIPAY');
      selectedPaymentMethodRef.current = normalized;
      onPaymentMethodChange?.(normalized);
    }, [onPaymentMethodChange, paymentWidgetVariantKey]);

    const updateWidgetAgreement = useCallback((status: WidgetAgreementStatus) => {
      onWidgetAgreementChange?.(status.agreedRequiredTerms);
    }, [onWidgetAgreementChange]);

    const changePaymentWidgetVariant = useCallback((variantKey: string) => {
      setPaymentWidgetVariantKey(variantKey);
      const normalized = resolveInitialPaymentMethodSelection(variantKey);
      setForeignEasyPayCode(
        isAlipayPaymentWidgetVariant(variantKey) ? 'ALIPAY' : null,
      );
      onWidgetAgreementChange?.(false);
      selectedPaymentMethodRef.current = normalized;
      onPaymentMethodChange?.(normalized);
    }, [onPaymentMethodChange, onWidgetAgreementChange]);

    useImperativeHandle(ref, () => ({
      requestPayment: async (prepareResult) => {
        const origin = window.location.origin;
        const selection = selectedPaymentMethodRef.current;
        if (selection.requestFlow === 'widget') {
          if (!widgets) {
            throw new Error('결제 위젯이 초기화되지 않았습니다');
          }
          if (isLoading) {
            throw new Error('결제 위젯을 불러오는 중입니다');
          }
        }

        const requiresProviderChargeQuote = usesProviderChargeQuoteForPaymentMethod(
          selection.paymentMethod,
        );
        const providerChargeQuote = requiresProviderChargeQuote
          ? prepareResult?.providerChargeQuote
          : undefined;
        if (
          requiresProviderChargeQuote
          && (prepareResult?.checkoutEnabled !== true || !providerChargeQuote)
        ) {
          throw new Error(resolveProviderChargeDisabledMessage(
            selection.paymentMethod.provider,
            prepareResult?.disabledReason,
          ));
        }

        const pendingUrl = selection.paymentMethod.pendingUrlRequired
          ? `${origin}/booking/${performanceId}/complete?pending=true&orderId=${encodeURIComponent(orderId)}&provider=${selection.paymentMethod.provider}`
          : undefined;

        const branchPaymentMethod = prepareResult?.paymentMethod ?? selection.paymentMethod;
        const branch = await apiClient.post<TossPaymentBranchResponse>('/api/v1/payments/branch', {
          orderId,
          paymentMethod: branchPaymentMethod,
          successUrl: `${origin}/booking/${performanceId}/complete`,
          failUrl: `${origin}/booking/${performanceId}/confirm?error=true`,
          pendingUrl,
        }, {
          showErrorToast: false,
        });
        if (
          requiresProviderChargeQuote
          && (branch.checkoutEnabled !== true || !branch.providerChargeQuote)
        ) {
          throw new Error(resolveProviderChargeDisabledMessage(
            selection.paymentMethod.provider,
            branch.disabledReason,
          ));
        }

        if (selection.requestFlow === 'direct_card') {
          if (!branch.useInternationalCardOnly) {
            throw new Error('해외카드 결제 설정이 올바르지 않습니다.');
          }
          const overseasCardClientKey =
            process.env.NEXT_PUBLIC_TOSS_OVERSEAS_CARD_CLIENT_KEY
            || process.env.NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY;
          if (!overseasCardClientKey) {
            throw new Error('해외카드 결제 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.');
          }

          const successUrl = new URL(branch.successUrl);
          successUrl.searchParams.set('provider', 'OVERSEAS_CARD');
          const directCardBranch = {
            ...branch,
            successUrl: successUrl.toString(),
          };
          const directCardPayload = buildDirectCardPaymentRequest({
            branch: directCardBranch,
            amount,
            customerEmail,
            customerName,
            customerMobilePhone,
            orderName,
          });
          const tossPayments = await loadTossPayments(overseasCardClientKey);
          const payment = tossPayments.payment({ customerKey });
          await payment.requestPayment(
            directCardPayload as unknown as Parameters<TossPaymentsPayment['requestPayment']>[0],
          );
          return;
        }

        if (!widgets) {
          throw new Error('결제 위젯이 초기화되지 않았습니다');
        }

        const requestPayload = buildWidgetPaymentRequest({
          branch,
          amount,
          customerEmail,
          customerName,
          customerMobilePhone,
          orderName,
          locale,
          selectedSeats,
        });
        if (selection.paymentMethod.provider === 'PAYPAL' && branch.providerChargeQuote) {
          const url = new URL(requestPayload.successUrl);
          url.searchParams.set('provider', 'PAYPAL');
          url.searchParams.set('providerChargeAmount', branch.providerChargeQuote.amountDecimal);
          requestPayload.successUrl = url.toString();
        } else if (
          selection.paymentMethod.provider === 'CARD'
          && branch.useInternationalCardOnly
          && branch.providerChargeQuote
        ) {
          const url = new URL(requestPayload.successUrl);
          url.searchParams.set('provider', 'OVERSEAS_CARD');
          url.searchParams.set('providerChargeAmount', branch.providerChargeQuote.amountDecimal);
          requestPayload.successUrl = url.toString();
        }

        await widgets.requestPayment(
          requestPayload as Parameters<TossPaymentsWidgets['requestPayment']>[0],
        );
      },
    }), [
      widgets,
      performanceId,
      orderId,
      amount,
      customerEmail,
      customerName,
      customerMobilePhone,
      orderName,
      locale,
      isLoading,
      selectedSeats,
      customerKey,
    ]);

    const showForeignEasyPayButtons = isAlipayPaymentWidgetVariant(paymentWidgetVariantKey);

    useEffect(() => {
      let mounted = true;
      async function init() {
        try {
          setWidgets(null);
          setIsLoading(true);
          setError(null);
          onWidgetAgreementChange?.(false);

          if (!paymentWidgetClientKey) {
            setError('결제 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.');
            setIsLoading(false);
            return;
          }

          const tossPayments = await loadTossPayments(paymentWidgetClientKey);
          const w = tossPayments.widgets({ customerKey });
          if (!mounted) {
            return;
          }
          setWidgets(w);
        } catch (err) {
          console.error('Toss Payments SDK 초기화 실패:', err);
          if (!mounted) {
            return;
          }
          setError('결제 시스템 로딩에 실패했습니다. 페이지를 새로고침해주세요.');
          setIsLoading(false);
        }
      }

      init();
      return () => {
        mounted = false;
      };
    }, [
      customerKey,
      onPaymentMethodChange,
      onReady,
      onWidgetAgreementChange,
      paymentWidgetClientKey,
    ]);

    useEffect(() => {
      if (!widgets) return;
      const activeWidgets = widgets;

      let mounted = true;
      let paymentWidgetInstance: PaymentMethodWidget | null = null;
      let agreementWidgetInstance: AgreementWidget | null = null;

      async function render() {
        try {
          setIsLoading(true);
          setError(null);

          const renderAmount = resolvePaymentWidgetRenderAmount({
            amount,
            variantKey: paymentWidgetVariantKey,
          });
          await activeWidgets.setAmount(renderAmount);

          const [paymentMethodWidget, agreementWidget] = await Promise.all([
            activeWidgets.renderPaymentMethods({
              selector: '#payment-method',
              variantKey: resolvePaymentWidgetRenderVariantKey(paymentWidgetVariantKey),
            }),
            activeWidgets.renderAgreement({
              selector: '#agreement',
              variantKey: 'AGREEMENT',
            }),
          ]);

          paymentWidgetInstance = paymentMethodWidget;
          agreementWidgetInstance = agreementWidget;
          paymentMethodWidget.on('paymentMethodSelect', updateSelectedPaymentMethod);
          agreementWidget.on('agreementStatusChange', updateWidgetAgreement);
          const selectedPaymentMethod = await paymentMethodWidget.getSelectedPaymentMethod();
          updateSelectedPaymentMethod(selectedPaymentMethod);

          if (!mounted) {
            return;
          }

          setIsLoading(false);
          onReady();
        } catch (err) {
          console.error('결제 위젯 렌더링 실패:', err);
          if (!mounted) {
            return;
          }
          setError('결제 위젯을 불러오는데 실패했습니다.');
          setIsLoading(false);
        }
      }

      render();

      return () => {
        mounted = false;
        void paymentWidgetInstance?.destroy();
        void agreementWidgetInstance?.destroy();
      };
    }, [
      widgets,
      amount,
      onReady,
      updateSelectedPaymentMethod,
      updateWidgetAgreement,
      paymentWidgetVariantKey,
    ]);

    if (error) {
      return (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {paymentWidgetVariantKeys.length > 1 && (
          <div
            role="tablist"
            aria-label="결제 UI"
            className="grid gap-2 rounded-lg bg-gray-100 p-1"
            style={{
              gridTemplateColumns: `repeat(${paymentWidgetVariantKeys.length}, minmax(0, 1fr))`,
            }}
          >
            {paymentWidgetVariantKeys.map((variantKey) => {
              const selected = paymentWidgetVariantKey === variantKey;
              return (
                <button
                  key={variantKey}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`h-10 rounded-md px-3 text-sm font-semibold transition ${
                    selected
                      ? 'bg-white text-gray-950 shadow-sm'
                      : 'text-gray-600 hover:text-gray-950'
                  }`}
                  onClick={() => changePaymentWidgetVariant(variantKey)}
                >
                  {resolvePaymentWidgetVariantLabel(variantKey)}
                </button>
              );
            })}
          </div>
        )}
        {isLoading && (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        )}
        <div
          id="payment-method"
          aria-label="결제 수단 선택"
          className={isLoading ? 'hidden' : ''}
        />
        {showForeignEasyPayButtons && (
          <div className={`grid gap-2 ${isLoading ? 'hidden' : ''}`}>
            <button
              type="button"
              aria-pressed={foreignEasyPayCode === 'ALIPAY'}
              className={`flex h-12 w-full items-center justify-between rounded-lg border px-4 text-left text-sm font-semibold transition ${
                foreignEasyPayCode === 'ALIPAY'
                  ? 'border-gray-950 bg-gray-950 text-white'
                  : 'border-gray-200 bg-white text-gray-900 hover:border-gray-400'
              }`}
              disabled={isLoading}
              onClick={selectAlipay}
            >
              <span>Alipay</span>
              <span className="text-xs font-medium opacity-70">USD</span>
            </button>
          </div>
        )}
        <div
          id="agreement"
          className={isLoading ? 'hidden' : ''}
        />
      </div>
    );
  },
);
