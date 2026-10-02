import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';

import { AdminBookingDetailModal } from '../admin-booking-detail-modal';
import { useAuthStore } from '@/stores/use-auth-store';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  bookingDetail: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mocks.apiGet, post: mocks.apiPost },
}));

vi.mock('@/hooks/use-reservations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-reservations')>();
  return { ...actual, useAdminBookingDetail: mocks.bookingDetail };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const QUOTE = {
  originalPaymentAmount: 122000,
  ticketSubtotal: 120000,
  ticketServiceFeeTotal: 2000,
  cancellationFeeTotal: 0,
  serviceFeeRefundTotal: 0,
  refundableAmount: 120000,
  policyCodes: ['WITHIN_7_DAYS_AFTER_BOOKING'],
  items: [],
};

function confirmedBooking() {
  return {
    id: 'reservation-1',
    reservationNumber: 'R-20260514-001',
    userName: '김운영',
    userPhone: '+821012345678',
    userEmail: 'operator-buyer@example.com',
    userCountry: 'KR',
    performanceTitle: '걸룰스 팬미팅',
    showDateTime: '2026-07-18T10:00:00.000Z',
    seats: [{ seatId: 'A-10', seatKey: '1F:A-10', floorKey: '1F', floorLabel: '1층', tierName: 'VIP',
      price: 120000, row: 'A', number: '10' }],
    totalAmount: 122000,
    status: 'CONFIRMED' as const,
    funnelStatus: 'SOLD' as const,
    paymentStatus: 'DONE' as const,
    paymentMethod: 'CARD',
    paymentFailureDiagnostic: null,
    paymentMethodAttribution: { label: '카드 / 카드사 / KRW', method: 'CARD', provider: 'CARD', currency: 'KRW', source: 'DB' },
    ticketStatusCounts: { ACTIVE: 1, CANCELLATION_PENDING: 0, CANCELLED: 0, EXPIRED: 0 },
    createdAt: '2026-05-14T01:00:00.000Z',
    paymentInfo: { paymentKey: 'payment-1', method: 'CARD', amount: 122000, status: 'DONE' as const, paidAt: '2026-05-14T01:05:00.000Z' },
    ticketItems: [],
  };
}

function mockRefundPreview(preview: Record<string, unknown>) {
  mocks.apiGet.mockImplementation((url: string) => (url.includes('refund-preview')
    ? Promise.resolve(preview)
    : Promise.reject(new Error(`unmocked GET ${url}`))));
}

function renderModal(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('Admin refund preview blockers (audit #80, #23)', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false, configurable: true });
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  });

  beforeEach(() => {
    useAuthStore.getState().setAuth('test-only', {
      id: 'operator', email: 'operator@example.test', name: 'Operator', phone: '+82100000000', gender: 'unspecified',
      country: 'KR', birthDate: '1990-01-01', preferredLocale: 'ko', isEmailVerified: true, isPhoneVerified: true,
      marketingConsent: false, role: 'admin', adminCapabilityBundle: null, adminCapabilities: ['refund.admin_refund'],
      createdAt: '2026-01-01T00:00:00Z',
    });
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    mocks.bookingDetail.mockReset();
    mocks.bookingDetail.mockReturnValue({ data: confirmedBooking(), isLoading: false });
  });

  it('shows the server blocker and keeps the refund confirmation disabled', async () => {
    const user = userEvent.setup();
    const onRefund = vi.fn();
    mockRefundPreview({
      reservationId: 'reservation-1',
      cancellationQuote: QUOTE,
      refundableAmount: 120000,
      canRequestRefund: false,
      blockedReason: '결제사 환불 잔액이 예매 기록과 다릅니다. 결제사 취소 내역을 대조한 뒤 처리해주세요.',
    });

    renderModal(<AdminBookingDetailModal open onOpenChange={vi.fn()} bookingId="reservation-1" onRefund={onRefund} isRefunding={false} />);
    await user.click(screen.getByRole('button', { name: '환불 처리' }));
    await user.type(screen.getByPlaceholderText('환불 사유를 입력하세요'), '운영 환불');

    expect(await screen.findByRole('alert')).toHaveTextContent('결제사 환불 잔액이 예매 기록과 다릅니다');
    const confirm = screen.getByRole('button', { name: '환불 확인' });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onRefund).not.toHaveBeenCalled();
  });

  it('allows confirmation when the preview has no blocker', async () => {
    const user = userEvent.setup();
    mockRefundPreview({
      reservationId: 'reservation-1',
      cancellationQuote: QUOTE,
      refundableAmount: 120000,
      canRequestRefund: true,
      blockedReason: null,
    });

    renderModal(<AdminBookingDetailModal open onOpenChange={vi.fn()} bookingId="reservation-1" onRefund={vi.fn()} isRefunding={false} />);
    await user.click(screen.getByRole('button', { name: '환불 처리' }));
    await user.type(screen.getByPlaceholderText('환불 사유를 입력하세요'), '운영 환불');

    expect(await screen.findByText('120,000원')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '환불 확인' })).toBeEnabled();
  });
});
