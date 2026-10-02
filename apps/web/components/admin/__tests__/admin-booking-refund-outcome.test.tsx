import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import type { AdminBookingListItem, AdminRefundResult, RefundPreviewResponse } from '@grabit/shared';

import { AdminBookingDashboard } from '../admin-booking-dashboard';
import { useAuthStore } from '@/stores/use-auth-store';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('../admin-event-context', () => ({ useAdminEventContext: () => null }));
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mocks.apiGet, post: mocks.apiPost },
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/admin/reservation-export-panel', () => ({
  ReservationExportPanel: () => null,
}));

function bookingItem(): AdminBookingListItem {
  return {
    id: BOOKING_ID,
    reservationNumber: 'GRP-24006',
    tossOrderId: 'GRP-TOSS-ORDER-24006',
    userName: '김예매',
    userEmail: 'buyer@example.com',
    userCountry: 'KR',
    performanceTitle: 'Girl Rules Fanmeet',
    showDateTime: '2026-07-18T10:00:00.000Z',
    seats: [{
      seatId: 'A-1', floorKey: '1F', floorLabel: '1층', seatKey: '1F:A-1',
      tierName: 'VIP', price: 50000, row: 'A', number: '1',
    }],
    totalAmount: 52000,
    status: 'CONFIRMED',
    funnelStatus: 'SOLD',
    paymentStatus: 'DONE',
    paymentMethod: 'CARD',
    paymentFailureBucket: null,
    paymentFailureDiagnostic: null,
    paymentMethodAttribution: { label: '카드', method: 'CARD', provider: 'CARD', currency: 'KRW', source: 'DB' },
    ticketStatusCounts: { ACTIVE: 1, CANCELLATION_PENDING: 0, CANCELLED: 0, EXPIRED: 0 },
    createdAt: '2026-05-08T11:45:00.000Z',
  };
}

function bookingDetail() {
  return {
    ...bookingItem(),
    userPhone: '+821012345678',
    paymentAttemptedAt: '2026-05-08T11:46:00.000Z',
    paymentCompletedAt: '2026-05-08T11:47:00.000Z',
    paymentInfo: { paymentKey: 'payment-key-1', method: 'CARD', amount: 52000, status: 'DONE', paidAt: '2026-05-08T11:47:00.000Z' },
    ticketItems: [],
  };
}

function refundPreview(overrides: Partial<RefundPreviewResponse> = {}): RefundPreviewResponse {
  return {
    reservationId: BOOKING_ID,
    reservationNumber: 'GRP-24006',
    paymentKey: 'payment-key-1',
    refundableAmount: 48000,
    canRequestRefund: true,
    cancelledSeatHoldWindowMinutes: { min: 1, max: 10 },
    refundTimeline: null,
    cancellationQuote: {
      originalPaymentAmount: 52000,
      ticketSubtotal: 50000,
      ticketServiceFeeTotal: 2000,
      cancellationFeeTotal: 4000,
      serviceFeeRefundTotal: 0,
      refundableAmount: 48000,
      policyCodes: ['BOOKING_DAY_8_TO_SHOW_DAY_10'],
      items: [],
    },
    providerRefund: { currency: 'KRW', amountMinor: 48000, amountDecimal: '48000' },
    blockedReason: null,
    ...overrides,
  };
}

function refundResult(overrides: Partial<AdminRefundResult>): AdminRefundResult {
  return {
    outcome: 'completed',
    message: '환불이 완료되었습니다',
    currentState: 'COMPLETED',
    idempotent: false,
    retryEnqueued: false,
    refundableAmount: 48000,
    refundTimeline: null,
    providerRefund: null,
    ...overrides,
  };
}

let previewResponse: RefundPreviewResponse;

function renderDashboard(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

async function openRefundForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /김예매 Girl Rules Fanmeet 예매 상세 보기/ }));
  const dialog = await screen.findByRole('dialog');
  await user.click(await within(dialog).findByRole('button', { name: '환불 처리' }));
  await user.type(within(dialog).getByLabelText('환불 사유'), '고객 요청');
  return dialog;
}

