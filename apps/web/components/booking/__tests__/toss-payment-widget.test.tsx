import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { TossPaymentWidget, type TossPaymentWidgetRef } from '../toss-payment-widget';

const {
  apiClientPostMock,
  loadTossPaymentsMock,
  directPaymentRequestMock,
  widgetsFactoryMock,
  setAmountMock,
  renderPaymentMethodsMock,
  renderAgreementMock,
  getSelectedPaymentMethodMock,
  paymentMethodOnMock,
  agreementOnMock,
  paymentMethodDestroyMock,
  agreementDestroyMock,
} = vi.hoisted(() => ({
  apiClientPostMock: vi.fn(),
  loadTossPaymentsMock: vi.fn(),
  directPaymentRequestMock: vi.fn(),
  widgetsFactoryMock: vi.fn(),
  setAmountMock: vi.fn(),
  renderPaymentMethodsMock: vi.fn(),
  renderAgreementMock: vi.fn(),
  getSelectedPaymentMethodMock: vi.fn(),
  paymentMethodOnMock: vi.fn(),
  agreementOnMock: vi.fn(),
  paymentMethodDestroyMock: vi.fn(),
  agreementDestroyMock: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: apiClientPostMock,
  },
}));

vi.mock('@tosspayments/tosspayments-sdk', () => ({
  loadTossPayments: loadTossPaymentsMock,
}));

const originalClientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
const originalForeignEasyPayClientKey = process.env.NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY;
const originalOverseasCardClientKey = process.env.NEXT_PUBLIC_TOSS_OVERSEAS_CARD_CLIENT_KEY;
const originalVariantKey = process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY;

const defaultProps = {
  orderId: 'GRP-TEST-ORDER',
  orderName: '테스트 공연',
  amount: 50000,
  performanceId: 'performance-1',
  customerKey: 'customer-1',
  customerName: '테스트 사용자',
  customerEmail: 'test@example.com',
  customerMobilePhone: '01012345678',
  selectedSeats: [
    {
      seatId: 'A-1',
      tierName: 'VIP',
      tierColor: '#111111',
      row: 'A',
      number: '1',
      price: 50000,
      floorKey: '1F',
      floorLabel: '1층',
      seatKey: '1F:A-1',
    },
  ],
  onReady: vi.fn(),
  onPaymentMethodChange: vi.fn(),
  onWidgetAgreementChange: vi.fn(),
};

