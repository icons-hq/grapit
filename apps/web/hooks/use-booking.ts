import { useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { BookingDisabledError } from '@/lib/runtime-flags';
import { useRuntimeFlags } from '@/hooks/use-runtime-flags';
import { useBookingStore } from '@/stores/use-booking-store';
import type {
  BookingPolicy,
  ConfirmPaymentRequest,
  FloorAwareSeatSelection,
  PerformanceBookingPolicy,
  PerformanceWithDetails,
  PrepareReservationRequest,
  PrepareReservationResponse,
  ReservationDetail,
  SeatSelection,
  SeatStatusResponse,
  LockSeatResponse,
  UnlockAllResponse,
} from '@grabit/shared';

interface LockSeatRequest {
  showtimeId: string;
  seatId: string;
  seatKey?: string;
  floorKey?: string;
  floorLabel?: string;
}

interface MyLocksResponse {
  seatIds: string[];
  expiresAt: number | null;
}

export type { SeatSelection, SeatStatusResponse, LockSeatRequest, LockSeatResponse, UnlockAllResponse };

const DEFAULT_FLOOR_KEY = '1F';
const DEFAULT_FLOOR_LABEL = '1층';
const DEFAULT_PAYMENT_WINDOW_MINUTES = 7;
const DEFAULT_SEAT_HOLD_MINUTES = 10;
const DEFAULT_ALLOWED_PAYMENT_METHODS = ['CARD'] as const;

export interface BookingPaymentSnapshot {
  paymentDeadlineAt: string | null;
  lockExpiresAt: string | null;
  bookingPolicy: BookingPolicy;
  allowedPaymentMethods: PerformanceBookingPolicy['allowedPaymentMethods'];
  isPaymentDeadlineExpired: boolean;
}

export type BookingPaymentStatus =
  | 'idle'
  | 'confirmed'
  | 'pending'
  | 'failed'
  | 'expired';

export interface BookingPaymentRecoverySnapshot {
  paymentStatus: BookingPaymentStatus;
  paymentDeadlineAt: string | null;
  reservation: ReservationDetail | null;
}

function toFloorAwareSeatSelection(
  seat: FloorAwareSeatSelection | SeatSelection,
): FloorAwareSeatSelection {
  const candidate = seat as Partial<FloorAwareSeatSelection>;
  const floorKey = candidate.floorKey?.trim() || DEFAULT_FLOOR_KEY;
  const floorLabel = candidate.floorLabel?.trim()
    || (floorKey === DEFAULT_FLOOR_KEY ? DEFAULT_FLOOR_LABEL : floorKey);

  return {
    ...seat,
    floorKey,
    floorLabel,
    seatKey: candidate.seatKey?.trim() || `${floorKey}:${seat.seatId}`,
  };
}

function toRuntimeSeatId(seat: Pick<LockSeatRequest, 'seatId' | 'seatKey' | 'floorKey'>): string {
  return seat.seatKey?.trim() || (seat.floorKey?.trim()
    ? `${seat.floorKey.trim()}:${seat.seatId}`
    : seat.seatId);
}

function toBookingPolicy(
  performancePolicy: PerformanceBookingPolicy,
  fallback: BookingPolicy,
): BookingPolicy {
  return {
    ...fallback,
    maxTicketsPerOrder: performancePolicy.maxTicketsPerUser,
    cancellationChangePolicy: performancePolicy.changePolicyEnabled
      ? 'SAME_GRADE_CHANGE'
      : 'CANCEL_ONLY',
    sameGradeChangeEnabled: performancePolicy.changePolicyEnabled,
    paymentWindowMinutes: performancePolicy.paymentWindowMinutes,
    seatHoldMinutes: performancePolicy.seatHoldMinutes,
  };
}

function getCachedPerformanceDetail(
  queryClient: ReturnType<typeof useQueryClient>,
  performanceId: string | null,
): PerformanceWithDetails | null {
  if (!performanceId) {
    return null;
  }

  const matches = queryClient.getQueriesData<PerformanceWithDetails>({
    queryKey: ['performance', performanceId],
  });

  for (const [, data] of matches) {
    if (data) {
      return data;
    }
  }

  return null;
}

function buildBookingPaymentSnapshot(
  lockExpiresAtMs: number | null,
  performancePolicy?: PerformanceBookingPolicy,
): BookingPaymentSnapshot {
  const paymentWindowMinutes = performancePolicy?.paymentWindowMinutes ?? DEFAULT_PAYMENT_WINDOW_MINUTES;
  const seatHoldMinutes = performancePolicy?.seatHoldMinutes ?? DEFAULT_SEAT_HOLD_MINUTES;
  const lockExpiresAt = lockExpiresAtMs ? new Date(lockExpiresAtMs).toISOString() : null;
  const paymentDeadlineAt = lockExpiresAtMs
    ? new Date(
      Math.min(lockExpiresAtMs, Date.now() + paymentWindowMinutes * 60 * 1000),
    ).toISOString()
    : null;

  return {
    paymentDeadlineAt,
    lockExpiresAt,
    bookingPolicy: {
      maxTicketsPerOrder: performancePolicy?.maxTicketsPerUser ?? 1,
      cancellationChangePolicy: performancePolicy?.changePolicyEnabled
        ? 'SAME_GRADE_CHANGE'
        : 'CANCEL_ONLY',
      sameGradeChangeEnabled: performancePolicy?.changePolicyEnabled ?? false,
      paymentWindowMinutes,
      seatHoldMinutes,
    },
    allowedPaymentMethods: performancePolicy?.allowedPaymentMethods ?? [...DEFAULT_ALLOWED_PAYMENT_METHODS],
    isPaymentDeadlineExpired: paymentDeadlineAt
      ? new Date(paymentDeadlineAt).getTime() <= Date.now()
      : false,
  };
}

function isPastIsoDate(value: string | null | undefined, now = Date.now()): boolean {
  if (!value) {
    return false;
  }

  return new Date(value).getTime() <= now;
}

export function useSeatStatus(showtimeId: string | null) {
  return useQuery({
    queryKey: ['seat-status', showtimeId],
    queryFn: () =>
      apiClient.get<SeatStatusResponse>(
        `/api/v1/booking/schedules/${showtimeId}/seats`,
      ),
    enabled: !!showtimeId,
  });
}

export function useMyLocks(showtimeId: string | null) {
  return useQuery({
    queryKey: ['my-locks', showtimeId],
    queryFn: () =>
      apiClient.get<MyLocksResponse>(
        `/api/v1/booking/my-locks/${showtimeId}`,
      ),
    enabled: !!showtimeId,
    staleTime: 0,
  });
}

export function useBookingPaymentSnapshot(): BookingPaymentSnapshot {
  const queryClient = useQueryClient();
  const performanceId = useBookingStore((state) => state.performanceId);
  const lockExpiresAtMs = useBookingStore((state) => state.expiresAt);

  return useMemo(() => {
    const cachedPerformance = getCachedPerformanceDetail(queryClient, performanceId);
    return buildBookingPaymentSnapshot(lockExpiresAtMs, cachedPerformance?.bookingPolicy);
  }, [lockExpiresAtMs, performanceId, queryClient]);
}

export function useLockSeat() {
  const queryClient = useQueryClient();
  const { bookingEnabled, bookingDisabledMessage } = useRuntimeFlags();

  return useMutation({
    mutationFn: (data: LockSeatRequest) => {
      if (!bookingEnabled) {
        throw new BookingDisabledError(bookingDisabledMessage);
      }

      return apiClient.post<LockSeatResponse>('/api/v1/booking/seats/lock', {
        showtimeId: data.showtimeId,
        seatId: toRuntimeSeatId(data),
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['seat-status', variables.showtimeId],
      });
    },
  });
}

export function useUnlockSeat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      showtimeId,
      seatId,
    }: {
      showtimeId: string;
      seatId: string;
    }) =>
      apiClient.delete<void>(
        `/api/v1/booking/seats/lock/${showtimeId}/${seatId}`,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['seat-status', variables.showtimeId],
      });
    },
  });
}

