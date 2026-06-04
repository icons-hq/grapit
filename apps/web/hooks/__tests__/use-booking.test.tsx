import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import {
  useBookingPaymentSnapshot,
  useConfirmPayment,
  useLockSeat,
  usePrepareReservation,
  useUnlockSeat,
} from '../use-booking';
import { ApiClientError, apiClient } from '@/lib/api-client';
import { buildConfirmPaymentPayload } from '@/lib/booking/payment-return';
import {
  buildDirectCardPaymentRequest,
  buildWidgetPaymentRequest,
  resolveProviderChargeDisabledMessage,
  resolvePaymentWidgetVariantLabel,
  resolvePaymentWidgetRenderVariantKey,
  resolvePaymentWidgetClientKey,
  resolvePaymentRequestAmount,
  resolvePaymentWidgetRenderAmount,
  resolvePaymentMethodSelection,
  resolvePaymentWidgetVariantKey,
  resolvePaymentWidgetVariantKeys,
} from '@/components/booking/toss-payment-widget';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';
import type {
  ConfirmPaymentRequest,
  FloorAwareSeatSelection,
  PerformanceWithDetails,
  PrepareReservationRequest,
} from '@grabit/shared';

const { postMock, deleteMock, runtimeFlagsMock, ApiClientErrorMock } = vi.hoisted(() => {
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
    deleteMock: vi.fn(),
    runtimeFlagsMock: vi.fn(() => ({
      bookingEnabled: true,
      isLoading: false,
      bookingDisabledMessage: '예매는 추후 오픈 예정입니다',
    })),
    ApiClientErrorMock: ApiClientError,
  };
});

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: postMock,
    delete: deleteMock,
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

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  return { Wrapper, queryClient };
}

function bookingConsentItems(): PrepareReservationRequest['consentItems'] {
  return [
    'terms',
    'privacy',
    'pipa_required',
  ].map((key) => ({
    key: key as PrepareReservationRequest['consentItems'][number]['key'],
    version: '2026-04-28',
    language: 'ko',
    accepted: true,
    sourceFlow: 'booking' as const,
  }));
}

function createQueueAdmission(orderId: string) {
  const now = '2026-05-08T10:00:00.000Z';

  return {
    queueSessionId: `queue-${orderId}`,
    admissionToken: `token-${orderId}`,
    refreshFamilyId: 'user-1',
    deviceSlotKey: 'device-1',
    admittedAt: now,
    activeUntilAt: now,
    reentryGraceUntilAt: now,
  };
}

function setAdminAuth() {
  useAuthStore.getState().setAuth('admin-token', {
    id: 'admin-1',
    email: 'admin@grapit.test',
    name: 'Admin',
    phone: '+821012345678',
    gender: 'unspecified',
    country: 'KR',
    birthDate: '1990-01-01',
    preferredLocale: 'ko',
    isEmailVerified: true,
    isPhoneVerified: true,
    marketingConsent: false,
    role: 'admin',
    createdAt: '2026-05-06T00:00:00.000Z',
  });
}

function createPaymentMethod(): PrepareReservationRequest['paymentMethod'] {
  return {
    method: 'CARD',
    provider: 'CARD',
    currency: 'KRW',
  };
}

function createFloorAwareSeat(
  overrides: Partial<FloorAwareSeatSelection> = {},
): FloorAwareSeatSelection {
  const floorKey = overrides.floorKey ?? '1F';
  const seatId = overrides.seatId ?? 'A-1';

  return {
    seatId,
    tierName: overrides.tierName ?? 'VIP',
    tierColor: overrides.tierColor ?? '#6C3CE0',
    price: overrides.price ?? 50000,
    row: overrides.row ?? 'A',
    number: overrides.number ?? '1',
    floorKey,
    floorLabel: overrides.floorLabel ?? (floorKey === '2F' ? '2층' : '1층'),
    seatKey: overrides.seatKey ?? `${floorKey}:${seatId}`,
  };
}

function createPrepareReservationPayload(
  overrides: Partial<PrepareReservationRequest> = {},
): PrepareReservationRequest {
  const orderId = overrides.orderId ?? 'GRP-LOCK-TEST';

  return {
    orderId,
    showtimeId: overrides.showtimeId ?? 'showtime-lock-test',
    seats: overrides.seats ?? [createFloorAwareSeat()],
    amount: overrides.amount ?? 50000,
    consentItems: overrides.consentItems ?? bookingConsentItems(),
    queueAdmission: overrides.queueAdmission ?? createQueueAdmission(orderId),
    paymentDeadlineAt: overrides.paymentDeadlineAt ?? '2026-05-08T10:10:00.000Z',
    bookingPolicy: overrides.bookingPolicy ?? {
      maxTicketsPerOrder: 4,
      cancellationChangePolicy: 'CANCEL_ONLY',
      sameGradeChangeEnabled: false,
      paymentWindowMinutes: 10,
    },
    paymentMethod: overrides.paymentMethod ?? createPaymentMethod(),
  };
}

