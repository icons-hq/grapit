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
import { loadTossPayments, type TossPaymentsWidgets } from '@tosspayments/tosspayments-sdk';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import type { PaymentMethod, PaymentProvider } from '@grabit/shared';

const OVERSEAS_PAYMENT_CONSENT_VERSION = '2026-05-08';
const FOREIGN_WALLET_CODES = new Set(['ALIPAY', 'TRUEMONEY']);
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
  TRUEMONEY: 'TRUEMONEY',
} as const satisfies Record<string, PaymentProvider>;

const LOCALE_TO_COUNTRY = {
  ko: 'KR',
  en: 'US',
  th: 'TH',
  'zh-CN': 'CN',
} as const;
type PaymentWidgetLocale = keyof typeof LOCALE_TO_COUNTRY;

type PaymentMethodWidget = Awaited<ReturnType<TossPaymentsWidgets['renderPaymentMethods']>>;
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
  onReady: () => void;
  onPaymentMethodChange?: (selection: PaymentMethodSelection) => void;
}

export interface TossPaymentWidgetRef {
  requestPayment: () => Promise<void>;
}

export interface PaymentMethodSelection {
  code: string;
  paymentMethod: PaymentMethod;
  requiresOverseasDisclaimer: boolean;
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

function sanitizePhoneNumber(phone: string | undefined): string | undefined {
  if (!phone) {
    return undefined;
  }

  const normalized = phone.replace(/\D/g, '');
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

export function resolvePaymentMethodSelection(code: string): PaymentMethodSelection {
  if (FOREIGN_WALLET_CODES.has(code)) {
    return {
      code,
      requiresOverseasDisclaimer: true,
      paymentMethod: {
        method: 'FOREIGN_EASY_PAY',
        provider: FOREIGN_PROVIDER_BY_CODE[code as keyof typeof FOREIGN_PROVIDER_BY_CODE],
        currency: 'USD',
        pendingUrlRequired: true,
        overseasPaymentConsent: createOverseasConsent(),
      },
    };
  }

  if (OVERSEAS_CARD_CODES.has(code)) {
    return {
      code,
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
    requiresOverseasDisclaimer: false,
    paymentMethod: {
      method: 'CARD',
      provider: 'CARD',
      currency: 'KRW',
    },
  };
}

export function buildWidgetPaymentRequest({
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
  locale: string;
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
    return {
      ...baseRequest,
      foreignEasyPay: {
        country: LOCALE_TO_COUNTRY[resolvedLocale],
        products: [
          {
            name: orderName,
            quantity: 1,
            unitAmount: amount,
            currency: branch.currency,
            description: orderName,
          },
        ],
      },
    };
  }

  if (branch.method === 'CARD' && branch.useInternationalCardOnly) {
    return {
      ...baseRequest,
      card: {
        useInternationalCardOnly: true,
      },
    };
  }

  return baseRequest;
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
      onReady,
      onPaymentMethodChange,
    },
    ref,
  ) {
    const locale = resolvePaymentWidgetLocale(useLocale());
    const [widgets, setWidgets] = useState<TossPaymentsWidgets | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const readyRef = useRef(false);
    const initRef = useRef(false);
    const selectedPaymentMethodRef = useRef<PaymentMethodSelection>(resolvePaymentMethodSelection('CARD'));

    const updateSelectedPaymentMethod = useCallback((selection: SelectedWidgetPaymentMethod) => {
      const normalized = resolvePaymentMethodSelection(selection.code);
      selectedPaymentMethodRef.current = normalized;
      onPaymentMethodChange?.(normalized);
    }, [onPaymentMethodChange]);

    useImperativeHandle(ref, () => ({
      requestPayment: async () => {
        if (!widgets) {
          throw new Error('결제 위젯이 초기화되지 않았습니다');
        }

        const origin = window.location.origin;
        const selection = selectedPaymentMethodRef.current;
        const pendingUrl = selection.paymentMethod.pendingUrlRequired
          ? `${origin}/booking/${performanceId}/complete?pending=true&orderId=${encodeURIComponent(orderId)}&amount=${amount}`
          : undefined;

        const branch = await apiClient.post<TossPaymentBranchResponse>('/api/v1/payments/branch', {
          orderId,
          paymentMethod: selection.paymentMethod,
          successUrl: `${origin}/booking/${performanceId}/complete`,
          failUrl: `${origin}/booking/${performanceId}/confirm?error=true`,
          pendingUrl,
        }, {
          showErrorToast: false,
        });

        await widgets.setAmount({
          currency: branch.currency,
          value: amount,
        });

        const requestPayload = buildWidgetPaymentRequest({
          branch,
          amount,
          customerEmail,
          customerName,
          customerMobilePhone,
          orderName,
          locale,
        });

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
    ]);

    useEffect(() => {
      if (initRef.current) return;
      initRef.current = true;

      async function init() {
        try {
          const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
          if (!clientKey) {
            setError('결제 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.');
            setIsLoading(false);
            return;
          }

          const tossPayments = await loadTossPayments(clientKey);
          const w = tossPayments.widgets({ customerKey });
          setWidgets(w);
        } catch (err) {
          console.error('Toss Payments SDK 초기화 실패:', err);
          setError('결제 시스템 로딩에 실패했습니다. 페이지를 새로고침해주세요.');
          setIsLoading(false);
        }
      }

      init();
    }, [customerKey]);

    useEffect(() => {
      if (!widgets || readyRef.current) return;
      const activeWidgets = widgets;

      let mounted = true;
      let paymentWidgetInstance: PaymentMethodWidget | null = null;
      let agreementWidgetInstance: Awaited<ReturnType<TossPaymentsWidgets['renderAgreement']>> | null = null;

      async function render() {
        try {
          await activeWidgets.setAmount({ currency: 'KRW', value: amount });

          const [paymentMethodWidget, agreementWidget] = await Promise.all([
            activeWidgets.renderPaymentMethods({
              selector: '#payment-method',
              variantKey: 'DEFAULT',
            }),
            activeWidgets.renderAgreement({
              selector: '#agreement',
              variantKey: 'AGREEMENT',
            }),
          ]);

          paymentWidgetInstance = paymentMethodWidget;
          agreementWidgetInstance = agreementWidget;
          paymentMethodWidget.on('paymentMethodSelect', updateSelectedPaymentMethod);
          const selectedPaymentMethod = await paymentMethodWidget.getSelectedPaymentMethod();
          updateSelectedPaymentMethod(selectedPaymentMethod);

          if (!mounted) {
            return;
          }

          readyRef.current = true;
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
    }, [widgets, amount, onReady, updateSelectedPaymentMethod]);

    if (error) {
      return (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
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
        <div
          id="agreement"
          className={isLoading ? 'hidden' : ''}
        />
      </div>
    );
  },
);
