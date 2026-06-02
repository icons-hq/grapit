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

  it('renders Toss widget containers after switching to the Alipay widget variant', async () => {
    const user = userEvent.setup();
    render(<TossPaymentWidget {...defaultProps} />);

    await waitFor(() => expect(renderPaymentMethodsMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('tab', { name: 'Alipay' }));

    await waitFor(() => expect(renderPaymentMethodsMock).toHaveBeenCalledTimes(2));
    expect(setAmountMock).toHaveBeenLastCalledWith({
      currency: 'USD',
      value: 34,
    });
    expect(renderPaymentMethodsMock).toHaveBeenLastCalledWith({
      selector: '#payment-method',
      variantKey: 'alipay',
    });
    expect(renderAgreementMock).toHaveBeenCalledTimes(2);
    expect(defaultProps.onPaymentMethodChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestFlow: 'widget',
        paymentMethod: expect.objectContaining({
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
          currency: 'USD',
        }),
      }),
    );
    expect(screen.queryByText('결제 위젯을 불러오는데 실패했습니다.')).not.toBeInTheDocument();
  });
});
