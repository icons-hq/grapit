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
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { TICKET_SERVICE_FEE_KRW } from '@grabit/shared';
import type {
  FloorAwareSeatSelection,
  PaymentMethod,
  PaymentProvider,
  PrepareReservationResponse,
  ProviderChargeQuote,
} from '@grabit/shared';

const OVERSEAS_PAYMENT_CONSENT_VERSION = '2026-05-08';
const USPAY_VARIANT_KEY = 'uspay';
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

interface PaymentWidgetState {
  variantKey: string;
  widgets: TossPaymentsWidgets;
}

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
  resumeOrderId?: string;
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
  windowTarget: 'self';
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
    currency: 'KRW' | 'USD';
    value: number;
  };
  orderId: string;
  orderName: string;
  successUrl: string;
  failUrl: string;
  windowTarget: 'self';
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
    .filter((variantKey) => (
      variantKey.length > 0
      && variantKey.toLowerCase() !== 'alipay'
    ));

  return variantKeys.length > 0 ? [...new Set(variantKeys)] : ['DEFAULT'];
}

export function resolvePaymentWidgetRenderVariantKey(variantKey: string): string {
  const trimmedVariantKey = variantKey.trim();
  return trimmedVariantKey.length > 0 ? trimmedVariantKey : 'DEFAULT';
}

export function resolvePaymentWidgetClientKey(variantKey: string): string | undefined {
  if (isUsPayPaymentWidgetVariant(variantKey)) {
    return process.env.NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY
      || process.env.NEXT_PUBLIC_TOSS_FOREIGN_PAYMENT_WIDGET_CLIENT_KEY
      || process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  }
  return process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
}

export function resolveOverseasCardClientKey(): string | undefined {
  const clientKey = process.env.NEXT_PUBLIC_TOSS_OVERSEAS_CARD_CLIENT_KEY?.trim();
  if (!clientKey || !/^(test|live)_ck_/.test(clientKey)) {
    return undefined;
  }
  return clientKey;
}

export function isUsPayPaymentWidgetVariant(variantKey: string): boolean {
  return variantKey.toLowerCase() === USPAY_VARIANT_KEY;
}

export function isForeignPaymentWidgetVariant(variantKey: string): boolean {
  return isUsPayPaymentWidgetVariant(variantKey);
}

export function resolvePaymentWidgetVariantLabel(variantKey: string): string {
  return resolvePaymentWidgetVariantLabelForLocale(variantKey, 'ko');
}

export function resolvePaymentWidgetVariantLabelForLocale(
  variantKey: string,
  locale: string | undefined,
): string {
  const copy = getVisibleCopy(locale).bookingExtra.widget;
  if (isForeignPaymentWidgetVariant(variantKey)) {
    return copy.overseasTab;
  }
  return copy.domesticTab;
}