function createPerformanceDetail(
  overrides: Partial<PerformanceWithDetails> = {},
): PerformanceWithDetails {
  return {
    id: overrides.id ?? 'performance-1',
    title: overrides.title ?? '락 테스트 공연',
    genre: overrides.genre ?? 'artist_celebrity',
    subcategory: overrides.subcategory ?? null,
    venueId: overrides.venueId ?? null,
    posterUrl: overrides.posterUrl ?? null,
    description: overrides.description ?? null,
    descriptionVisible: overrides.descriptionVisible ?? true,
    startDate: overrides.startDate ?? '2026-07-18T00:00:00.000Z',
    endDate: overrides.endDate ?? '2026-07-18T00:00:00.000Z',
    runtime: overrides.runtime ?? null,
    ageRating: overrides.ageRating ?? '전체관람가',
    status: overrides.status ?? 'selling',
    salesInfo: overrides.salesInfo ?? null,
    salesInfoVisible: overrides.salesInfoVisible ?? true,
    viewCount: overrides.viewCount ?? 0,
    createdAt: overrides.createdAt ?? '2026-05-08T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-08T00:00:00.000Z',
    venue: overrides.venue ?? null,
    priceTiers: overrides.priceTiers ?? [],
    showtimes: overrides.showtimes ?? [],
    castings: overrides.castings ?? [],
    seatMaps: overrides.seatMaps ?? [],
    bookingPolicy: overrides.bookingPolicy ?? {
      maxTicketsPerUser: 1,
      allowedPaymentMethods: ['CARD'],
      changePolicyEnabled: false,
      paymentWindowMinutes: 7,
      seatHoldMinutes: 10,
      cancelledSeatHoldMinMinutes: 1,
      cancelledSeatHoldMaxMinutes: 10,
      manualOpenEnabled: true,
    },
    seatMap: overrides.seatMap ?? null,
  };
}

