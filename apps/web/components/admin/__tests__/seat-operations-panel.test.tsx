import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';

import { AdminBookingDetailModal } from '../admin-booking-detail-modal';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  bookingDetail: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mocks.apiGet,
    post: mocks.apiPost,
  },
}));

vi.mock('@/hooks/use-reservations', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/hooks/use-reservations')>();

  return {
    ...actual,
    useAdminBookingDetail: mocks.bookingDetail,
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithClient(ui: ReactNode, queryClient = createQueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );

  return { queryClient };
}

function cancelledBooking({
  reopenState = 'AVAILABLE',
}: {
  reopenState?: 'HELD_CANCELLED' | 'AVAILABLE';
} = {}) {
  return {
    id: 'reservation-1',
    reservationNumber: 'R-20260514-001',
    userName: '김운영',
    userPhone: '+821012345678',
    userEmail: 'operator-buyer@example.com',
    userCountry: 'KR',
    performanceTitle: '걸룰스 팬미팅',
    showDateTime: '2026-07-18T10:00:00.000Z',
    seats: [
      {
        seatId: 'A-10',
        seatKey: '1F:A-10',
        floorKey: '1F',
        floorLabel: '1층',
        tierName: 'VIP',
        price: 120000,
        row: 'A',
        number: '10',
      },
    ],
    totalAmount: 120000,
    status: 'CANCELLED' as const,
    funnelStatus: 'CANCELLED' as const,
    paymentStatus: 'CANCELED' as const,
    paymentMethod: 'CARD',
    paymentFailureDiagnostic: null,
    paymentMethodAttribution: {
      label: '카드 / 카드사 / KRW',
      method: 'CARD',
      provider: 'CARD',
      currency: 'KRW',
      source: 'DB',
    },
    ticketStatusCounts: {
      ACTIVE: 0,
      CANCELLATION_PENDING: 0,
      CANCELLED: 1,
      EXPIRED: 0,
    },
    createdAt: '2026-05-14T01:00:00.000Z',
    paymentInfo: {
      paymentKey: 'payment-1',
      method: 'CARD',
      amount: 120000,
      status: 'CANCELED' as const,
      paidAt: '2026-05-14T01:05:00.000Z',
    },
    ticketItems: [
      {
        id: 'ticket-item-a10',
        reservationId: 'reservation-1',
        paymentId: 'payment-1',
        showtimeId: 'showtime-1',
        seatId: 'A-10',
        seatKey: '1F:A-10',
        floorKey: '1F',
        floorLabel: '1층',
        tierName: 'VIP',
        price: 120000,
        row: 'A',
        number: '10',
        serviceFee: 2000,
        status: 'CANCELLED' as const,
        admissionState: 'NOT_ENTERED' as const,
        enteredAt: null,
        cancelledAt: '2026-05-14T01:10:00.000Z',
        cancelReason: '일정 변경',
        cancellationFee: 0,
        serviceFeeRefund: 2000,
        refundableAmount: 122000,
        reopenState,
        reopenHoldUntil: null,
      },
    ],
  };
}

describe('Admin seat operations UI', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: () => false,
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: () => {},
      configurable: true,
    });
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  });

  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    mocks.bookingDetail.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
  });

  it('keeps immediate cancelled-seat open inside AdminBookingDetailModal and invalidates booking plus seat-operation queries', async () => {
    const user = userEvent.setup();
    mocks.bookingDetail.mockReturnValue({
      data: cancelledBooking({ reopenState: 'HELD_CANCELLED' }),
      isLoading: false,
    });
    mocks.apiPost.mockResolvedValueOnce({ message: '좌석이 즉시 오픈되었습니다' });

    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderWithClient(
      <AdminBookingDetailModal
        open
        onOpenChange={vi.fn()}
        bookingId="reservation-1"
        onRefund={vi.fn()}
        isRefunding={false}
      />,
      queryClient,
    );

    await user.click(
      screen.getByRole('button', { name: '취소 좌석 즉시 개방' }),
    );

    expect(
      screen.getByRole('heading', {
        name: '이 취소 좌석을 지금 즉시 개방하시겠습니까?',
      }),
    ).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', {
      name: '즉시 개방 확인',
    });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText('즉시 개방 사유'), '취소 입금 확인');
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/admin/bookings/reservation-1/manual-open',
        {
          reason: '취소 입금 확인',
          confirmed: true,
        },
      );
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['admin', 'bookings'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['admin', 'seat-operations'],
      });
    });
  });

  it('shows ticket item status, admission, refund, and reopen fields in admin booking detail', () => {
    mocks.bookingDetail.mockReturnValue({
      data: cancelledBooking(),
      isLoading: false,
    });

    renderWithClient(
      <AdminBookingDetailModal
        open
        onOpenChange={vi.fn()}
        bookingId="reservation-1"
        onRefund={vi.fn()}
        isRefunding={false}
      />,
    );

    const table = screen.getByRole('table', { name: 'ticket item status' });
    expect(within(table).getByText('VIP A열 10번')).toBeInTheDocument();
    expect(within(table).getByText('취소됨')).toBeInTheDocument();
    expect(within(table).getByText('입장 전')).toBeInTheDocument();
    expect(within(table).getByText('122,000원')).toBeInTheDocument();
    expect(within(table).getByText('판매 가능')).toBeInTheDocument();
    expect(within(table).queryByText('CANCELLED')).not.toBeInTheDocument();
    expect(within(table).queryByText('NOT_ENTERED')).not.toBeInTheDocument();
    expect(within(table).queryByText('AVAILABLE')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '취소 좌석 즉시 개방' }),
    ).not.toBeInTheDocument();
  });

  it('labels refund payment method without raw enum text', async () => {
    const user = userEvent.setup();
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
        adminCapabilities: ['refund.admin_refund'],
        accountStatus: 'active',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      isInitialized: true,
    });
    mocks.bookingDetail.mockReturnValue({
      data: {
        ...cancelledBooking(),
        status: 'CONFIRMED' as const,
        funnelStatus: 'SOLD' as const,
        paymentStatus: 'DONE' as const,
      },
      isLoading: false,
    });

    renderWithClient(
      <AdminBookingDetailModal
        open
        onOpenChange={vi.fn()}
        bookingId="reservation-1"
        onRefund={vi.fn()}
        isRefunding={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: '환불 처리' }));

    expect(screen.getByText('카드 / 카드사 / KRW 결제 취소')).toBeInTheDocument();
    expect(screen.queryByText('CARD으로 환불')).not.toBeInTheDocument();
  });

  it('supports disable, reactivate, and history with reasoned confirmation in SeatOperationsPanel', async () => {
    const user = userEvent.setup();
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    mocks.apiGet.mockResolvedValue({
      rows: [
        {
          id: 'history-1',
          operation: 'seat.disable',
          showtimeId: '00000000-0000-4000-8000-000000000001',
          seatKey: '1F:A-10',
          previousStatus: 'available',
          nextStatus: 'disabled',
          reason: '시야 제한',
          actorUserId: 'admin-1',
          auditEventId: 'audit-1',
          createdAt: '2026-05-14T02:00:00.000Z',
        },
      ],
    });
    mocks.apiPost
      .mockResolvedValueOnce({
        id: 'history-2',
        operation: 'seat.disable',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        seatKey: '1F:A-10',
        previousStatus: 'available',
        nextStatus: 'disabled',
        reason: '시야 불량',
        actorUserId: 'admin-1',
        auditEventId: 'audit-2',
        createdAt: '2026-05-14T02:10:00.000Z',
      })
      .mockResolvedValueOnce({
        id: 'history-3',
        operation: 'seat.reactivate',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        seatKey: '1F:A-10',
        previousStatus: 'disabled',
        nextStatus: 'available',
        reason: '시야 제한 해소',
        actorUserId: 'admin-1',
        auditEventId: 'audit-3',
        createdAt: '2026-05-14T02:20:00.000Z',
      });

    const { SeatOperationsPanel } = await import('../seat-operations-panel');
    renderWithClient(
      <SeatOperationsPanel
        initialShowtimeId="00000000-0000-4000-8000-000000000001"
        initialSeatKey="1F:A-10"
      />,
      queryClient,
    );

    await screen.findByText('시야 제한');
    expect(apiClient.get).toHaveBeenCalledWith(
      '/api/v1/admin/seat-operations/history?showtimeId=00000000-0000-4000-8000-000000000001&seatKey=1F%3AA-10&limit=50',
    );

    await user.click(screen.getByRole('button', { name: '좌석 비활성화' }));
    expect(
      screen.getByRole('heading', { name: '좌석 비활성화' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '이 좌석을 비활성화하면 판매 가능 수량이 즉시 변경됩니다. 사유를 입력하고 변경 내용을 확인한 뒤 진행하세요.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '비활성화 확인' })).toBeDisabled();
    await user.type(screen.getByLabelText('좌석 운영 사유'), '시야 불량');
    await user.click(screen.getByRole('button', { name: '비활성화 확인' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/admin/seat-operations/disable',
        {
          showtimeId: '00000000-0000-4000-8000-000000000001',
          seatKey: '1F:A-10',
          reason: '시야 불량',
          confirmed: true,
        },
      );
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['admin', 'bookings'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['admin', 'seat-operations'],
      });
    });

    await user.click(screen.getByRole('button', { name: '좌석 재활성화' }));
    expect(
      screen.getByRole('heading', {
        name: '좌석을 다시 판매 가능 상태로 변경하시겠습니까?',
      }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('좌석 운영 사유'), '시야 제한 해소');
    await user.click(screen.getByRole('button', { name: '재활성화 확인' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/admin/seat-operations/reactivate',
        {
          showtimeId: '00000000-0000-4000-8000-000000000001',
          seatKey: '1F:A-10',
          reason: '시야 제한 해소',
          confirmed: true,
        },
      );
    });

    const historyRow = screen.getByTestId('seat-operation-history-row-history-1');
    expect(
      within(historyRow).getByText('available -> disabled'),
    ).toBeInTheDocument();
  });
});