export function resolvePaymentWidgetRenderAmount({
  amount,
  variantKey,
}: {
  amount: number;
  variantKey: string;
}): { currency: 'KRW' | 'USD'; value: number } {
  if (isUsPayPaymentWidgetVariant(variantKey)) {
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
  return usesProviderChargeQuote(paymentMethod.provider);
}

export function resolveProviderChargeDisabledMessage(
  provider: PaymentProvider,
  disabledReason?: string,
  locale?: string,
): string {
  const copy = getVisibleCopy(locale).bookingExtra.widget;
  if (provider === 'ALIPAY_PLUS') {
    return copy.alipayDisabled;
  }
  if (provider === 'PAYPAL') {
    return copy.paypalDisabled;
  }
  if (provider === 'CARD') {
    return copy.overseasCardDisabled;
  }
  return disabledReason ?? copy.foreignPaymentDisabled;
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

function resolveInitialPaymentMethodSelection(_variantKey: string): PaymentMethodSelection {
  return resolvePaymentMethodSelection('CARD', _variantKey);
}

function formatWidgetTemplate(template: string, values: object) {
  const record = values as Record<string, unknown>;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(record[key] ?? ''),
  );
}

function buildProviderChargeProducts({
  selectedSeats,
  providerChargeQuote,
  locale,
}: {
  selectedSeats: FloorAwareSeatSelection[];
  providerChargeQuote: ProviderChargeQuote;
  locale: string;
}): NonNullable<WidgetPaymentRequestPayload['foreignEasyPay']>['products'] {
  const totalKrw = selectedSeats.reduce((sum, seat) => sum + seat.price, 0)
    + selectedSeats.length * TICKET_SERVICE_FEE_KRW;
  let allocatedMinor = 0;
  const seatTemplate = getVisibleCopy(locale).reservation.detail.seatLabel;
  const ticketProducts = selectedSeats.map((seat) => {
    const unitAmountMinor = Math.floor((providerChargeQuote.amountMinor * seat.price) / totalKrw);
    allocatedMinor += unitAmountMinor;
    const seatLabel = formatWidgetTemplate(seatTemplate, seat);

    return {
      name: seatLabel,
      quantity: 1,
      unitAmount: unitAmountMinor / 100,
      currency: providerChargeQuote.currency,
      description: seat.floorLabel ? `${seat.floorLabel} ${seatLabel}` : seatLabel,
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
    windowTarget: 'self',
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
          locale,
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
  locale,
}: {
  branch: TossPaymentBranchResponse;
  amount: number;
  customerEmail: string;
  customerName: string;
  customerMobilePhone?: string;
  orderName: string;
  locale?: string;
}): DirectCardPaymentRequestPayload {
  const providerChargeQuote = branch.providerChargeQuote;
  const chargeCurrency = providerChargeQuote?.currency ?? 'KRW';
  const chargeValue = providerChargeQuote
    ? providerChargeQuote.amountMinor / 100
    : amount;
  const successUrl = new URL(branch.successUrl);
  successUrl.searchParams.set('provider', 'OVERSEAS_CARD');
  if (providerChargeQuote) {
    successUrl.searchParams.set(
      'providerChargeAmount',
      providerChargeQuote.amountDecimal,
    );
  }

  return {
    method: 'CARD',
    amount: {
      currency: chargeCurrency,
      value: chargeValue,
    },
    orderId: branch.orderId,
    orderName,
    successUrl: successUrl.toString(),
    failUrl: branch.failUrl,
    windowTarget: 'self',
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
      resumeOrderId,
      onReady,
      onPaymentMethodChange,
      onWidgetAgreementChange,
    },
    ref,
  ) {
    const locale = resolvePaymentWidgetLocale(useLocale());
    const widgetCopy = getVisibleCopy(locale).bookingExtra.widget;
    const paymentWidgetVariantKeys = resolvePaymentWidgetVariantKeys();
    const [paymentWidgetVariantKey, setPaymentWidgetVariantKey] = useState(
      paymentWidgetVariantKeys[0] ?? 'DEFAULT',
    );
    const [widgetState, setWidgetState] = useState<PaymentWidgetState | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const paymentWidgetClientKey = resolvePaymentWidgetClientKey(paymentWidgetVariantKey);
    const widgets = widgetState?.variantKey === paymentWidgetVariantKey
      ? widgetState.widgets
      : null;
    const selectedPaymentMethodRef = useRef<PaymentMethodSelection>(
      resolveInitialPaymentMethodSelection(paymentWidgetVariantKey),
    );
    const paymentWidgetInstanceRef = useRef<PaymentMethodWidget | null>(null);
    const agreementWidgetInstanceRef = useRef<AgreementWidget | null>(null);
    const widgetDestroyPromiseRef = useRef<Promise<void> | null>(null);
    const shouldRenderPaymentWidgets = true;

    const destroyWidgetInstance = useCallback(async (
      instance: PaymentMethodWidget | AgreementWidget | null | undefined,
    ) => {
      try {
        await instance?.destroy();
      } catch {
        // Toss widgets can already be torn down during rapid variant switches.
      }
    }, []);

    const updateSelectedPaymentMethod = useCallback((selection: SelectedWidgetPaymentMethod) => {
      const normalized = resolvePaymentMethodSelection(selection.code, paymentWidgetVariantKey);
      selectedPaymentMethodRef.current = normalized;
      onPaymentMethodChange?.(normalized);
    }, [onPaymentMethodChange, paymentWidgetVariantKey]);

    const updateWidgetAgreement = useCallback((status: WidgetAgreementStatus) => {
      onWidgetAgreementChange?.(status.agreedRequiredTerms);
    }, [onWidgetAgreementChange]);

    const destroyRenderedWidgets = useCallback(async () => {
      if (widgetDestroyPromiseRef.current) {
        await widgetDestroyPromiseRef.current;
      }

      const previousPaymentWidget = paymentWidgetInstanceRef.current;
      const previousAgreementWidget = agreementWidgetInstanceRef.current;
      paymentWidgetInstanceRef.current = null;
      agreementWidgetInstanceRef.current = null;

      const destroyPromise = Promise.all([
        destroyWidgetInstance(previousPaymentWidget),
        destroyWidgetInstance(previousAgreementWidget),
      ]).then(() => undefined);

      widgetDestroyPromiseRef.current = destroyPromise;
      await destroyPromise;
      if (widgetDestroyPromiseRef.current === destroyPromise) {
        widgetDestroyPromiseRef.current = null;
      }
    }, [destroyWidgetInstance]);

    const changePaymentWidgetVariant = useCallback((variantKey: string) => {
      setWidgetState(null);
      setPaymentWidgetVariantKey(variantKey);
      const normalized = resolveInitialPaymentMethodSelection(variantKey);
      onWidgetAgreementChange?.(false);
      selectedPaymentMethodRef.current = normalized;
      onPaymentMethodChange?.(normalized);
    }, [onPaymentMethodChange, onWidgetAgreementChange]);

    useImperativeHandle(ref, () => ({
      requestPayment: async (prepareResult) => {
        const origin = window.location.origin;
        const localizedBookingPath = getLocalizedPathname(
          `/booking/${performanceId}`,
          locale,
        );
        const completeUrl = `${origin}${localizedBookingPath}/complete`;
        const confirmUrl = `${origin}${localizedBookingPath}/confirm`;
        const selection = selectedPaymentMethodRef.current;
        if (selection.requestFlow === 'widget') {
          if (!widgets) {
            throw new Error(widgetCopy.widgetNotReady);
          }
          if (isLoading) {
            throw new Error(widgetCopy.widgetLoading);
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
            locale,
          ));
        }

        const pendingUrl = selection.paymentMethod.pendingUrlRequired
          ? `${completeUrl}?pending=true&orderId=${encodeURIComponent(orderId)}&provider=${selection.paymentMethod.provider}`
          : undefined;

        const failUrl = new URL(confirmUrl);
        failUrl.searchParams.set('error', 'true');
        if (resumeOrderId) {
          failUrl.searchParams.set('resumeOrderId', resumeOrderId);
        }
        const branchPaymentMethod = prepareResult?.paymentMethod ?? selection.paymentMethod;
        const branch = await apiClient.post<TossPaymentBranchResponse>('/api/v1/payments/branch', {
          orderId,
          paymentMethod: branchPaymentMethod,
          successUrl: completeUrl,
          failUrl: failUrl.toString(),
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
            locale,
          ));
        }

        if (selection.requestFlow === 'direct_card') {
          if (!branch.useInternationalCardOnly) {
            throw new Error(widgetCopy.overseasCardInvalidSetup);
          }
          if (branch.checkoutEnabled === false) {
            throw new Error(resolveProviderChargeDisabledMessage(
              selection.paymentMethod.provider,
              branch.disabledReason,
              locale,
            ));
          }
          const overseasCardClientKey = resolveOverseasCardClientKey();
          if (!overseasCardClientKey) {
            throw new Error(widgetCopy.overseasCardDisabled);
          }

          const directCardPayload = buildDirectCardPaymentRequest({
            branch,
            amount,
            customerEmail,
            customerName,
            customerMobilePhone,
            orderName,
            locale,
          });
          const tossPayments = await loadTossPayments(overseasCardClientKey);
          const payment = tossPayments.payment({ customerKey });
          await payment.requestPayment(
            directCardPayload as unknown as Parameters<TossPaymentsPayment['requestPayment']>[0],
          );
          return;
        }

        if (!widgets) {
          throw new Error(widgetCopy.widgetNotReady);
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
      resumeOrderId,
      widgetCopy,
    ]);

    useEffect(() => {
      let mounted = true;
      async function init() {
        try {
          setWidgetState(null);
          await destroyRenderedWidgets();
          setIsLoading(true);
          setError(null);
          onWidgetAgreementChange?.(false);

          if (!paymentWidgetClientKey) {
            setError(widgetCopy.setupIncomplete);
            setIsLoading(false);
            return;
          }

          const tossPayments = await loadTossPayments(paymentWidgetClientKey);
          const w = tossPayments.widgets({ customerKey });
          if (!mounted) {
            return;
          }
          setWidgetState({ widgets: w, variantKey: paymentWidgetVariantKey });
        } catch (err) {
          console.error(widgetCopy.sdkInitLog, err);
          if (!mounted) {
            return;
          }
          setError(widgetCopy.systemLoadFailed);
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
      paymentWidgetVariantKey,
      shouldRenderPaymentWidgets,
      destroyRenderedWidgets,
      widgetCopy,
    ]);

    useEffect(() => {
      if (!shouldRenderPaymentWidgets) return;
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

          await destroyRenderedWidgets();
          document.getElementById('payment-method')?.replaceChildren();
          document.getElementById('agreement')?.replaceChildren();

          const paymentMethodWidget = await activeWidgets.renderPaymentMethods({
            selector: '#payment-method',
            variantKey: resolvePaymentWidgetRenderVariantKey(paymentWidgetVariantKey),
          });
          const agreementWidget = await activeWidgets.renderAgreement({
            selector: '#agreement',
            variantKey: 'AGREEMENT',
          });

          paymentWidgetInstance = paymentMethodWidget;
          agreementWidgetInstance = agreementWidget;
          paymentWidgetInstanceRef.current = paymentMethodWidget;
          agreementWidgetInstanceRef.current = agreementWidget;
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
          console.error(widgetCopy.widgetRenderLog, err);
          if (!mounted) {
            return;
          }
          setError(widgetCopy.widgetLoadFailed);
          setIsLoading(false);
        }
      }

      render();

      return () => {
        mounted = false;
        if (paymentWidgetInstanceRef.current === paymentWidgetInstance) {
          paymentWidgetInstanceRef.current = null;
        }
        if (agreementWidgetInstanceRef.current === agreementWidgetInstance) {
          agreementWidgetInstanceRef.current = null;
        }
        const destroyPromise = Promise.all([
          destroyWidgetInstance(paymentWidgetInstance),
          destroyWidgetInstance(agreementWidgetInstance),
        ]).then(() => undefined);
        widgetDestroyPromiseRef.current = destroyPromise;
        void destroyPromise.finally(() => {
          if (widgetDestroyPromiseRef.current === destroyPromise) {
            widgetDestroyPromiseRef.current = null;
          }
        });
      };
    }, [
      widgets,
      amount,
      onReady,
      updateSelectedPaymentMethod,
      updateWidgetAgreement,
      paymentWidgetVariantKey,
      shouldRenderPaymentWidgets,
      destroyRenderedWidgets,
      destroyWidgetInstance,
      widgetCopy,
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
            aria-label={widgetCopy.paymentUiAria}
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
                  {resolvePaymentWidgetVariantLabelForLocale(variantKey, locale)}
                </button>
              );
            })}
          </div>
        )}
        {shouldRenderPaymentWidgets && isLoading && (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        )}
        {shouldRenderPaymentWidgets && (
          <div
            id="payment-method"
            aria-label={widgetCopy.paymentMethodAria}
            className={isLoading ? 'hidden' : ''}
          />
        )}
        {shouldRenderPaymentWidgets && (
          <div
            id="agreement"
            className={isLoading ? 'hidden' : ''}
          />
        )}
      </div>
    );
  },
);
