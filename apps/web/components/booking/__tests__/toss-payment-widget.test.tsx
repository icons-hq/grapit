import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { TossPaymentWidget } from '../toss-payment-widget';

const {
  loadTossPaymentsMock,
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
  loadTossPaymentsMock: vi.fn(),
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

vi.mock('@tosspayments/tosspayments-sdk', () => ({
  loadTossPayments: loadTossPaymentsMock,
}));

const originalClientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
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
    loadTossPaymentsMock.mockResolvedValue({
      widgets: widgetsFactoryMock,
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
  });

  it('selects direct Alipay without rendering Toss widget containers', async () => {
    const user = userEvent.setup();
    render(<TossPaymentWidget {...defaultProps} />);

    await waitFor(() => expect(renderPaymentMethodsMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('tab', { name: 'Alipay' }));

    await waitFor(() => expect(defaultProps.onPaymentMethodChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestFlow: 'direct_foreign_easy_pay',
        paymentMethod: expect.objectContaining({
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'USD',
        }),
      }),
    ));
    expect(renderPaymentMethodsMock).toHaveBeenCalledTimes(1);
    expect(renderAgreementMock).toHaveBeenCalledTimes(1);
    expect(setAmountMock).toHaveBeenCalledTimes(1);
    expect(defaultProps.onPaymentMethodChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestFlow: 'direct_foreign_easy_pay',
        paymentMethod: expect.objectContaining({
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'USD',
        }),
      }),
    );
    expect(defaultProps.onWidgetAgreementChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByLabelText('결제 수단 선택')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alipay\s+USD/ })).toBeInTheDocument();
    expect(screen.queryByText('결제 위젯을 불러오는데 실패했습니다.')).not.toBeInTheDocument();
  });

  it('destroys the previous agreement widget before rendering a foreign widget variant', async () => {
    process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = 'DEFAULT,paypal';
    const user = userEvent.setup();
    render(<TossPaymentWidget {...defaultProps} />);

    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('tab', { name: '해외 결제' }));

    await waitFor(() => expect(renderAgreementMock).toHaveBeenCalledTimes(2));
    expect(agreementDestroyMock).toHaveBeenCalled();
    expect(agreementDestroyMock.mock.invocationCallOrder[0]).toBeLessThan(
      renderAgreementMock.mock.invocationCallOrder[1],
    );
    expect(screen.queryByText('결제 위젯을 불러오는데 실패했습니다.')).not.toBeInTheDocument();
  });
});
