import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import type { PrepareReservationResponse } from '@grabit/shared';
import {
  TossPaymentWidget,
  isPayableWidgetSelection,
  resolvePaymentMethodSelection,
  type TossPaymentWidgetRef,
} from '../toss-payment-widget';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';

const {
  apiClientPostMock,
  loadTossPaymentsMock,
  widgetsRequestPaymentMock,
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
  widgetsRequestPaymentMock: vi.fn(),
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
      requestPayment: widgetsRequestPaymentMock,
    });
    loadTossPaymentsMock.mockResolvedValue({
      widgets: widgetsFactoryMock,
    });
    widgetsRequestPaymentMock.mockResolvedValue(undefined);
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
  });

  it('filters the deprecated standalone Alipay variant out of the payment tabs', async () => {
    render(<TossPaymentWidget {...defaultProps} />);

    await waitFor(() => expect(renderPaymentMethodsMock).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole('tab', { name: 'Alipay' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Alipay\s+USD/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('결제 수단 선택')).toBeInTheDocument();
  });

  it('restores the foreign widget for a server-owned overseas checkout', async () => {
    process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = 'DEFAULT,uspay';
    render(<TossPaymentWidget {...defaultProps} initialPaymentMethod={{
      method: 'CARD', provider: 'CARD', currency: 'USD',
      overseasPaymentConsent: { required: true, agreed: true, agreementVersion: 'test' },
    }} />);
    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('tab', { name: '해외 결제' })).toHaveAttribute('aria-selected', 'true');
    expect(loadTossPaymentsMock).toHaveBeenLastCalledWith('test-foreign-widget-key');
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

  it('notifies the branch payment deadline before requesting Toss payment', async () => {
    const onPaymentDeadlineChange = vi.fn();
    apiClientPostMock.mockResolvedValueOnce({
      orderId: 'GRP-TEST-ORDER',
      method: 'CARD',
      provider: 'CARD',
      currency: 'KRW',
      successUrl: 'https://grabit.test/booking/performance-1/complete',
      failUrl: 'https://grabit.test/booking/performance-1/confirm?error=true',
      asyncStatus: 'sync',
      useInternationalCardOnly: false,
      paymentDeadlineAt: '2026-06-05T10:09:00.000Z',
    });
    const ref = createRef<TossPaymentWidgetRef>();

    render(
      <TossPaymentWidget
        {...defaultProps}
        ref={ref}
        onPaymentDeadlineChange={onPaymentDeadlineChange}
      />,
    );

    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));

    await ref.current?.requestPayment();

    expect(onPaymentDeadlineChange).toHaveBeenCalledWith('2026-06-05T10:09:00.000Z');
    expect(onPaymentDeadlineChange.mock.invocationCallOrder[0]).toBeLessThan(
      widgetsRequestPaymentMock.mock.invocationCallOrder[0],
    );
    expect(widgetsRequestPaymentMock).toHaveBeenCalledWith(expect.objectContaining({
      failUrl:
        'https://grabit.test/booking/performance-1/confirm?error=true&paymentDeadlineAt=2026-06-05T10%3A09%3A00.000Z',
    }));
  });

  it('does not open a provider when the selection no longer matches the prepared checkout', async () => {
    const ref = createRef<TossPaymentWidgetRef>();
    render(<TossPaymentWidget {...defaultProps} ref={ref} />);
    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));
    const prepared = {
      orderId: defaultProps.orderId,
      paymentMethod: { method: 'SIMPLE_PAY', provider: 'KAKAOPAY', currency: 'KRW' },
    } as PrepareReservationResponse;

    await expect(ref.current?.requestPayment(prepared)).rejects.toThrow('결제수단이 변경되었습니다');
    expect(apiClientPostMock).not.toHaveBeenCalled();
    expect(widgetsRequestPaymentMock).not.toHaveBeenCalled();
  });

  it('stops before the SDK request if the selection changes while the server authorizes checkout', async () => {
    let resolveBranch!: (value: unknown) => void;
    apiClientPostMock.mockImplementationOnce(() => new Promise((resolve) => { resolveBranch = resolve; }));
    const ref = createRef<TossPaymentWidgetRef>();
    render(<TossPaymentWidget {...defaultProps} ref={ref} />);
    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));
    const request = ref.current!.requestPayment().catch((error: Error) => error);
    await waitFor(() => expect(apiClientPostMock).toHaveBeenCalledTimes(1));
    const onSelect = paymentMethodOnMock.mock.calls.find(([event]) => event === 'paymentMethodSelect')![1];
    onSelect({ code: 'KAKAOPAY' });
    resolveBranch({
      orderId: defaultProps.orderId, method: 'CARD', provider: 'CARD', currency: 'KRW',
      successUrl: 'https://grabit.test/complete', failUrl: 'https://grabit.test/confirm',
      asyncStatus: 'sync', useInternationalCardOnly: false,
    });
    expect(await request).toEqual(expect.objectContaining({ message: expect.stringContaining('결제수단이 변경되었습니다') }));
    expect(widgetsRequestPaymentMock).not.toHaveBeenCalled();
    expect(apiClientPostMock).toHaveBeenLastCalledWith(
      '/api/v1/payments/branch/release',
      { orderId: defaultProps.orderId },
      { showErrorToast: false },
    );
  });

  it('hands the order back when the SDK rejects before opening checkout, then reports the SDK error', async () => {
    const sdkError = Object.assign(new Error('카드 결제 정보를 선택해주세요.'), {
      code: 'NEED_CARD_PAYMENT_DETAIL',
    });
    widgetsRequestPaymentMock.mockRejectedValueOnce(sdkError);
    const ref = createRef<TossPaymentWidgetRef>();
    render(<TossPaymentWidget {...defaultProps} ref={ref} />);
    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));

    await expect(ref.current!.requestPayment()).rejects.toBe(sdkError);

    expect(apiClientPostMock).toHaveBeenNthCalledWith(1, '/api/v1/payments/branch', expect.objectContaining({
      orderId: defaultProps.orderId,
    }), { showErrorToast: false });
    expect(apiClientPostMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/payments/branch/release',
      { orderId: defaultProps.orderId },
      { showErrorToast: false },
    );
    expect(widgetsRequestPaymentMock.mock.invocationCallOrder[0]!)
      .toBeLessThan(apiClientPostMock.mock.invocationCallOrder[1]!);
  });

  it('keeps reporting the SDK error when the handoff release itself fails', async () => {
    const sdkError = Object.assign(new Error('필수 약관에 동의해주세요.'), {
      code: 'NEED_AGREEMENT_WITH_REQUIRED_TERMS',
    });
    widgetsRequestPaymentMock.mockRejectedValueOnce(sdkError);
    apiClientPostMock
      .mockResolvedValueOnce({
        orderId: defaultProps.orderId, method: 'CARD', provider: 'CARD', currency: 'KRW',
        successUrl: 'https://grabit.test/complete', failUrl: 'https://grabit.test/confirm',
        asyncStatus: 'sync', useInternationalCardOnly: false,
      })
      .mockRejectedValueOnce(Object.assign(new Error('결제 상태를 확인 중입니다.'), { statusCode: 409 }));
    const ref = createRef<TossPaymentWidgetRef>();
    render(<TossPaymentWidget {...defaultProps} ref={ref} />);
    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));

    await expect(ref.current!.requestPayment()).rejects.toBe(sdkError);
    expect(apiClientPostMock).toHaveBeenCalledTimes(2);
  });

  it('hands back a handoff whose branch response was lost or hit a server error, but never one refused with 4xx', async () => {
    const ref = createRef<TossPaymentWidgetRef>();
    render(<TossPaymentWidget {...defaultProps} ref={ref} />);
    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));

    const lost = new TypeError('Failed to fetch');
    apiClientPostMock.mockRejectedValueOnce(lost).mockResolvedValueOnce({ orderId: defaultProps.orderId, released: true });
    await expect(ref.current!.requestPayment()).rejects.toBe(lost);
    expect(apiClientPostMock).toHaveBeenLastCalledWith(
      '/api/v1/payments/branch/release',
      { orderId: defaultProps.orderId },
      { showErrorToast: false },
    );

    // A gateway error can arrive after the server committed the handoff under open load.
    apiClientPostMock.mockClear();
    const gateway = Object.assign(new Error('Bad Gateway'), { statusCode: 502 });
    apiClientPostMock.mockRejectedValueOnce(gateway).mockResolvedValueOnce({ orderId: defaultProps.orderId, released: true });
    await expect(ref.current!.requestPayment()).rejects.toBe(gateway);
    expect(apiClientPostMock).toHaveBeenCalledTimes(2);
    expect(apiClientPostMock).toHaveBeenLastCalledWith(
      '/api/v1/payments/branch/release',
      { orderId: defaultProps.orderId },
      { showErrorToast: false },
    );

    apiClientPostMock.mockClear();
    const otherTab = Object.assign(new Error('결제 상태를 확인 중입니다. 기존 예매를 다시 확인해주세요.'), { statusCode: 409 });
    apiClientPostMock.mockRejectedValueOnce(otherTab);
    await expect(ref.current!.requestPayment()).rejects.toBe(otherTab);
    expect(apiClientPostMock).toHaveBeenCalledTimes(1);
    expect(widgetsRequestPaymentMock).not.toHaveBeenCalled();
  });

  it('does not record a handoff when the live widget selection differs from the last selection event', async () => {
    const onPaymentMethodChange = vi.fn();
    const ref = createRef<TossPaymentWidgetRef>();
    render(<TossPaymentWidget {...defaultProps} ref={ref} onPaymentMethodChange={onPaymentMethodChange} />);
    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onPaymentMethodChange).toHaveBeenCalled());
    getSelectedPaymentMethodMock.mockResolvedValueOnce({ code: 'KAKAOPAY' });

    await expect(ref.current!.requestPayment()).rejects.toThrow('결제수단이 변경되었습니다');

    expect(apiClientPostMock).not.toHaveBeenCalled();
    expect(widgetsRequestPaymentMock).not.toHaveBeenCalled();
    expect(onPaymentMethodChange).toHaveBeenLastCalledWith(expect.objectContaining({
      paymentMethod: expect.objectContaining({ method: 'SIMPLE_PAY', provider: 'KAKAOPAY' }),
    }));
  });

  it.each([
    ['VIRTUAL_ACCOUNT', 'VIRTUAL_ACCOUNT'],
    ['휴대폰', 'MOBILE_PHONE'],
    ['PAYCO', 'SIMPLE_PAY'],
  ])('refuses a live %s selection before any handoff is recorded (audit #70)', async (code, method) => {
    const onPaymentMethodChange = vi.fn();
    const ref = createRef<TossPaymentWidgetRef>();
    render(<TossPaymentWidget {...defaultProps} ref={ref} onPaymentMethodChange={onPaymentMethodChange} />);
    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));
    // The selection event said card; the iframe now shows the refused method.
    getSelectedPaymentMethodMock.mockResolvedValueOnce({ code });

    await expect(ref.current!.requestPayment()).rejects.toThrow(getCheckoutCopy('ko').methodNotAllowed);

    expect(apiClientPostMock).not.toHaveBeenCalled();
    expect(widgetsRequestPaymentMock).not.toHaveBeenCalled();
    expect(onPaymentMethodChange).toHaveBeenLastCalledWith(expect.objectContaining({
      code,
      paymentMethod: expect.objectContaining({ method }),
    }));
  });

  it('refuses an unsupported selection even when the selection event already reported it', async () => {
    getSelectedPaymentMethodMock.mockResolvedValue({ code: 'SAMSUNGPAY' });
    const ref = createRef<TossPaymentWidgetRef>();
    render(<TossPaymentWidget {...defaultProps} ref={ref} />);
    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));

    await expect(ref.current!.requestPayment()).rejects.toThrow(getCheckoutCopy('ko').methodNotAllowed);
    expect(apiClientPostMock).not.toHaveBeenCalled();
    expect(widgetsRequestPaymentMock).not.toHaveBeenCalled();
  });

  // Card issuer shortcuts share their codes with bank institution codes; classifying one as
  // CARD would let a transfer through to a checkout_method_mismatch compensation cancel.
  it.each(['SHINHAN', 'HYUNDAI', 'KOOKMIN', 'BC', 'IBK_BC'])(
    'refuses the card issuer shortcut %s as unsupported before any handoff',
    async (code) => {
      getSelectedPaymentMethodMock.mockResolvedValue({ code });
      const onPaymentMethodChange = vi.fn();
      const ref = createRef<TossPaymentWidgetRef>();
      render(<TossPaymentWidget {...defaultProps} ref={ref} onPaymentMethodChange={onPaymentMethodChange} />);
      await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(onPaymentMethodChange).toHaveBeenCalledWith(
        expect.objectContaining({ code, unsupported: true }),
      ));

      await expect(ref.current!.requestPayment()).rejects.toThrow(getCheckoutCopy('ko').methodNotAllowed);
      expect(apiClientPostMock).not.toHaveBeenCalled();
      expect(widgetsRequestPaymentMock).not.toHaveBeenCalled();
    },
  );

  it('reports a missing client key to checkout as the load error it shows', async () => {
    delete process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
    const onLoadError = vi.fn();
    const onReady = vi.fn();
    const { unmount } = render(
      <TossPaymentWidget {...defaultProps} onReady={onReady} onLoadError={onLoadError} />,
    );

    const setupIncomplete = getVisibleCopy('ko').bookingExtra.widget.setupIncomplete;
    expect(await screen.findByText(setupIncomplete)).toBeInTheDocument();
    expect(onLoadError).toHaveBeenLastCalledWith(setupIncomplete);
    expect(onReady).not.toHaveBeenCalled();
    expect(loadTossPaymentsMock).not.toHaveBeenCalled();

    unmount();
    expect(onLoadError).toHaveBeenLastCalledWith(null);
  });

  it('reports an SDK load failure to checkout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    loadTossPaymentsMock.mockRejectedValueOnce(new Error('sdk blocked'));
    const onLoadError = vi.fn();
    render(<TossPaymentWidget {...defaultProps} onLoadError={onLoadError} />);

    const systemLoadFailed = getVisibleCopy('ko').bookingExtra.widget.systemLoadFailed;
    expect(await screen.findByText(systemLoadFailed)).toBeInTheDocument();
    expect(onLoadError).toHaveBeenLastCalledWith(systemLoadFailed);
  });

  it('reports a render failure, and clears it once a later render succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPaymentMethodsMock.mockRejectedValueOnce(new Error('iframe failed'));
    const onLoadError = vi.fn();
    const onReady = vi.fn();
    const { rerender } = render(
      <TossPaymentWidget {...defaultProps} onReady={onReady} onLoadError={onLoadError} />,
    );

    const widgetLoadFailed = getVisibleCopy('ko').bookingExtra.widget.widgetLoadFailed;
    expect(await screen.findByText(widgetLoadFailed)).toBeInTheDocument();
    expect(onLoadError).toHaveBeenLastCalledWith(widgetLoadFailed);
    expect(onReady).not.toHaveBeenCalled();

    // A new amount renders the widget again.
    rerender(<TossPaymentWidget {...defaultProps} amount={60000} onReady={onReady} onLoadError={onLoadError} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(onLoadError).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText(widgetLoadFailed)).not.toBeInTheDocument();
  });

  it('does not record a handoff after the buyer withdraws the payment terms agreement', async () => {
    const ref = createRef<TossPaymentWidgetRef>();
    render(<TossPaymentWidget {...defaultProps} ref={ref} />);
    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));
    const onAgreement = agreementOnMock.mock.calls.find(([event]) => event === 'agreementStatusChange')![1];
    onAgreement({ agreedRequiredTerms: false, agreements: [] });

    await expect(ref.current!.requestPayment()).rejects.toThrow('결제 약관에 동의해주세요');
    expect(apiClientPostMock).not.toHaveBeenCalled();
  });

  it('requests overseas card through the foreign payment widget in USD with provider-charge amount markers', async () => {
    process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = 'DEFAULT,uspay';
    apiClientPostMock.mockResolvedValueOnce({
      orderId: 'GRP-TEST-ORDER',
      method: 'CARD',
      provider: 'CARD',
      currency: 'USD',
      successUrl: 'https://grabit.test/booking/performance-1/complete',
      failUrl: 'https://grabit.test/booking/performance-1/confirm?error=true',
      asyncStatus: 'sync',
      useInternationalCardOnly: true,
      checkoutEnabled: true,
      providerChargeQuote: {
        currency: 'USD',
        amountMinor: 3400,
        amountDecimal: '34.00',
        rate: '0.00068',
        quotedAt: '2026-06-05T10:00:00.000Z',
      },
    });
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
        currency: 'USD',
        overseasPaymentConsent: {
          required: true,
          agreed: true,
          agreementVersion: '2026-05-08',
        },
      },
      checkoutEnabled: true,
      providerChargeQuote: {
        currency: 'USD',
        amountMinor: 3400,
        amountDecimal: '34.00',
        rate: '0.00068',
        quotedAt: '2026-06-05T10:00:00.000Z',
      },
    });

    expect(apiClientPostMock).toHaveBeenCalledWith(
      '/api/v1/payments/branch',
      expect.objectContaining({
        orderId: 'GRP-TEST-ORDER',
        paymentMethod: expect.objectContaining({
          method: 'CARD',
          provider: 'CARD',
          currency: 'USD',
        }),
      }),
      { showErrorToast: false },
    );
    expect(loadTossPaymentsMock).toHaveBeenLastCalledWith('test-foreign-widget-key');
    expect(setAmountMock).toHaveBeenLastCalledWith({
      currency: 'USD',
      value: 34,
    });
    expect(widgetsRequestPaymentMock).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'GRP-TEST-ORDER',
      successUrl:
        'https://grabit.test/booking/performance-1/complete?provider=OVERSEAS_CARD&providerChargeAmount=34.00',
    }));
    expect(widgetsRequestPaymentMock).toHaveBeenCalledWith(expect.not.objectContaining({
      method: 'CARD',
      amount: expect.objectContaining({
        currency: 'USD',
        value: 34,
      }),
    }));
  });

  it('blocks overseas card widget payment when the server widget secret is unavailable', async () => {
    process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = 'DEFAULT,uspay';
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
        currency: 'USD',
        overseasPaymentConsent: {
          required: true,
          agreed: true,
          agreementVersion: '2026-05-08',
        },
      },
      checkoutEnabled: true,
      providerChargeQuote: {
        currency: 'USD',
        amountMinor: 3400,
        amountDecimal: '34.00',
        rate: '0.00068',
        quotedAt: '2026-06-05T10:00:00.000Z',
      },
    })).rejects.toThrow('해외 카드 결제 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.');
    expect(widgetsRequestPaymentMock).not.toHaveBeenCalled();
  });
});