describe('AdminBookingDashboard refund outcome', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: () => {}, configurable: true });
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  });

  beforeEach(() => {
    vi.clearAllMocks();
    previewResponse = refundPreview();
    useAuthStore.setState({
      accessToken: 'admin-token',
      user: {
        id: 'admin-1',
        email: 'admin@grapit.test',
        name: '관리자',
        phone: '+821012345678',
        gender: 'unspecified',
        country: 'KR',
        birthDate: '1990-01-01',
        preferredLocale: 'ko',
        isEmailVerified: true,
        isPhoneVerified: true,
        marketingConsent: false,
        role: 'admin',
        adminCapabilityBundle: null,
        adminCapabilities: ['refund.admin_refund', 'reservations.read'],
        accountStatus: 'active',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      isInitialized: true,
    });
    mocks.apiGet.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.endsWith('/support-evidence')) {
        return { generatedAt: '2026-09-21T00:00:00.000Z', originalOrderAmount: 52000, provider: null, refundTimeline: null, refundProviderAmount: null, rights: { seatStatesKnown: true, activeSeats: 1, cancelledSeats: 0, pendingSeats: 0, enteredSeats: 0, benefits: [] }, delivery: { lastSentAt: null, scheduledAt: null, inboxReceipt: 'unverified', history: [] } };
      }
      if (path.includes(`/api/v1/admin/bookings/${BOOKING_ID}/refund-preview`)) return previewResponse;
      if (path.includes(`/api/v1/admin/bookings/${BOOKING_ID}`)) return bookingDetail();
      if (path.includes('/api/v1/admin/performances')) {
        return { data: [], total: 0, page: 1, limit: 200, totalPages: 1 };
      }
      return {
        bookings: [bookingItem()],
        stats: {
          totalBookings: 1, totalRevenue: 52000, cancelRate: 0, soldCount: 1, pendingPaymentCount: 0,
          paymentProcessingCount: 0, failedCount: 0, cancelProcessingCount: 0, cancelledCount: 0,
          partialCancelledCount: 0, completedRevenue: 52000,
        },
        tierStats: [],
        total: 1,
      };
    });
  });

  it('sends the previewed amounts and keeps the modal open when the PG rejects the refund', async () => {
    const user = userEvent.setup();
    mocks.apiPost.mockResolvedValue(refundResult({
      outcome: 'rights_restored',
      currentState: 'FAILED',
      message: '결제사가 환불을 거절했습니다. 티켓과 결제는 유지되며, 결제 상태를 확인한 뒤 다시 시도해주세요',
    }));
    renderDashboard(<AdminBookingDashboard />);

    const dialog = await openRefundForm(user);
    await waitFor(() => expect(within(dialog).getByText('48,000원')).toBeInTheDocument());
    await user.click(within(dialog).getByRole('button', { name: '환불 확인' }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1));
    expect(mocks.apiPost).toHaveBeenCalledWith(
      `/api/v1/admin/bookings/${BOOKING_ID}/refund`,
      expect.objectContaining({
        reason: '고객 요청',
        expectedRefundableAmount: 48000,
        expectedProviderRefundAmountMinor: 48000,
      }),
      { showErrorToast: false },
    );
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      expect.stringContaining('결제사가 환불을 거절했습니다'),
    ));
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes the modal and reports completion only for a completed refund', async () => {
    const user = userEvent.setup();
    mocks.apiPost.mockResolvedValue(refundResult({}));
    renderDashboard(<AdminBookingDashboard />);

    const dialog = await openRefundForm(user);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '환불 확인' })).toBeEnabled());
    await user.click(within(dialog).getByRole('button', { name: '환불 확인' }));

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('환불이 완료되었습니다'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('reports a PG refund still in progress as processing, not as completed', async () => {
    const user = userEvent.setup();
    mocks.apiPost.mockResolvedValue(refundResult({
      outcome: 'processing',
      currentState: 'SENT_TO_PG',
      retryEnqueued: true,
      message: '결제사에서 환불을 처리 중입니다. 자동으로 다시 확인합니다',
    }));
    renderDashboard(<AdminBookingDashboard />);

    const dialog = await openRefundForm(user);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '환불 확인' })).toBeEnabled());
    await user.click(within(dialog).getByRole('button', { name: '환불 확인' }));

    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(
      '결제사에서 환불을 처리 중입니다. 자동으로 다시 확인합니다',
    ));
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it('shows the server conflict and re-reads the quote when the refund amount changed', async () => {
    const user = userEvent.setup();
    mocks.apiPost.mockRejectedValue(new Error('환불 금액이 변경되었습니다. 견적을 다시 확인해주세요.'));
    renderDashboard(<AdminBookingDashboard />);

    const dialog = await openRefundForm(user);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '환불 확인' })).toBeEnabled());
    const previewCalls = () => mocks.apiGet.mock.calls
      .filter(([url]) => String(url).includes('/refund-preview')).length;
    const before = previewCalls();
    previewResponse = refundPreview({
      refundableAmount: 46000,
      cancellationQuote: { ...refundPreview().cancellationQuote!, refundableAmount: 46000 },
    });
    await user.click(within(dialog).getByRole('button', { name: '환불 확인' }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      '환불 금액이 변경되었습니다. 견적을 다시 확인해주세요.',
    ));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(previewCalls()).toBeGreaterThan(before));
    expect(await within(dialog).findByText('46,000원')).toBeInTheDocument();
  });

  it('blocks confirmation and shows why when the server preview is not requestable', async () => {
    const user = userEvent.setup();
    previewResponse = refundPreview({
      canRequestRefund: false,
      blockedReason: '결제사 환불 잔액이 예매 기록과 다릅니다. 결제사 취소 내역을 먼저 확인해주세요.',
    });
    renderDashboard(<AdminBookingDashboard />);

    const dialog = await openRefundForm(user);

    expect(await within(dialog).findByText(/결제사 환불 잔액이 예매 기록과 다릅니다/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '환불 확인' })).toBeDisabled();
  });

  it('shows the narrowing hint and does not re-run a booking list the server timed out', async () => {
    const timeoutMessage = '조회 범위가 넓어 제한 시간 안에 예매를 집계하지 못했습니다. 공연·회차나 기간을 선택해 범위를 좁혀주세요';
    const listCalls = () => mocks.apiGet.mock.calls
      .filter(([url]) => String(url).includes('/api/v1/admin/bookings?')).length;
    const fallback = mocks.apiGet.getMockImplementation()!;
    mocks.apiGet.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/v1/admin/bookings?')) {
        throw Object.assign(new Error(timeoutMessage), { statusCode: 503 });
      }
      return fallback(url);
    });
    renderDashboard(<AdminBookingDashboard />);

    expect(await screen.findByText(timeoutMessage)).toBeInTheDocument();
    expect(screen.getByText(/예매를 조회하지 못했습니다/)).toBeInTheDocument();
    expect(listCalls()).toBe(1);
  });

  it('shows the USD amount the PG will refund for overseas card payments', async () => {
    const user = userEvent.setup();
    previewResponse = refundPreview({
      providerRefund: { currency: 'USD', amountMinor: 3536, amountDecimal: '35.36' },
    });
    mocks.apiPost.mockResolvedValue(refundResult({}));
    renderDashboard(<AdminBookingDashboard />);

    const dialog = await openRefundForm(user);

    expect(await within(dialog).findByText('USD 35.36')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '환불 확인' })).toBeEnabled());
    await user.click(within(dialog).getByRole('button', { name: '환불 확인' }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ expectedProviderRefundAmountMinor: 3536 }),
      { showErrorToast: false },
    ));
  });
});