export function useUnlockAllSeats() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ showtimeId }: { showtimeId: string }) =>
      apiClient.delete<UnlockAllResponse>(
        `/api/v1/booking/seats/lock-all/${showtimeId}`,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['seat-status', variables.showtimeId],
      });
      queryClient.invalidateQueries({
        queryKey: ['my-locks', variables.showtimeId],
      });
    },
  });
}

// Payment-related hooks

export function usePrepareReservation() {
  const queryClient = useQueryClient();
  const { bookingEnabled, bookingDisabledMessage } = useRuntimeFlags();
  const selectedSeats = useBookingStore((state) => state.selectedSeats);
  const performanceId = useBookingStore((state) => state.performanceId);

  return useMutation({
    mutationFn: (data: PrepareReservationRequest) => {
      if (!bookingEnabled) {
        throw new BookingDisabledError(bookingDisabledMessage);
      }

      const cachedPerformance = getCachedPerformanceDetail(queryClient, performanceId);
      const seats = (selectedSeats.length > 0 ? selectedSeats : data.seats).map(toFloorAwareSeatSelection);
      const bookingPolicy = cachedPerformance?.bookingPolicy
        ? toBookingPolicy(cachedPerformance.bookingPolicy, data.bookingPolicy)
        : data.bookingPolicy;

      return apiClient.post<PrepareReservationResponse>('/api/v1/reservations/prepare', {
        ...data,
        seats,
        bookingPolicy,
      }, {
        showErrorToast: false,
      });
    },
  });
}

