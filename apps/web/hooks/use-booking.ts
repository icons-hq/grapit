import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { BookingDisabledError } from '@/lib/runtime-flags';
import { useRuntimeFlags } from '@/hooks/use-runtime-flags';
import type {
  ConfirmPaymentRequest,
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
}

interface MyLocksResponse {
  seatIds: string[];
  expiresAt: number | null;
}

export type { SeatSelection, SeatStatusResponse, LockSeatRequest, LockSeatResponse, UnlockAllResponse };

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

export function useLockSeat() {
  const queryClient = useQueryClient();
  const { bookingEnabled, bookingDisabledMessage } = useRuntimeFlags();

  return useMutation({
    mutationFn: (data: LockSeatRequest) => {
      if (!bookingEnabled) {
        throw new BookingDisabledError(bookingDisabledMessage);
      }

      return apiClient.post<LockSeatResponse>('/api/v1/booking/seats/lock', data);
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
  const { bookingEnabled, bookingDisabledMessage } = useRuntimeFlags();

  return useMutation({
    mutationFn: (data: PrepareReservationRequest) => {
      if (!bookingEnabled) {
        throw new BookingDisabledError(bookingDisabledMessage);
      }

      return apiClient.post<PrepareReservationResponse>('/api/v1/reservations/prepare', data, {
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

export function useCancelPendingReservation() {
  return useMutation({
    mutationFn: (reservationId: string) =>
      apiClient.put<void>(`/api/v1/reservations/${reservationId}/cancel-pending`),
  });
}
