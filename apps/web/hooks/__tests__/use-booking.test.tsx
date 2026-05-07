import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { useConfirmPayment, useLockSeat, usePrepareReservation } from '../use-booking';
import { ApiClientError, apiClient } from '@/lib/api-client';
import type { ConfirmPaymentRequest, PrepareReservationRequest } from '@grabit/shared';

const { postMock, runtimeFlagsMock, ApiClientErrorMock } = vi.hoisted(() => {
  class ApiClientError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
    }
  }

  return {
    postMock: vi.fn(),
    runtimeFlagsMock: vi.fn(() => ({
      bookingEnabled: true,
      isLoading: false,
      bookingDisabledMessage: '예매는 5월말 오픈 예정입니다',
    })),
    ApiClientErrorMock: ApiClientError,
  };
});

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: postMock,
  },
  ApiClientError: ApiClientErrorMock,
}));

vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: runtimeFlagsMock,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

function bookingConsentItems(): PrepareReservationRequest['consentItems'] {
  return [
    'terms',
    'privacy',
    'pipa_required',
    'cross_border_transfer',
    'pdpa_notice',
    'pipl_notice',
  ].map((key) => ({
    key: key as PrepareReservationRequest['consentItems'][number]['key'],
    version: '2026-04-28',
    language: 'ko',
    accepted: true,
    sourceFlow: 'booking' as const,
  }));
}

describe('use-booking payment mutations', () => {
  beforeEach(() => {
    postMock.mockReset();
    runtimeFlagsMock.mockReset();
    runtimeFlagsMock.mockReturnValue({
      bookingEnabled: true,
      isLoading: false,
      bookingDisabledMessage: '예매는 5월말 오픈 예정입니다',
    });
  });

  it('usePrepareReservation() calls /api/v1/reservations/prepare with payload', async () => {
    const payload: PrepareReservationRequest = {
      orderId: 'GRP-LOCK-TEST',
      showtimeId: 'showtime-lock-test',
      seats: [{ seatId: 'A-1', tierName: 'VIP', price: 50000, row: 'A', number: '1' }],
      amount: 50000,
      consentItems: bookingConsentItems(),
    };
    postMock.mockResolvedValueOnce({ reservationId: 'reservation-lock-test', orderId: payload.orderId });

    const { result } = renderHook(() => usePrepareReservation(), {
      wrapper: createWrapper(),
    });

    await expect(result.current.mutateAsync(payload)).resolves.toEqual({
      reservationId: 'reservation-lock-test',
      orderId: payload.orderId,
    });
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/reservations/prepare', payload, {
      showErrorToast: false,
    });
  });

  it('useConfirmPayment() calls /api/v1/payments/confirm with payload', async () => {
    const payload: ConfirmPaymentRequest = {
      paymentKey: 'test_payment_key',
      orderId: 'GRP-LOCK-CONFIRM',
      amount: 50000,
    };
    postMock.mockResolvedValueOnce({
      id: 'reservation-lock-test',
      reservationNumber: 'GRP-LOCK-CONFIRM',
      status: 'CONFIRMED',
      performanceTitle: '락 테스트 공연',
      posterUrl: null,
      showDateTime: new Date().toISOString(),
      venue: '락 테스트 극장',
      seats: [{ seatId: 'A-1', tierName: 'VIP', price: 50000, row: 'A', number: '1' }],
      totalAmount: 50000,
      createdAt: new Date().toISOString(),
      paymentMethod: 'card',
      paidAt: new Date().toISOString(),
      cancelDeadline: new Date().toISOString(),
      cancelledAt: null,
      cancelReason: null,
      paymentKey: payload.paymentKey,
    });

    const { result } = renderHook(() => useConfirmPayment(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync(payload);
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/payments/confirm', payload, {
      showErrorToast: false,
    });
  });

  it('keeps ApiClientError 409 lock-expired message as the mutation error', async () => {
    const payload: PrepareReservationRequest = {
      orderId: 'GRP-LOCK-EXPIRED',
      showtimeId: 'showtime-lock-test',
      seats: [{ seatId: 'A-1', tierName: 'VIP', price: 50000, row: 'A', number: '1' }],
      amount: 50000,
      consentItems: bookingConsentItems(),
    };
    const error = new ApiClientError(
      '좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.',
      409,
    );
    postMock.mockRejectedValueOnce(error);

    const { result } = renderHook(() => usePrepareReservation(), {
      wrapper: createWrapper(),
    });

    await expect(result.current.mutateAsync(payload)).rejects.toMatchObject({
      message: '좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.',
      statusCode: 409,
    });
  });

  it('keeps ApiClientError 409 other-owner message as the confirm mutation error', async () => {
    const payload: ConfirmPaymentRequest = {
      paymentKey: 'test_payment_key_other_owner',
      orderId: 'GRP-LOCK-OTHER-OWNER',
      amount: 50000,
    };
    const error = new ApiClientError(
      '이미 다른 사용자가 선택한 좌석입니다.',
      409,
    );
    postMock.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useConfirmPayment(), {
      wrapper: createWrapper(),
    });

    await expect(result.current.mutateAsync(payload)).rejects.toMatchObject({
      message: '이미 다른 사용자가 선택한 좌석입니다.',
      statusCode: 409,
    });
  });

  it('does not call lockSeat API when runtime booking is disabled', async () => {
    runtimeFlagsMock.mockReturnValue({
      bookingEnabled: false,
      isLoading: false,
      bookingDisabledMessage: '예매는 5월말 오픈 예정입니다',
    });

    const { result } = renderHook(() => useLockSeat(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        showtimeId: 'showtime-disabled',
        seatId: 'A-1',
      }),
    ).rejects.toMatchObject({
      message: '예매는 5월말 오픈 예정입니다',
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('does not call prepare reservation API when runtime booking is disabled', async () => {
    runtimeFlagsMock.mockReturnValue({
      bookingEnabled: false,
      isLoading: false,
      bookingDisabledMessage: '예매는 5월말 오픈 예정입니다',
    });
    const payload: PrepareReservationRequest = {
      orderId: 'GRP-DISABLED-PREPARE',
      showtimeId: 'showtime-disabled',
      seats: [{ seatId: 'A-1', tierName: 'VIP', price: 50000, row: 'A', number: '1' }],
      amount: 50000,
      consentItems: bookingConsentItems(),
    };

    const { result } = renderHook(() => usePrepareReservation(), {
      wrapper: createWrapper(),
    });

    await expect(result.current.mutateAsync(payload)).rejects.toMatchObject({
      message: '예매는 5월말 오픈 예정입니다',
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