export function useConfirmPayment() {
  return useMutation({
    mutationFn: (data: ConfirmPaymentRequest) =>
      apiClient.post<ReservationDetail>('/api/v1/payments/confirm', data, {
        showErrorToast: false,
      }),
  });
}

export function useBookingDetail(reservationId: string) {
  return useQuery({
    queryKey: ['reservations', reservationId],
    queryFn: () =>
      apiClient.get<ReservationDetail>(`/api/v1/reservations/${reservationId}`),
    enabled: !!reservationId,
  });
}

export function useReservationByOrderId(orderId: string | null) {
  return useQuery({
    queryKey: ['reservations', 'orderId', orderId],
    queryFn: () =>
      apiClient.get<ReservationDetail>(`/api/v1/reservations?orderId=${orderId}`),
    enabled: !!orderId,
  });
}

interface UseBookingPaymentRecoveryOptions {
  enabled?: boolean;
  pendingReturn?: boolean;
  pollIntervalMs?: number;
}

export function useBookingPaymentRecovery(
  orderId: string | null,
  options: UseBookingPaymentRecoveryOptions = {},
) {
  const { enabled = !!orderId, pendingReturn = false, pollIntervalMs = 2500 } = options;
  const fallbackSnapshot = useBookingPaymentSnapshot();
  const reservationQuery = useQuery({
    queryKey: ['reservations', 'orderId', orderId],
    queryFn: () =>
      apiClient.get<ReservationDetail>(`/api/v1/reservations?orderId=${orderId}`),
    enabled: enabled && !!orderId,
  });

  const paymentDeadlineAt = reservationQuery.data?.paymentDeadlineAt ?? fallbackSnapshot.paymentDeadlineAt;
  const paymentStatus = useMemo<BookingPaymentStatus>(() => {
    if (reservationQuery.data?.status === 'CONFIRMED') {
      return 'confirmed';
    }

    if (
      reservationQuery.data?.status === 'FAILED'
      || reservationQuery.data?.status === 'CANCELLED'
    ) {
      return 'failed';
    }

    if (reservationQuery.data?.status === 'PENDING_PAYMENT') {
      return isPastIsoDate(reservationQuery.data.paymentDeadlineAt) ? 'expired' : 'pending';
    }

    if (pendingReturn) {
      return isPastIsoDate(paymentDeadlineAt) ? 'expired' : 'pending';
    }

    return 'idle';
  }, [paymentDeadlineAt, pendingReturn, reservationQuery.data]);

  useEffect(() => {
    if (!enabled || !orderId || paymentStatus !== 'pending') {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void reservationQuery.refetch();
    }, pollIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    enabled,
    orderId,
    paymentStatus,
    pollIntervalMs,
    reservationQuery.refetch,
  ]);

  return {
    ...reservationQuery,
    paymentStatus,
    paymentDeadlineAt,
    reservation: reservationQuery.data ?? null,
  };
}

export function useCancelPendingReservation() {
  return useMutation({
    mutationFn: (reservationId: string) =>
      apiClient.put<void>(`/api/v1/reservations/${reservationId}/cancel-pending`),
  });
}
