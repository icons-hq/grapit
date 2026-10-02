import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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

const PROVIDER_CHECK_UNAVAILABLE = '결제사 결제 상태를 확인하지 못했습니다. 잠시 후 미리보기를 다시 조회해주세요.';

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

describe('Admin refund preview blockers (audit #80, #23, #53)', () => {
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

  it('warns and offers a re-check instead of the refund when the PG payment could not be queried (fail closed)', async () => {
    const user = userEvent.setup();
    const onRefund = vi.fn();
    const unavailable = {
      reservationId: 'reservation-1',
      cancellationQuote: QUOTE,
      refundableAmount: 120000,
      canRequestRefund: false,
      providerCheckUnavailable: true,
      blockedReason: PROVIDER_CHECK_UNAVAILABLE,
    };
    let previewCalls = 0;
    let resolveRecheck!: (value: unknown) => void;
    mocks.apiGet.mockImplementation((url: string) => {
      if (!url.includes('refund-preview')) return Promise.reject(new Error(`unmocked GET ${url}`));
      previewCalls += 1;
      return previewCalls === 1
        ? Promise.resolve(unavailable)
        : new Promise((resolve) => { resolveRecheck = resolve; });
    });

    renderModal(<AdminBookingDetailModal open onOpenChange={vi.fn()} bookingId="reservation-1" onRefund={onRefund} isRefunding={false} />);
    await user.click(screen.getByRole('button', { name: '환불 처리' }));
    await user.type(screen.getByPlaceholderText('환불 사유를 입력하세요'), '운영 환불');

    expect(await screen.findByRole('alert')).toHaveTextContent(PROVIDER_CHECK_UNAVAILABLE);
    const confirm = screen.getByRole('button', { name: '환불 확인' });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onRefund).not.toHaveBeenCalled();
    expect(mocks.apiPost).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '다시 조회' }));
    expect(previewCalls).toBe(2);
    // The re-check is disabled while it runs.
    expect(await screen.findByRole('button', { name: '다시 조회 중...' })).toBeDisabled();
    resolveRecheck({ ...unavailable, canRequestRefund: true, providerCheckUnavailable: false, blockedReason: null });

    await waitFor(() => expect(screen.getByRole('button', { name: '환불 확인' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers a re-check when the preview itself could not be loaded', async () => {
    const user = userEvent.setup();
    mocks.apiGet.mockImplementation((url: string) => Promise.reject(new Error(`preview failed ${url}`)));

    renderModal(<AdminBookingDetailModal open onOpenChange={vi.fn()} bookingId="reservation-1" onRefund={vi.fn()} isRefunding={false} />);
    await user.click(screen.getByRole('button', { name: '환불 처리' }));
    await user.type(screen.getByPlaceholderText('환불 사유를 입력하세요'), '운영 환불');

    expect(await screen.findByRole('alert')).toHaveTextContent('환불 미리보기를 불러오지 못했습니다');
    expect(screen.getByRole('button', { name: '다시 조회' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '환불 확인' })).toBeDisabled();
  });

  it('shows a 4xx preview answer as a blocker with the server message instead of a PG re-check', async () => {
    const user = userEvent.setup();
    const message = '입장 처리된 티켓은 관리자 강제 취소로만 취소할 수 있습니다';
    mocks.apiGet.mockImplementation((url: string) => (url.includes('refund-preview')
      ? Promise.reject(Object.assign(new Error(message), { statusCode: 403 }))
      : Promise.reject(new Error(`unmocked GET ${url}`))));

    renderModal(<AdminBookingDetailModal open onOpenChange={vi.fn()} bookingId="reservation-1" onRefund={vi.fn()} isRefunding={false} />);
    await user.click(screen.getByRole('button', { name: '환불 처리' }));
    await user.type(screen.getByPlaceholderText('환불 사유를 입력하세요'), '운영 환불');

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: '다시 조회' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '환불 확인' })).toBeDisabled();
  });

  it('offers a failed refund with revoked tickets for recovery and sends it without a new quote', async () => {
    const user = userEvent.setup();
    const onRefund = vi.fn();
    mockRefundPreview({
      reservationId: 'reservation-1',
      cancellationQuote: QUOTE,
      refundableAmount: 120000,
      canRequestRefund: false,
      adminRecoveryAvailable: true,
      adminRecoveryReason: 'RETRY_EXHAUSTED · 은행 응답 지연',
      blockedReason: null,
    });

    renderModal(<AdminBookingDetailModal open onOpenChange={vi.fn()} bookingId="reservation-1" onRefund={onRefund} isRefunding={false} />);
    await user.click(screen.getByRole('button', { name: '환불 처리' }));
    await user.type(screen.getByPlaceholderText('환불 사유를 입력하세요'), '운영 재처리');

    expect(await screen.findByText('이전 환불 재조정')).toBeInTheDocument();
    expect(screen.getByText('저장된 환불 금액')).toBeInTheDocument();
    expect(screen.getByText(/이전 실패 기록: RETRY_EXHAUSTED · 은행 응답 지연/)).toBeInTheDocument();
    expect(screen.getByText(/요청을 멈춥니다\(409\)/)).toBeInTheDocument();
    expect(screen.queryByText(/이미 환불이 진행 중/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Fee overrides belong to a new quote; the recovery resends the stored one.
    expect(screen.queryByRole('checkbox', { name: '수수료 없이 전액 환불' })).not.toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: '환불 확인' });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onRefund).toHaveBeenCalledWith('reservation-1', '운영 재처리', {
      fullRefundOverride: false,
      enteredTicketOverride: false,
    });
  });

  it('keeps a refund still in progress at the PG blocked', async () => {
    const user = userEvent.setup();
    const onRefund = vi.fn();
    mockRefundPreview({
      reservationId: 'reservation-1',
      cancellationQuote: QUOTE,
      refundableAmount: 120000,
      canRequestRefund: false,
      adminRecoveryAvailable: false,
      blockedReason: '이미 환불이 결제사에서 진행 중입니다. 자동 재확인 결과를 기다리거나 예매 상세에서 환불 상태를 확인해주세요.',
    });

    renderModal(<AdminBookingDetailModal open onOpenChange={vi.fn()} bookingId="reservation-1" onRefund={onRefund} isRefunding={false} />);
    await user.click(screen.getByRole('button', { name: '환불 처리' }));
    await user.type(screen.getByPlaceholderText('환불 사유를 입력하세요'), '운영 환불');

    expect(await screen.findByRole('alert')).toHaveTextContent('이미 환불이 결제사에서 진행 중입니다');
    expect(screen.queryByText('이전 환불 재조정')).not.toBeInTheDocument();
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