describe('TossPaymentWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY = 'test-client-key';
    process.env.NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY = 'test-foreign-widget-key';
    process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = 'DEFAULT, alipay';

    setAmountMock.mockResolvedValue(undefined);
    getSelectedPaymentMethodMock.mockResolvedValue({ code: 'CARD' });
    renderPaymentMethodsMock.mockResolvedValue({
      on: paymentMethodOnMock,
      getSelectedPaymentMethod: getSelectedPaymentMethodMock,
      destroy: paymentMethodDestroyMock,
    });
    renderAgreementMock.mockResolvedValue({
      on: agreementOnMock,
      destroy: agreementDestroyMock,
    });
    widgetsFactoryMock.mockReturnValue({
      setAmount: setAmountMock,
      renderPaymentMethods: renderPaymentMethodsMock,
      renderAgreement: renderAgreementMock,
    });
    loadTossPaymentsMock.mockImplementation(async (clientKey: string) => {
      if (clientKey === 'test_ck_direct_key') {
        return {
          payment: vi.fn(() => ({
            requestPayment: directPaymentRequestMock,
          })),
        };
      }

      return {
        widgets: widgetsFactoryMock,
      };
    });
    directPaymentRequestMock.mockResolvedValue(undefined);
    apiClientPostMock.mockResolvedValue({
      orderId: 'GRP-TEST-ORDER',
      method: 'CARD',
      provider: 'CARD',
      currency: 'KRW',
      successUrl: 'https://grabit.test/booking/performance-1/complete',
      failUrl: 'https://grabit.test/booking/performance-1/confirm?error=true',
      asyncStatus: 'sync',
      useInternationalCardOnly: true,
    });
  });

  afterEach(() => {
    if (originalClientKey === undefined) {
      delete process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
    } else {
      process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY = originalClientKey;
    }

    if (originalVariantKey === undefined) {
      delete process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY;
    } else {
      process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = originalVariantKey;
    }

    if (originalForeignEasyPayClientKey === undefined) {
      delete process.env.NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY;
    } else {
      process.env.NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY = originalForeignEasyPayClientKey;
    }

    if (originalOverseasCardClientKey === undefined) {
      delete process.env.NEXT_PUBLIC_TOSS_OVERSEAS_CARD_CLIENT_KEY;
    } else {
      process.env.NEXT_PUBLIC_TOSS_OVERSEAS_CARD_CLIENT_KEY = originalOverseasCardClientKey;
    }
  });

  it('filters the deprecated standalone Alipay variant out of the payment tabs', async () => {
    render(<TossPaymentWidget {...defaultProps} />);

    await waitFor(() => expect(renderPaymentMethodsMock).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole('tab', { name: 'Alipay' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Alipay\s+USD/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('결제 수단 선택')).toBeInTheDocument();
  });

  it('destroys the previous agreement widget before rendering a foreign widget variant', async () => {
    process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = 'DEFAULT,uspay';
    const user = userEvent.setup();
    render(<TossPaymentWidget {...defaultProps} />);

    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('tab', { name: '해외 결제' }));

    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(2));
    expect(paymentMethodDestroyMock).toHaveBeenCalled();
    expect(paymentMethodDestroyMock.mock.invocationCallOrder[0]).toBeLessThan(
      renderPaymentMethodsMock.mock.invocationCallOrder[1],
    );
    expect(agreementDestroyMock).toHaveBeenCalled();
    expect(agreementDestroyMock.mock.invocationCallOrder[0]).toBeLessThan(
      renderAgreementMock.mock.invocationCallOrder[1],
    );
    expect(screen.queryByText('결제 위젯을 불러오는데 실패했습니다.')).not.toBeInTheDocument();
  });

  it('does not render a foreign variant with the previous widgets instance', async () => {
    process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = 'DEFAULT,uspay';

    const firstRenderPaymentMethods = vi.fn().mockResolvedValue({
      on: vi.fn(),
      getSelectedPaymentMethod: vi.fn().mockResolvedValue({ code: 'CARD' }),
      destroy: vi.fn().mockResolvedValue(undefined),
    });
    const firstRenderAgreement = vi.fn().mockResolvedValue({
      on: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    });
    const secondRenderPaymentMethods = vi.fn().mockResolvedValue({
      on: vi.fn(),
      getSelectedPaymentMethod: vi.fn().mockResolvedValue({ code: 'CARD' }),
      destroy: vi.fn().mockResolvedValue(undefined),
    });
    const secondRenderAgreement = vi.fn().mockResolvedValue({
      on: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    });

    widgetsFactoryMock
      .mockReturnValueOnce({
        setAmount: vi.fn().mockResolvedValue(undefined),
        renderPaymentMethods: firstRenderPaymentMethods,
        renderAgreement: firstRenderAgreement,
      })
      .mockReturnValueOnce({
        setAmount: vi.fn().mockResolvedValue(undefined),
        renderPaymentMethods: secondRenderPaymentMethods,
        renderAgreement: secondRenderAgreement,
      });

    const user = userEvent.setup();
    render(<TossPaymentWidget {...defaultProps} />);

    await waitFor(() => expect(firstRenderAgreement).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('tab', { name: '해외 결제' }));

    await waitFor(() => expect(secondRenderAgreement).toHaveBeenCalledTimes(1));
    expect(firstRenderPaymentMethods).toHaveBeenCalledTimes(1);
    expect(firstRenderPaymentMethods).toHaveBeenCalledWith(expect.objectContaining({
      variantKey: 'DEFAULT',
    }));
    expect(secondRenderPaymentMethods).toHaveBeenCalledWith(expect.objectContaining({
      variantKey: 'uspay',
    }));
    expect(loadTossPaymentsMock).toHaveBeenLastCalledWith('test-foreign-widget-key');
    expect(screen.queryByText('결제 위젯을 불러오는데 실패했습니다.')).not.toBeInTheDocument();
  });

  it('requests overseas card direct payment in KRW without provider-charge amount markers', async () => {
    process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = 'DEFAULT,uspay';
    process.env.NEXT_PUBLIC_TOSS_OVERSEAS_CARD_CLIENT_KEY = 'test_ck_direct_key';
    const ref = createRef<TossPaymentWidgetRef>();
    const user = userEvent.setup();

    render(<TossPaymentWidget {...defaultProps} ref={ref} />);

    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('tab', { name: '해외 결제' }));
    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(2));

    await ref.current?.requestPayment({
      reservationId: 'reservation-1',
      orderId: 'GRP-TEST-ORDER',
      queueAdmission: {
        queueSessionId: 'queue-session-1',
        admissionToken: 'admission-token-1',
        refreshFamilyId: 'refresh-family-1',
        deviceSlotKey: 'device-slot-1',
        admittedAt: '2026-06-05T10:00:00.000Z',
        activeUntilAt: '2026-06-05T10:07:00.000Z',
        reentryGraceUntilAt: '2026-06-05T10:08:00.000Z',
      },
      paymentDeadlineAt: '2026-06-05T10:07:00.000Z',
      bookingPolicy: {
        maxTicketsPerOrder: 2,
        cancellationChangePolicy: 'CANCEL_ONLY',
        sameGradeChangeEnabled: false,
      },
      paymentMethod: {
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        overseasPaymentConsent: {
          required: true,
          agreed: true,
          agreementVersion: '2026-05-08',
        },
      },
    });

    expect(apiClientPostMock).toHaveBeenCalledWith(
      '/api/v1/payments/branch',
      expect.objectContaining({
        orderId: 'GRP-TEST-ORDER',
        paymentMethod: expect.objectContaining({
          method: 'CARD',
          provider: 'CARD',
          currency: 'KRW',
        }),
      }),
      { showErrorToast: false },
    );
    expect(directPaymentRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      method: 'CARD',
      amount: {
        currency: 'KRW',
        value: 50000,
      },
      successUrl: 'https://grabit.test/booking/performance-1/complete?provider=OVERSEAS_CARD',
      card: {
        useInternationalCardOnly: true,
      },
    }));
  });

  it('blocks overseas card direct payment when the server secret is unavailable', async () => {
    process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = 'DEFAULT,uspay';
    process.env.NEXT_PUBLIC_TOSS_OVERSEAS_CARD_CLIENT_KEY = 'test_ck_direct_key';
    apiClientPostMock.mockResolvedValueOnce({
      orderId: 'GRP-TEST-ORDER',
      method: 'CARD',
      provider: 'CARD',
      currency: 'KRW',
      successUrl: 'https://grabit.test/booking/performance-1/complete',
      failUrl: 'https://grabit.test/booking/performance-1/confirm?error=true',
      asyncStatus: 'sync',
      useInternationalCardOnly: true,
      checkoutEnabled: false,
      disabledReason: 'OVERSEAS_CARD_SECRET_KEY_MISSING',
    });
    const ref = createRef<TossPaymentWidgetRef>();
    const user = userEvent.setup();

    render(<TossPaymentWidget {...defaultProps} ref={ref} />);

    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('tab', { name: '해외 결제' }));
    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(2));

    await expect(ref.current?.requestPayment({
      reservationId: 'reservation-1',
      orderId: 'GRP-TEST-ORDER',
      queueAdmission: {
        queueSessionId: 'queue-session-1',
        admissionToken: 'admission-token-1',
        refreshFamilyId: 'refresh-family-1',
        deviceSlotKey: 'device-slot-1',
        admittedAt: '2026-06-05T10:00:00.000Z',
        activeUntilAt: '2026-06-05T10:07:00.000Z',
        reentryGraceUntilAt: '2026-06-05T10:08:00.000Z',
      },
      paymentDeadlineAt: '2026-06-05T10:07:00.000Z',
      bookingPolicy: {
        maxTicketsPerOrder: 2,
        cancellationChangePolicy: 'CANCEL_ONLY',
        sameGradeChangeEnabled: false,
      },
      paymentMethod: {
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        overseasPaymentConsent: {
          required: true,
          agreed: true,
          agreementVersion: '2026-05-08',
        },
      },
    })).rejects.toThrow('해외 카드 결제 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.');
    expect(directPaymentRequestMock).not.toHaveBeenCalled();
  });
});