describe('resolvePaymentMethodSelection widget code table (audit #70)', () => {
  it.each([
    ['CARD', { method: 'CARD', provider: 'CARD', currency: 'KRW' }],
    ['card', { method: 'CARD', provider: 'CARD', currency: 'KRW' }],
    ['카드', { method: 'CARD', provider: 'CARD', currency: 'KRW' }],
    ['TRANSFER', { method: 'TRANSFER', provider: 'CARD', currency: 'KRW' }],
    ['계좌이체', { method: 'TRANSFER', provider: 'CARD', currency: 'KRW' }],
    ['VIRTUAL_ACCOUNT', { method: 'VIRTUAL_ACCOUNT', provider: 'CARD', currency: 'KRW' }],
    ['가상계좌', { method: 'VIRTUAL_ACCOUNT', provider: 'CARD', currency: 'KRW' }],
    ['MOBILE_PHONE', { method: 'MOBILE_PHONE', provider: 'CARD', currency: 'KRW' }],
    ['휴대폰', { method: 'MOBILE_PHONE', provider: 'CARD', currency: 'KRW' }],
    ['TOSSPAY', { method: 'SIMPLE_PAY', provider: 'TOSS_PAY', currency: 'KRW' }],
    ['토스페이', { method: 'SIMPLE_PAY', provider: 'TOSS_PAY', currency: 'KRW' }],
    ['NAVERPAY', { method: 'SIMPLE_PAY', provider: 'NAVER_PAY', currency: 'KRW' }],
    ['네이버페이', { method: 'SIMPLE_PAY', provider: 'NAVER_PAY', currency: 'KRW' }],
    ['kakaopay', { method: 'SIMPLE_PAY', provider: 'KAKAOPAY', currency: 'KRW' }],
    ['카카오페이', { method: 'SIMPLE_PAY', provider: 'KAKAOPAY', currency: 'KRW' }],
    ['PAYPAL', { method: 'FOREIGN_EASY_PAY', provider: 'PAYPAL', currency: 'USD' }],
    ['페이팔', { method: 'FOREIGN_EASY_PAY', provider: 'PAYPAL', currency: 'USD' }],
    ['TRUEMONEY', { method: 'FOREIGN_EASY_PAY', provider: 'TRUEMONEY', currency: 'USD' }],
    ['VISA', { method: 'CARD', provider: 'CARD', currency: 'USD' }],
  ] as const)('maps the domestic widget code %s exactly', (code, paymentMethod) => {
    const selection = resolvePaymentMethodSelection(code, 'DEFAULT');
    expect(selection.unsupported).toBeUndefined();
    expect(selection.paymentMethod).toMatchObject(paymentMethod);
  });

  it.each(['CARD', '카드', 'OVERSEAS_CARD', 'MASTER'])('keeps %s an overseas USD card in the overseas widget', (code) => {
    expect(resolvePaymentMethodSelection(code, 'uspay')).toMatchObject({
      requiresOverseasDisclaimer: true,
      paymentMethod: { method: 'CARD', provider: 'CARD', currency: 'USD', overseasPaymentConsent: { required: true } },
    });
  });

  it.each([
    'PAYCO', 'SAMSUNGPAY', 'LPAY', 'SSG', 'SSGPAY', 'APPLEPAY', 'PINPAY', 'KBPAY', 'CULTURE_GIFT_CERTIFICATE',
    '문화상품권', 'BOOK_GIFT_CERTIFICATE', 'GAME_GIFT_CERTIFICATE', '간편결제', 'EASY_PAY', 'SHINHAN', 'BRANDPAY',
    'OVERSEAS_CARD', 'GCASH', 'UNKNOWN', '',
  ])('flags %s unsupported instead of falling back to CARD', (code) => {
    const selection = resolvePaymentMethodSelection(code, 'DEFAULT');
    expect(selection.unsupported).toBe(true);
    expect(selection.paymentMethod.method).not.toBe('CARD');
    expect(isPayableWidgetSelection(selection)).toBe(false);
  });

  it('never lets an unsupported placeholder compare equal to a payable selection', () => {
    const unsupported = resolvePaymentMethodSelection('PAYCO').paymentMethod;
    for (const code of ['CARD', 'TRANSFER', 'TOSSPAY', 'NAVERPAY', 'KAKAOPAY', 'PAYPAL', 'VISA']) {
      expect(resolvePaymentMethodSelection(code).paymentMethod).not.toEqual(unsupported);
    }
  });

  it.each(['VIRTUAL_ACCOUNT', 'MOBILE_PHONE'])('classifies %s exactly but never as payable', (code) => {
    const selection = resolvePaymentMethodSelection(code);
    expect(selection.unsupported).toBeUndefined();
    expect(isPayableWidgetSelection(selection)).toBe(false);
  });
});