describe('use-booking payment mutations', () => {
  beforeEach(() => {
    postMock.mockReset();
    deleteMock.mockReset();
    runtimeFlagsMock.mockReset();
    runtimeFlagsMock.mockReturnValue({
      bookingEnabled: true,
      isLoading: false,
      bookingDisabledMessage: '예매는 추후 오픈 예정입니다',
    });
    useBookingStore.getState().resetBooking();
    useAuthStore.getState().clearAuth();
  });

  it('usePrepareReservation() calls /api/v1/reservations/prepare with payload', async () => {
    const payload = createPrepareReservationPayload();
    postMock.mockResolvedValueOnce({
      reservationId: 'reservation-lock-test',
      orderId: payload.orderId,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => usePrepareReservation(), {
      wrapper: Wrapper,
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
      seats: [createFloorAwareSeat()],
      totalAmount: 50000,
      createdAt: new Date().toISOString(),
      paymentMethod: 'card',
      paidAt: new Date().toISOString(),
      cancelDeadline: new Date().toISOString(),
      cancelledAt: null,
      cancelReason: null,
      paymentKey: payload.paymentKey,
      queueAdmission: createQueueAdmission(payload.orderId),
      paymentDeadlineAt: new Date().toISOString(),
      bookingPolicy: {
        maxTicketsPerOrder: 1,
        cancellationChangePolicy: 'CANCEL_ONLY',
        sameGradeChangeEnabled: false,
      },
      refundTimeline: {
        currentState: 'REQUESTED',
        requestedAt: new Date().toISOString(),
        customerServiceCtaVisible: false,
      },
      cancelledSeatHold: null,
      qrTicket: {
        token: 'qr-token',
        jti: 'qr-jti',
        status: 'ACTIVE',
        issuedAt: new Date().toISOString(),
      },
    });

    const { result } = renderHook(() => useConfirmPayment(), {
      wrapper: createWrapper().Wrapper,
    });

    await result.current.mutateAsync(payload);
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/payments/confirm', payload, {
      showErrorToast: false,
    });
  });

  it('keeps ApiClientError 409 lock-expired message as the mutation error', async () => {
    const payload = createPrepareReservationPayload({
      orderId: 'GRP-LOCK-EXPIRED',
    });
    const error = new ApiClientError(
      '좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.',
      409,
    );
    postMock.mockRejectedValueOnce(error);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => usePrepareReservation(), {
      wrapper: Wrapper,
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
      wrapper: createWrapper().Wrapper,
    });

    await expect(result.current.mutateAsync(payload)).rejects.toMatchObject({
      message: '이미 다른 사용자가 선택한 좌석입니다.',
      statusCode: 409,
    });
  });

  it('allows payment confirm to reach server when runtime booking is disabled', async () => {
    runtimeFlagsMock.mockReturnValue({
      bookingEnabled: false,
      isLoading: false,
      bookingDisabledMessage: '예매는 추후 오픈 예정입니다',
    });
    const payload: ConfirmPaymentRequest = {
      paymentKey: 'test_payment_key_confirm_disabled',
      orderId: 'GRP-CONFIRM-DISABLED',
      amount: 50000,
    };
    postMock.mockResolvedValueOnce({
      id: 'reservation-confirm-disabled',
      status: 'CONFIRMED',
    });

    const { result } = renderHook(() => useConfirmPayment(), {
      wrapper: createWrapper().Wrapper,
    });

    await expect(result.current.mutateAsync(payload)).resolves.toMatchObject({
      id: 'reservation-confirm-disabled',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/payments/confirm', payload, {
      showErrorToast: false,
    });
  });

  it('does not call lockSeat API when runtime booking is disabled', async () => {
    runtimeFlagsMock.mockReturnValue({
      bookingEnabled: false,
      isLoading: false,
      bookingDisabledMessage: '예매는 추후 오픈 예정입니다',
    });

    const { result } = renderHook(() => useLockSeat(), {
      wrapper: createWrapper().Wrapper,
    });

    await expect(
      result.current.mutateAsync({
        showtimeId: 'showtime-disabled',
        seatId: 'A-1',
      }),
    ).rejects.toMatchObject({
      message: '예매는 추후 오픈 예정입니다',
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('does not call lockSeat API when the cached performance is ended', async () => {
    useBookingStore.getState().setBookingData({
      selectedSeats: [],
      showtimeId: 'showtime-ended',
      performanceId: 'performance-ended',
      performanceTitle: '판매종료 공연',
      showDateTime: '2026-07-18T09:00:00.000Z',
      venue: '서울 공연장',
      posterUrl: null,
      expiresAt: null,
    });
    const { Wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(
      ['performance', 'performance-ended'],
      createPerformanceDetail({
        id: 'performance-ended',
        status: 'ended',
        showtimes: [{
          id: 'showtime-ended',
          performanceId: 'performance-ended',
          dateTime: '2026-07-18T09:00:00.000Z',
        }],
      }),
    );

    const { result } = renderHook(() => useLockSeat(), {
      wrapper: Wrapper,
    });

    await expect(
      result.current.mutateAsync({
        showtimeId: 'showtime-ended',
        seatId: 'A-1',
      }),
    ).rejects.toMatchObject({
      message: '판매가 종료된 공연입니다',
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('calls lockSeat API for admin when runtime booking is disabled', async () => {
    runtimeFlagsMock.mockReturnValue({
      bookingEnabled: false,
      isLoading: false,
      bookingDisabledMessage: '예매는 추후 오픈 예정입니다',
    });
    setAdminAuth();
    postMock.mockResolvedValueOnce({
      success: true,
      lockId: 'admin-lock',
      seatId: 'A-1',
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const { result } = renderHook(() => useLockSeat(), {
      wrapper: createWrapper().Wrapper,
    });

    await expect(
      result.current.mutateAsync({
        showtimeId: 'showtime-disabled',
        seatId: 'A-1',
      }),
    ).resolves.toMatchObject({
      success: true,
      lockId: 'admin-lock',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/booking/seats/lock', {
      showtimeId: 'showtime-disabled',
      seatId: 'A-1',
    });
  });

  it('does not call prepare reservation API when runtime booking is disabled', async () => {
    runtimeFlagsMock.mockReturnValue({
      bookingEnabled: false,
      isLoading: false,
      bookingDisabledMessage: '예매는 추후 오픈 예정입니다',
    });
    const payload = createPrepareReservationPayload({
      orderId: 'GRP-DISABLED-PREPARE',
      showtimeId: 'showtime-disabled',
    });

    const { result } = renderHook(() => usePrepareReservation(), {
      wrapper: createWrapper().Wrapper,
    });

    await expect(result.current.mutateAsync(payload)).rejects.toMatchObject({
      message: '예매는 추후 오픈 예정입니다',
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('does not call prepare reservation API when the cached performance is ended', async () => {
    useBookingStore.getState().setBookingData({
      selectedSeats: [],
      showtimeId: 'showtime-ended',
      performanceId: 'performance-ended',
      performanceTitle: '판매종료 공연',
      showDateTime: '2026-07-18T09:00:00.000Z',
      venue: '서울 공연장',
      posterUrl: null,
      expiresAt: null,
    });
    const payload = createPrepareReservationPayload({
      orderId: 'GRP-ENDED-PREPARE',
      showtimeId: 'showtime-ended',
    });
    const { Wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(
      ['performance', 'performance-ended'],
      createPerformanceDetail({
        id: 'performance-ended',
        status: 'ended',
        showtimes: [{
          id: 'showtime-ended',
          performanceId: 'performance-ended',
          dateTime: '2026-07-18T09:00:00.000Z',
        }],
      }),
    );

    const { result } = renderHook(() => usePrepareReservation(), {
      wrapper: Wrapper,
    });

    await expect(result.current.mutateAsync(payload)).rejects.toMatchObject({
      message: '판매가 종료된 공연입니다',
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('calls prepare reservation API for admin when runtime booking is disabled', async () => {
    runtimeFlagsMock.mockReturnValue({
      bookingEnabled: false,
      isLoading: false,
      bookingDisabledMessage: '예매는 추후 오픈 예정입니다',
    });
    setAdminAuth();
    const payload = createPrepareReservationPayload({
      orderId: 'GRP-ADMIN-PREPARE',
      showtimeId: 'showtime-disabled',
    });
    postMock.mockResolvedValueOnce({
      reservationId: 'admin-reservation',
      orderId: payload.orderId,
    });

    const { result } = renderHook(() => usePrepareReservation(), {
      wrapper: createWrapper().Wrapper,
    });

    await expect(result.current.mutateAsync(payload)).resolves.toEqual({
      reservationId: 'admin-reservation',
      orderId: payload.orderId,
    });
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/reservations/prepare',
      expect.objectContaining({
        orderId: payload.orderId,
        showtimeId: payload.showtimeId,
      }),
      { showErrorToast: false },
    );
  });

  it('useLockSeat() posts the floor-aware seatKey as the runtime seat id', async () => {
    postMock.mockResolvedValueOnce({
      success: true,
      lockId: 'lock-2F-A-1',
      seatId: 'A-1',
      seatKey: '2F:A-1',
      floorKey: '2F',
      floorLabel: '2층',
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const { result } = renderHook(() => useLockSeat(), {
      wrapper: createWrapper().Wrapper,
    });

    await result.current.mutateAsync({
      showtimeId: 'showtime-floor-aware',
      seatId: 'A-1',
      floorKey: '2F',
      floorLabel: '2층',
      seatKey: '2F:A-1',
    });

    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/booking/seats/lock', {
      showtimeId: 'showtime-floor-aware',
      seatId: '2F:A-1',
    });
  });

  it('useUnlockSeat() URL-encodes runtime seat keys before path transport', async () => {
    deleteMock.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useUnlockSeat(), {
      wrapper: createWrapper().Wrapper,
    });

    await result.current.mutateAsync({
      showtimeId: 'showtime/floor-aware',
      seatId: '2F:A/1?#',
    });

    expect(apiClient.delete).toHaveBeenCalledWith(
      '/api/v1/booking/seats/lock/showtime%2Ffloor-aware/2F%3AA%2F1%3F%23',
    );
  });

  it('usePrepareReservation() uses floor-aware store seats and cached event policy instead of legacy payload defaults', async () => {
    useBookingStore.getState().setBookingData({
      selectedSeats: [
        createFloorAwareSeat(),
        createFloorAwareSeat({
          floorKey: '2F',
          floorLabel: '2층',
          seatKey: '2F:A-1',
        }),
      ],
      showtimeId: 'showtime-floor-aware',
      performanceId: 'performance-1',
      performanceTitle: '락 테스트 공연',
      showDateTime: '2026-07-18T12:00:00.000Z',
      venue: '테스트 공연장',
      posterUrl: null,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const { Wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(
      ['performance', 'performance-1', 'ko'],
      createPerformanceDetail(),
    );
    postMock.mockResolvedValueOnce({
      reservationId: 'reservation-floor-aware',
      orderId: 'GRP-FLOOR-AWARE',
    });

    const { result } = renderHook(() => usePrepareReservation(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync(
      createPrepareReservationPayload({
        orderId: 'GRP-FLOOR-AWARE',
        showtimeId: 'showtime-floor-aware',
        seats: [
          createFloorAwareSeat({
            floorKey: 'default',
            floorLabel: '기본',
            seatKey: 'default:A-1',
          }),
        ],
        bookingPolicy: {
          maxTicketsPerOrder: 4,
          cancellationChangePolicy: 'CANCEL_ONLY',
          sameGradeChangeEnabled: false,
          paymentWindowMinutes: 10,
        },
      }),
    );

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/v1/reservations/prepare',
      expect.objectContaining({
        seats: [
          createFloorAwareSeat(),
          createFloorAwareSeat({
            floorKey: '2F',
            floorLabel: '2층',
            seatKey: '2F:A-1',
          }),
        ],
        bookingPolicy: expect.objectContaining({
          maxTicketsPerOrder: 1,
          paymentWindowMinutes: 7,
          seatHoldMinutes: 10,
        }),
      }),
      {
        showErrorToast: false,
      },
    );
  });

  it('useBookingPaymentSnapshot() exposes a separate paymentDeadlineAt from lock expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-08T10:00:00.000Z'));

    useBookingStore.getState().setBookingData({
      selectedSeats: [createFloorAwareSeat()],
      showtimeId: 'showtime-payment-window',
      performanceId: 'performance-1',
      performanceTitle: '락 테스트 공연',
      showDateTime: '2026-07-18T12:00:00.000Z',
      venue: '테스트 공연장',
      posterUrl: null,
      expiresAt: new Date('2026-05-08T10:10:00.000Z').getTime(),
    });

    const { Wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(
      ['performance', 'performance-1', 'ko'],
      createPerformanceDetail({
        bookingPolicy: {
          maxTicketsPerUser: 1,
          allowedPaymentMethods: ['CARD', 'FOREIGN_EASY_PAY'],
          changePolicyEnabled: false,
          paymentWindowMinutes: 7,
          seatHoldMinutes: 10,
          cancelledSeatHoldMinMinutes: 1,
          cancelledSeatHoldMaxMinutes: 10,
          manualOpenEnabled: true,
        },
      }),
    );

    const { result } = renderHook(() => useBookingPaymentSnapshot(), {
      wrapper: Wrapper,
    });

    expect(result.current.lockExpiresAt).toBe('2026-05-08T10:10:00.000Z');
    expect(result.current.paymentDeadlineAt).toBe('2026-05-08T10:07:00.000Z');
    expect(result.current.allowedPaymentMethods).toEqual(['CARD', 'FOREIGN_EASY_PAY']);

    vi.useRealTimers();
  });

  it('resolvePaymentMethodSelection() flags foreign easy pay for disclaimer and pendingUrl flow', () => {
    expect(resolvePaymentMethodSelection('TRUEMONEY')).toMatchObject({
      requiresOverseasDisclaimer: true,
      paymentMethod: {
        method: 'FOREIGN_EASY_PAY',
        provider: 'TRUEMONEY',
        pendingUrlRequired: true,
      },
    });
  });

  it('resolvePaymentMethodSelection() maps PayPal to foreign easy pay without pending return flow', () => {
    expect(resolvePaymentMethodSelection('PAYPAL')).toMatchObject({
      requiresOverseasDisclaimer: true,
      paymentMethod: {
        method: 'FOREIGN_EASY_PAY',
        provider: 'PAYPAL',
        currency: 'USD',
      },
    });
    expect(resolvePaymentMethodSelection('PAYPAL').paymentMethod.pendingUrlRequired).toBeUndefined();
  });

  it('resolvePaymentMethodSelection() maps CARD by widget variant context', () => {
    expect(resolvePaymentMethodSelection('CARD', 'DEFAULT')).toMatchObject({
      requiresOverseasDisclaimer: false,
      requestFlow: 'widget',
      paymentMethod: {
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
      },
    });

    expect(resolvePaymentMethodSelection('CARD', 'uspay')).toMatchObject({
      requiresOverseasDisclaimer: true,
      requestFlow: 'widget',
      paymentMethod: {
        method: 'CARD',
        provider: 'CARD',
        currency: 'USD',
        overseasPaymentConsent: {
          required: true,
          agreed: false,
        },
      },
    });

    expect(resolvePaymentMethodSelection('ALIPAY', 'uspay')).toMatchObject({
      requiresOverseasDisclaimer: true,
      requestFlow: 'widget',
      paymentMethod: {
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'USD',
        pendingUrlRequired: true,
      },
    });

    expect(resolvePaymentMethodSelection('OVERSEAS_CARD', 'uspay')).toMatchObject({
      requiresOverseasDisclaimer: true,
      requestFlow: 'direct_card',
      paymentMethod: {
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
      },
    });
  });

  it('resolvePaymentWidgetVariantKey() defaults to DEFAULT for unset or blank env', () => {
    const originalVariantKey = process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY;

    try {
      delete process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY;
      expect(resolvePaymentWidgetVariantKey()).toBe('DEFAULT');
      expect(resolvePaymentWidgetVariantKeys()).toEqual(['DEFAULT']);

      process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = '   ';
      expect(resolvePaymentWidgetVariantKey()).toBe('DEFAULT');
      expect(resolvePaymentWidgetVariantKeys()).toEqual(['DEFAULT']);
    } finally {
      if (originalVariantKey === undefined) {
        delete process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY;
      } else {
        process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = originalVariantKey;
      }
    }
  });

  it('resolvePaymentWidgetVariantKey() returns trimmed configured env value', () => {
    const originalVariantKey = process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY;

    try {
      process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = '  CUSTOM_WIDGET  ';
      expect(resolvePaymentWidgetVariantKey()).toBe('CUSTOM_WIDGET');
      expect(resolvePaymentWidgetVariantKeys()).toEqual(['CUSTOM_WIDGET']);
    } finally {
      if (originalVariantKey === undefined) {
        delete process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY;
      } else {
        process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = originalVariantKey;
      }
    }
  });

  it('resolvePaymentWidgetVariantKeys() parses comma-separated widget variants', () => {
    const originalVariantKey = process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY;

    try {
      process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = ' DEFAULT, uspay, alipay, DEFAULT ';

      expect(resolvePaymentWidgetVariantKey()).toBe('DEFAULT');
      expect(resolvePaymentWidgetVariantKeys()).toEqual(['DEFAULT', 'uspay']);
    } finally {
      if (originalVariantKey === undefined) {
        delete process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY;
      } else {
        process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = originalVariantKey;
      }
    }
  });

  it('resolvePaymentWidgetClientKey() uses widget keys only for widget-rendered variants', () => {
    const originalClientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
    const originalForeignWidgetClientKey = process.env.NEXT_PUBLIC_TOSS_FOREIGN_PAYMENT_WIDGET_CLIENT_KEY;
    const originalForeignEasyPayClientKey = process.env.NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY;

    try {
      process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY = 'domestic-client-key';
      delete process.env.NEXT_PUBLIC_TOSS_FOREIGN_PAYMENT_WIDGET_CLIENT_KEY;
      process.env.NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY = 'foreign-easy-pay-client-key';

      expect(resolvePaymentWidgetClientKey('uspay')).toBe('foreign-easy-pay-client-key');
      expect(resolvePaymentWidgetClientKey('alipay')).toBe('domestic-client-key');

      process.env.NEXT_PUBLIC_TOSS_FOREIGN_PAYMENT_WIDGET_CLIENT_KEY = 'foreign-widget-client-key';
      expect(resolvePaymentWidgetClientKey('uspay')).toBe('foreign-easy-pay-client-key');
      expect(resolvePaymentWidgetClientKey('alipay')).toBe('domestic-client-key');
      expect(resolvePaymentWidgetClientKey('DEFAULT')).toBe('domestic-client-key');
    } finally {
      if (originalClientKey === undefined) {
        delete process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
      } else {
        process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY = originalClientKey;
      }
      if (originalForeignWidgetClientKey === undefined) {
        delete process.env.NEXT_PUBLIC_TOSS_FOREIGN_PAYMENT_WIDGET_CLIENT_KEY;
      } else {
        process.env.NEXT_PUBLIC_TOSS_FOREIGN_PAYMENT_WIDGET_CLIENT_KEY = originalForeignWidgetClientKey;
      }
      if (originalForeignEasyPayClientKey === undefined) {
        delete process.env.NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY;
      } else {
        process.env.NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY = originalForeignEasyPayClientKey;
      }
    }
  });

  it('resolvePaymentWidgetRenderAmount() uses USD for uspay widget rendering only', () => {
    expect(resolvePaymentWidgetRenderAmount({ amount: 50000, variantKey: 'DEFAULT' })).toEqual({
      currency: 'KRW',
      value: 50000,
    });
    expect(resolvePaymentWidgetRenderAmount({ amount: 50000, variantKey: 'uspay' })).toEqual({
      currency: 'USD',
      value: 34,
    });
    expect(resolvePaymentWidgetRenderAmount({ amount: 50000, variantKey: 'alipay' })).toEqual({
      currency: 'KRW',
      value: 50000,
    });
  });

  it('resolvePaymentWidgetVariantLabel() labels foreign payment variants without duplicate PayPal copy', () => {
    expect(resolvePaymentWidgetVariantLabel('DEFAULT')).toBe('국내 결제');
    expect(resolvePaymentWidgetVariantLabel('uspay')).toBe('해외 결제');
    expect(resolvePaymentWidgetVariantLabel('alipay')).toBe('국내 결제');
  });

  it('resolvePaymentWidgetRenderVariantKey() passes configured Toss widget variants through', () => {
    expect(resolvePaymentWidgetRenderVariantKey('uspay')).toBe('uspay');
    expect(resolvePaymentWidgetRenderVariantKey('PAYPAL')).toBe('PAYPAL');
    expect(resolvePaymentWidgetRenderVariantKey('alipay')).toBe('alipay');
    expect(resolvePaymentWidgetRenderVariantKey('DEFAULT')).toBe('DEFAULT');
  });

  it('resolvePaymentRequestAmount() uses the exact PayPal provider quote for Toss request amount', () => {
    expect(resolvePaymentRequestAmount({
      amount: 50000,
      currency: 'KRW',
      providerChargeQuote: {
        currency: 'USD',
        amountMinor: 3400,
        amountDecimal: '34.00',
        rate: '0.00068',
        quotedAt: '2026-05-29T00:00:00.000Z',
      },
    })).toEqual({
      currency: 'USD',
      value: 34,
    });
    expect(resolvePaymentRequestAmount({
      amount: 50000,
      currency: 'THB',
    })).toEqual({
      currency: 'THB',
      value: 50000,
    });
  });

  it('buildWidgetPaymentRequest() itemizes PayPal products so USD decimals match the provider quote', () => {
    const request = buildWidgetPaymentRequest({
      branch: {
        orderId: 'GRP-PAYPAL',
        method: 'FOREIGN_EASY_PAY',
        provider: 'PAYPAL',
        currency: 'USD',
        successUrl: 'https://grabit.test/success?provider=PAYPAL&providerChargeAmount=48.96',
        failUrl: 'https://grabit.test/fail',
        asyncStatus: 'sync',
        useInternationalCardOnly: false,
        providerChargeQuote: {
          currency: 'USD',
          amountMinor: 4896,
          amountDecimal: '48.96',
          rate: '0.00068',
          quotedAt: '2026-05-29T00:00:00.000Z',
        },
        checkoutEnabled: true,
      },
      amount: 72000,
      customerEmail: 'fan@example.com',
      customerName: '해외 팬',
      customerMobilePhone: '821012345678',
      orderName: '팬미팅 티켓 2매',
      locale: 'en',
      selectedSeats: [
        createFloorAwareSeat({ seatId: 'A-1', price: 30000 }),
        createFloorAwareSeat({ seatId: 'A-2', number: '2', price: 38000 }),
      ],
    });

    const products = request.foreignEasyPay?.products ?? [];

    expect(request.windowTarget).toBe('self');
    expect(products).toHaveLength(3);
    expect(products.map((product) => product.name)).toEqual([
      'VIP A열 1번',
      'VIP A열 2번',
      'Service fee / rounding adjustment',
    ]);
    expect(products.reduce((sum, product) => sum + product.quantity * product.unitAmount, 0)).toBeCloseTo(48.96);
    expect(products.reduce(
      (sum, product) => sum + product.quantity * Math.round(product.unitAmount * 100),
      0,
    )).toBe(4896);
    expect(products.every((product) => product.currency === 'USD')).toBe(true);
  });

  it('buildWidgetPaymentRequest() itemizes Alipay products with the stored USD provider quote', () => {
    const request = buildWidgetPaymentRequest({
      branch: {
        orderId: 'GRP-ALIPAY',
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'USD',
        successUrl: 'https://grabit.test/success',
        failUrl: 'https://grabit.test/fail',
        pendingUrl: 'https://grabit.test/pending',
        asyncStatus: 'pending_webhook',
        useInternationalCardOnly: false,
        providerChargeQuote: {
          currency: 'USD',
          amountMinor: 4896,
          amountDecimal: '48.96',
          rate: '0.00068',
          quotedAt: '2026-05-29T00:00:00.000Z',
        },
        checkoutEnabled: true,
      },
      amount: 72000,
      customerEmail: 'fan@example.com',
      customerName: '해외 팬',
      orderName: '팬미팅 티켓 2매',
      locale: 'en',
      selectedSeats: [
        createFloorAwareSeat({ seatId: 'A-1', price: 30000 }),
        createFloorAwareSeat({ seatId: 'A-2', number: '2', price: 38000 }),
      ],
    });

    expect(request.pendingUrl).toBe('https://grabit.test/pending');
    expect(request.windowTarget).toBe('self');
    expect(request.foreignEasyPay?.products.reduce(
      (sum, product) => sum + product.quantity * Math.round(product.unitAmount * 100),
      0,
    )).toBe(4896);
    expect(request.foreignEasyPay?.products.every((product) => product.currency === 'USD')).toBe(true);
  });

  it('buildDirectCardPaymentRequest() sends overseas card through direct CARD payment with KRW amount', () => {
    expect(buildDirectCardPaymentRequest({
      branch: {
        orderId: 'GRP-OVERSEAS-CARD',
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        successUrl: 'https://grabit.test/success?provider=OVERSEAS_CARD',
        failUrl: 'https://grabit.test/fail',
        asyncStatus: 'sync',
        useInternationalCardOnly: true,
      },
      amount: 50000,
      customerEmail: 'fan@example.com',
      customerName: '해외 팬',
      customerMobilePhone: '+82-10-1234-5678',
      orderName: '팬미팅 티켓 1매',
    })).toMatchObject({
      method: 'CARD',
      amount: {
        currency: 'KRW',
        value: 50000,
      },
      orderId: 'GRP-OVERSEAS-CARD',
      windowTarget: 'self',
      card: {
        useInternationalCardOnly: true,
      },
      customerMobilePhone: '821012345678',
    });
  });

  it('buildWidgetPaymentRequest() keeps USD overseas card requests on the card branch', () => {
    const request = buildWidgetPaymentRequest({
      branch: {
        orderId: 'GRP-OVERSEAS-CARD-USD',
        method: 'CARD',
        provider: 'CARD',
        currency: 'USD',
        successUrl: 'https://grabit.test/success?provider=OVERSEAS_CARD&providerChargeAmount=48.96',
        failUrl: 'https://grabit.test/fail',
        asyncStatus: 'sync',
        useInternationalCardOnly: true,
        providerChargeQuote: {
          currency: 'USD',
          amountMinor: 4896,
          amountDecimal: '48.96',
          rate: '0.00068',
          quotedAt: '2026-05-29T00:00:00.000Z',
        },
        checkoutEnabled: true,
      },
      amount: 72000,
      customerEmail: 'fan@example.com',
      customerName: '해외 팬',
      customerMobilePhone: '010-0000-0000',
      orderName: '팬미팅 티켓 1매',
      locale: 'en',
      selectedSeats: [createFloorAwareSeat({ price: 70000 })],
    });

    expect(request).toMatchObject({
      orderId: 'GRP-OVERSEAS-CARD-USD',
      successUrl: 'https://grabit.test/success?provider=OVERSEAS_CARD&providerChargeAmount=48.96',
      windowTarget: 'self',
    });
    expect(request.card).toBeUndefined();
    expect(request.foreignEasyPay).toBeUndefined();
    expect(request.customerMobilePhone).toBeUndefined();
  });

  it('buildDirectCardPaymentRequest() omits placeholder admin phone numbers', () => {
    const request = buildDirectCardPaymentRequest({
      branch: {
        orderId: 'GRP-OVERSEAS-CARD',
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        successUrl: 'https://grabit.test/success?provider=OVERSEAS_CARD',
        failUrl: 'https://grabit.test/fail',
        asyncStatus: 'sync',
        useInternationalCardOnly: true,
      },
      amount: 50000,
      customerEmail: 'admin@example.com',
      customerName: '관리자',
      customerMobilePhone: '010-0000-0000',
      orderName: '팬미팅 티켓 1매',
    });

    expect(request.customerMobilePhone).toBeUndefined();
  });

  it('resolveProviderChargeDisabledMessage() does not expose raw PayPal disabled codes for Alipay', () => {
    expect(resolveProviderChargeDisabledMessage('ALIPAY_PLUS', 'PAYPAL_CHECKOUT_DISABLED'))
      .toBe('Alipay 결제 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.');
    expect(resolveProviderChargeDisabledMessage('PAYPAL', 'PAYPAL_CHECKOUT_DISABLED'))
      .toBe('PayPal 결제 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.');
  });

  it('buildWidgetPaymentRequest() keeps pendingUrl for foreign wallets and omits direct-card-only options for overseas card widgets', () => {
    const foreignWalletRequest = buildWidgetPaymentRequest({
      branch: {
        orderId: 'GRP-FOREIGN-EASY-PAY',
        method: 'FOREIGN_EASY_PAY',
        provider: 'TRUEMONEY',
        currency: 'USD',
        successUrl: 'https://grabit.test/success',
        failUrl: 'https://grabit.test/fail',
        pendingUrl: 'https://grabit.test/pending',
        asyncStatus: 'pending_webhook',
        useInternationalCardOnly: false,
      },
      amount: 50000,
      customerEmail: 'fan@example.com',
      customerName: '해외 팬',
      customerMobilePhone: '821012345678',
      orderName: '팬미팅 티켓 1매',
      locale: 'th',
    });

    expect(foreignWalletRequest).toMatchObject({
      pendingUrl: 'https://grabit.test/pending',
      windowTarget: 'self',
      foreignEasyPay: {
        country: 'TH',
      },
    });

    const overseasCardRequest = buildWidgetPaymentRequest({
      branch: {
        orderId: 'GRP-OVERSEAS-CARD',
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        successUrl: 'https://grabit.test/success',
        failUrl: 'https://grabit.test/fail',
        asyncStatus: 'sync',
        useInternationalCardOnly: true,
      },
      amount: 50000,
      customerEmail: 'fan@example.com',
      customerName: '해외 팬',
      customerMobilePhone: '821012345678',
      orderName: '팬미팅 티켓 1매',
      locale: 'en',
    });

    expect(overseasCardRequest.card).toBeUndefined();
    expect(overseasCardRequest.windowTarget).toBe('self');
  });

  it('buildConfirmPaymentPayload() preserves PayPal providerChargeAmount as a raw decimal string', () => {
    expect(buildConfirmPaymentPayload({
      paymentKey: 'paypal_payment_key',
      orderId: 'GRP-PAYPAL-CONFIRM',
      amount: '52',
      provider: 'PAYPAL',
      providerChargeAmount: '52.30',
    })).toEqual({
      paymentKey: 'paypal_payment_key',
      orderId: 'GRP-PAYPAL-CONFIRM',
      provider: 'PAYPAL',
      providerChargeAmount: '52.30',
    });
    expect(buildConfirmPaymentPayload({
      paymentKey: 'paypal_payment_key',
      orderId: 'GRP-PAYPAL-CONFIRM',
      amount: '52.30',
      provider: 'PAYPAL',
      providerChargeAmount: null,
    })).toEqual({
      paymentKey: 'paypal_payment_key',
      orderId: 'GRP-PAYPAL-CONFIRM',
      provider: 'PAYPAL',
      providerChargeAmount: '',
    });

    expect(buildConfirmPaymentPayload({
      paymentKey: 'card_payment_key',
      orderId: 'GRP-CARD-CONFIRM',
      amount: '50000',
      provider: null,
      providerChargeAmount: null,
    })).toEqual({
      paymentKey: 'card_payment_key',
      orderId: 'GRP-CARD-CONFIRM',
      amount: 50000,
    });

    expect(buildConfirmPaymentPayload({
      paymentKey: 'overseas_card_payment_key',
      orderId: 'GRP-OVERSEAS-CARD-CONFIRM',
      amount: '50000',
      provider: 'OVERSEAS_CARD',
      providerChargeAmount: null,
    })).toEqual({
      paymentKey: 'overseas_card_payment_key',
      orderId: 'GRP-OVERSEAS-CARD-CONFIRM',
      provider: 'OVERSEAS_CARD',
      amount: 50000,
    });
    expect(buildConfirmPaymentPayload({
      paymentKey: 'overseas_card_usd_payment_key',
      orderId: 'GRP-OVERSEAS-CARD-USD-CONFIRM',
      amount: '48.96',
      provider: 'OVERSEAS_CARD',
      providerChargeAmount: '48.96',
    })).toEqual({
      paymentKey: 'overseas_card_usd_payment_key',
      orderId: 'GRP-OVERSEAS-CARD-USD-CONFIRM',
      provider: 'OVERSEAS_CARD',
      providerChargeAmount: '48.96',
    });
  });
});
