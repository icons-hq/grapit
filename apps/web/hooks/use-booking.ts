import { getClientLocale } from '@/lib/i18n/client-copy';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiClientError, apiClient } from '@/lib/api-client';
import { BookingDisabledError } from '@/lib/runtime-flags';
import { useBookingAvailability } from '@/hooks/use-booking-availability';
import { useBookingStore } from '@/stores/use-booking-store';
import { useAuthStore } from '@/stores/use-auth-store';
import { getCheckoutState } from '@/lib/booking/checkout-state';
import { nextSeatSyncSequence } from '@/lib/booking/seat-sync-sequence';
import {
  normalizeSeatIdentity,
  toFloorAwareSeatSelection as toSharedFloorAwareSeatSelection,
} from '@grabit/shared';
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

/**
 * my-locks plus the sync sequence taken when the request was sent. A snapshot
 * requested before a seat lock/unlock was answered may predate it, so
 * selection reconciliation only trusts snapshots requested after the last
 * answer. Local cache patches keep the original requestSeq.
 */
export interface MyLocksSnapshot extends MyLocksResponse {
  requestSeq?: number;
}

export type { SeatSelection, SeatStatusResponse, LockSeatRequest, LockSeatResponse, UnlockAllResponse };

export const seatStatusQueryKey = (showtimeId: string | null) => ['seat-status', showtimeId] as const;
export const myLocksQueryKey = (showtimeId: string | null) => ['my-locks', showtimeId] as const;

/**
 * Seat-status polling: TTL expiry is not broadcast, so polling is the
 * resync path for seats released by Redis TTL and for missed socket events.
 * Faster while the socket is down (including after reconnect_failed).
 * The per-viewer jitter spreads requests from viewers who opened together.
 */
export const SEAT_STATUS_POLL_CONNECTED_MS = 20_000;
export const SEAT_STATUS_POLL_DISCONNECTED_MS = 10_000;
const SEAT_STATUS_POLL_JITTER_RATIO = 0.5;
const SEAT_STATUS_STALE_MS = 5_000;

export function getSeatStatusPollInterval(isConnected: boolean, jitter: number): number {
  const base = isConnected ? SEAT_STATUS_POLL_CONNECTED_MS : SEAT_STATUS_POLL_DISCONNECTED_MS;
  const boundedJitter = Math.min(Math.max(jitter, 0), 1);
  return base + Math.round(base * SEAT_STATUS_POLL_JITTER_RATIO * boundedJitter);
}

function toSeatStatusKey(seatId: string): string {
  return normalizeSeatIdentity({ seatId }).seatKey;
}

function markSeatsAvailable(
  old: SeatStatusResponse | undefined,
  seatIds: readonly string[],
): SeatStatusResponse | undefined {
  if (!old || seatIds.length === 0) {
    return old;
  }
  const releasedKeys = new Set(seatIds.map(toSeatStatusKey));
  let changed = false;
  const seats: SeatStatusResponse['seats'] = {};
  for (const [seatId, state] of Object.entries(old.seats)) {
    if (state === 'locked' && releasedKeys.has(toSeatStatusKey(seatId))) {
      changed = true;
      continue;
    }
    seats[seatId] = state;
  }
  return changed ? { ...old, seats } : old;
}

function removeMyLocks(
  old: MyLocksSnapshot,
  seatIds: readonly string[] | 'all',
): MyLocksSnapshot {
  if (seatIds === 'all') {
    return { ...old, seatIds: [], expiresAt: null };
  }
  const releasedKeys = new Set(seatIds.map(toSeatStatusKey));
  const remaining = old.seatIds.filter((seatId) => !releasedKeys.has(toSeatStatusKey(seatId)));
  if (remaining.length === old.seatIds.length) {
    return old;
  }
  return {
    ...old,
    seatIds: remaining,
    expiresAt: remaining.length === 0 ? null : old.expiresAt,
  };
}

/**
 * Patches cached my-locks. An in-flight refetch would overwrite the patch, so
 * it is cancelled first; a first load without data is left running because
 * cancelling it would leave the query empty. Returns whether a patch applied.
 */
async function patchMyLocks(
  queryClient: ReturnType<typeof useQueryClient>,
  showtimeId: string,
  update: (old: MyLocksSnapshot) => MyLocksSnapshot,
): Promise<boolean> {
  const queryKey = myLocksQueryKey(showtimeId);
  const state = queryClient.getQueryState<MyLocksSnapshot>(queryKey);
  if (!state?.data) {
    return false;
  }
  if (state.fetchStatus === 'fetching') {
    await queryClient.cancelQueries({ queryKey });
  }
  queryClient.setQueryData<MyLocksSnapshot>(queryKey, (old) => (old ? update(old) : old));
  return true;
}

/**
 * While connected, the server broadcasts `available` only for locks it
 * actually released, in server order. Patching the cache from the HTTP
 * response could overwrite a newer lock by another user, so the local patch
 * is only a fallback while the socket is down.
 */
function shouldPatchReleasedSeatsLocally(): boolean {
  return !useBookingStore.getState().isConnected;
}

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
  | 'unavailable'
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
  return toSharedFloorAwareSeatSelection(seat);
}

function toRuntimeSeatId(seat: Pick<LockSeatRequest, 'seatId' | 'seatKey' | 'floorKey'>): string {
  const identity = normalizeSeatIdentity(seat);
  if (seat.seatKey?.trim() || seat.floorKey?.trim()) {
    return identity.seatKey;
  }
  return seat.seatId;
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

function getCachedPerformanceDetailForShowtime(
  queryClient: ReturnType<typeof useQueryClient>,
  showtimeId: string,
): PerformanceWithDetails | null {
  const matches = queryClient.getQueriesData<PerformanceWithDetails>({
    queryKey: ['performance'],
  });

  for (const [, data] of matches) {
    if (data?.showtimes.some((showtime) => showtime.id === showtimeId)) {
      return data;
    }
  }

  return null;
}

function assertCachedPerformanceBookable(
  performance: PerformanceWithDetails | null,
  isAdmin: boolean,
  upcomingMessage: string,
  endedMessage: string,
  now = Date.now(),
): void {
  if (performance?.status === 'ended') {
    throw new BookingDisabledError(endedMessage);
  }
  if (isAdmin) {
    return;
  }
  const bookingStartsAt = performance?.bookingPolicy?.bookingStartsAt;
  const bookingStartsAtMs = bookingStartsAt ? Date.parse(bookingStartsAt) : Number.NaN;
  const isBeforeScheduledBookingStart =
    Number.isFinite(bookingStartsAtMs) && bookingStartsAtMs > now;
  const isUpcomingClosed =
    performance?.status === 'upcoming' &&
    (!Number.isFinite(bookingStartsAtMs) || bookingStartsAtMs > now);
  if (isBeforeScheduledBookingStart || isUpcomingClosed) {
    throw new BookingDisabledError(upcomingMessage);
  }
}

function buildBookingPaymentSnapshot(
  lockExpiresAtMs: number | null,
  serverPaymentDeadlineAtMs: number | null,
  performancePolicy?: PerformanceBookingPolicy,
): BookingPaymentSnapshot {
  const paymentWindowMinutes = performancePolicy?.paymentWindowMinutes ?? DEFAULT_PAYMENT_WINDOW_MINUTES;
  const seatHoldMinutes = performancePolicy?.seatHoldMinutes ?? DEFAULT_SEAT_HOLD_MINUTES;
  const lockExpiresAt = lockExpiresAtMs ? new Date(lockExpiresAtMs).toISOString() : null;
  const paymentDeadlineAt = serverPaymentDeadlineAtMs
    ? new Date(serverPaymentDeadlineAtMs).toISOString()
    : lockExpiresAtMs
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

export function useSeatStatus(showtimeId: string | null) {
  const queryClient = useQueryClient();
  const isConnected = useBookingStore((state) => state.isConnected);
  // Stable per viewer: a fresh random value on every render would keep
  // restarting TanStack's interval timer.
  const [jitter] = useState(() => Math.random());
  const refetchInterval = getSeatStatusPollInterval(isConnected, jitter);

  return useQuery({
    queryKey: seatStatusQueryKey(showtimeId),
    queryFn: () => {
      // Background resyncs must not toast every poll; only the first load does.
      const state = queryClient.getQueryState(seatStatusQueryKey(showtimeId));
      const isFirstLoad = !state || (state.dataUpdateCount === 0 && state.errorUpdateCount === 0);
      return apiClient.get<SeatStatusResponse>(
        `/api/v1/booking/schedules/${showtimeId}/seats`,
        { showErrorToast: isFirstLoad },
      );
    },
    enabled: !!showtimeId,
    staleTime: SEAT_STATUS_STALE_MS,
    refetchInterval: showtimeId ? refetchInterval : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useMyLocks(showtimeId: string | null) {
  return useQuery({
    queryKey: myLocksQueryKey(showtimeId),
    queryFn: async (): Promise<MyLocksSnapshot> => {
      const requestSeq = nextSeatSyncSequence();
      const response = await apiClient.get<MyLocksResponse>(
        `/api/v1/booking/my-locks/${showtimeId}`,
      );
      return { ...response, requestSeq };
    },
    enabled: !!showtimeId,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useBookingPaymentSnapshot(): BookingPaymentSnapshot {
  const queryClient = useQueryClient();
  const performanceId = useBookingStore((state) => state.performanceId);
  const lockExpiresAtMs = useBookingStore((state) => state.expiresAt);
  const serverPaymentDeadlineAtMs = useBookingStore((state) => state.paymentDeadlineAt);

  return useMemo(() => {
    const cachedPerformance = getCachedPerformanceDetail(queryClient, performanceId);
    return buildBookingPaymentSnapshot(
      lockExpiresAtMs,
      serverPaymentDeadlineAtMs,
      cachedPerformance?.bookingPolicy,
    );
  }, [lockExpiresAtMs, performanceId, queryClient, serverPaymentDeadlineAtMs]);
}

export interface SeatLockMutationOptions {
  /**
   * Called once the server answered (success or HTTP error). The seat page
   * uses it to know which my-locks snapshots already include this change.
   */
  onServerResponse?: () => void;
}

async function withServerResponse<T>(
  request: Promise<T>,
  onServerResponse: (() => void) | undefined,
): Promise<T> {
  try {
    return await request;
  } finally {
    onServerResponse?.();
  }
}

export function useLockSeat(options: SeatLockMutationOptions = {}) {
  const queryClient = useQueryClient();
  const performanceId = useBookingStore((state) => state.performanceId);
  const { bookingAvailable, bookingDisabledMessage, bookingEndedMessage, isAdmin } =
    useBookingAvailability();
  const { onServerResponse } = options;

  return useMutation({
    mutationFn: (data: LockSeatRequest) => {
      if (!bookingAvailable) {
        throw new BookingDisabledError(bookingDisabledMessage);
      }
      const cachedPerformance =
        getCachedPerformanceDetail(queryClient, performanceId)
        ?? getCachedPerformanceDetailForShowtime(queryClient, data.showtimeId);
      assertCachedPerformanceBookable(
        cachedPerformance,
        isAdmin,
        bookingDisabledMessage,
        bookingEndedMessage,
      );

      // The seat page owns lock feedback (per-seat toast + rollback).
      return withServerResponse(
        apiClient.post<LockSeatResponse>('/api/v1/booking/seats/lock', {
          showtimeId: data.showtimeId,
          seatId: toRuntimeSeatId(data),
        }, {
          showErrorToast: false,
        }),
        onServerResponse,
      );
    },
    // Hook-level callbacks run for every mutation. Per-call mutate() callbacks
    // are dropped when the next seat is clicked, so callers use mutateAsync.
    onSuccess: async (response, variables) => {
      // Same id format the server broadcasts in seat-update.
      const runtimeSeatId = toRuntimeSeatId(variables);
      const seatKey = toSeatStatusKey(runtimeSeatId);
      // A lock we now own cannot be superseded by another user's lock, so the
      // local patch is safe and avoids a full seat-status reload per click.
      queryClient.setQueryData<SeatStatusResponse>(
        seatStatusQueryKey(variables.showtimeId),
        (old) => (old ? { ...old, seats: { ...old.seats, [runtimeSeatId]: 'locked' } } : old),
      );
      const patched = await patchMyLocks(queryClient, variables.showtimeId, (old) => {
        const seatIds = old.seatIds.some((seatId) => toSeatStatusKey(seatId) === seatKey)
          ? old.seatIds
          : [...old.seatIds, runtimeSeatId];
        return { ...old, seatIds, expiresAt: response.expiresAt ?? old.expiresAt };
      });
      if (!patched) {
        // A first load still in flight may predate this lock: restart it.
        void queryClient.invalidateQueries({ queryKey: myLocksQueryKey(variables.showtimeId) });
      }
    },
    onError: (error, variables) => {
      if (error instanceof BookingDisabledError) {
        return;
      }
      // A conflict means our seat map is stale; a transport failure may
      // hide a lock that was created. Resync from the server.
      if (!(error instanceof ApiClientError) || error.statusCode === 409) {
        void queryClient.invalidateQueries({ queryKey: seatStatusQueryKey(variables.showtimeId) });
      }
      void queryClient.invalidateQueries({ queryKey: myLocksQueryKey(variables.showtimeId) });
    },
  });
}

export function useUnlockSeat(options: SeatLockMutationOptions = {}) {
  const queryClient = useQueryClient();
  const { onServerResponse } = options;
  return useMutation({
    mutationFn: ({
      showtimeId,
      seatId,
    }: {
      showtimeId: string;
      seatId: string;
    }) =>
      withServerResponse(
        apiClient.delete<void>(
          `/api/v1/booking/seats/lock/${encodeURIComponent(showtimeId)}/${encodeURIComponent(seatId)}`,
        ),
        onServerResponse,
      ),
    onMutate: async (variables) => {
      // Drop the seat from my-locks before the request so selection restore
      // cannot resurrect a seat the user just released.
      await patchMyLocks(queryClient, variables.showtimeId, (old) => removeMyLocks(old, [variables.seatId]));
    },
    onSuccess: (_data, variables) => {
      if (shouldPatchReleasedSeatsLocally()) {
        queryClient.setQueryData<SeatStatusResponse>(
          seatStatusQueryKey(variables.showtimeId),
          (old) => markSeatsAvailable(old, [variables.seatId]),
        );
      }
      void queryClient.invalidateQueries({
        queryKey: myLocksQueryKey(variables.showtimeId),
      });
    },
    onError: (_error, variables) => {
      void queryClient.invalidateQueries({ queryKey: seatStatusQueryKey(variables.showtimeId) });
      void queryClient.invalidateQueries({ queryKey: myLocksQueryKey(variables.showtimeId) });
    },
  });
}

export function useUnlockAllSeats(options: SeatLockMutationOptions = {}) {
  const queryClient = useQueryClient();
  const { onServerResponse } = options;
  return useMutation({
    mutationFn: ({ showtimeId }: { showtimeId: string }) =>
      withServerResponse(
        apiClient.delete<UnlockAllResponse>(
          `/api/v1/booking/seats/lock-all/${showtimeId}`,
        ),
        onServerResponse,
      ),
    onMutate: async (variables) => {
      await patchMyLocks(queryClient, variables.showtimeId, (old) => removeMyLocks(old, 'all'));
    },
    onSuccess: (response, variables) => {
      if (shouldPatchReleasedSeatsLocally()) {
        queryClient.setQueryData<SeatStatusResponse>(
          seatStatusQueryKey(variables.showtimeId),
          (old) => markSeatsAvailable(old, response?.unlockedSeats ?? []),
        );
      }
      void queryClient.invalidateQueries({
        queryKey: myLocksQueryKey(variables.showtimeId),
      });
    },
    onError: (_error, variables) => {
      void queryClient.invalidateQueries({ queryKey: seatStatusQueryKey(variables.showtimeId) });
      void queryClient.invalidateQueries({ queryKey: myLocksQueryKey(variables.showtimeId) });
    },
  });
}

// Payment-related hooks

export function usePrepareReservation() {
  const queryClient = useQueryClient();
  const { bookingAvailable, bookingDisabledMessage, bookingEndedMessage, isAdmin } =
    useBookingAvailability();
  const selectedSeats = useBookingStore((state) => state.selectedSeats);
  const performanceId = useBookingStore((state) => state.performanceId);

  return useMutation({
    mutationFn: (data: PrepareReservationRequest) => {
      if (!bookingAvailable) {
        throw new BookingDisabledError(bookingDisabledMessage);
      }

      const cachedPerformance =
        getCachedPerformanceDetail(queryClient, performanceId)
        ?? getCachedPerformanceDetailForShowtime(queryClient, data.showtimeId);
      assertCachedPerformanceBookable(
        cachedPerformance,
        isAdmin,
        bookingDisabledMessage,
        bookingEndedMessage,
      );
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

export function useReconcileAsyncPaymentReturn() {
  return useMutation({
    mutationFn: (data: {
      paymentKey: string;
      orderId: string;
      amount?: number;
      provider?: 'ALIPAY_PLUS' | 'TRUEMONEY';
    }) =>
      apiClient.post<{ acknowledged: true }>('/api/v1/payments/async-return', data, {
        showErrorToast: false,
      }),
  });
}

export function useBookingDetail(reservationId: string) {
  const userId = useAuthStore((store) => store.user?.id);
  const locale = getClientLocale();
  return useQuery({
    queryKey: ['reservations', reservationId, userId, locale],
    queryFn: () =>
      apiClient.get<ReservationDetail>(`/api/v1/reservations/${reservationId}?locale=${locale}`),
    enabled: !!reservationId && !!userId,
  });
}

export function useReservationByOrderId(orderId: string | null) {
  const userId = useAuthStore((store) => store.user?.id);
  const locale = getClientLocale();
  return useQuery({
    queryKey: ['reservations', 'orderId', userId, orderId, locale],
    queryFn: () =>
      apiClient.get<ReservationDetail>(`/api/v1/reservations?orderId=${encodeURIComponent(orderId!)}&locale=${locale}`),
    enabled: !!orderId && !!userId,
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
  const { enabled = !!orderId, pollIntervalMs = 2500 } = options;
  const userId = useAuthStore((store) => store.user?.id);
  const locale = getClientLocale();
  const reservationQuery = useQuery({
    queryKey: ['reservations', 'orderId', userId, orderId, locale],
    queryFn: () =>
      apiClient.get<ReservationDetail | null>(`/api/v1/reservations?orderId=${encodeURIComponent(orderId!)}&locale=${locale}`, { showErrorToast: false }),
    enabled: enabled && !!orderId && !!userId,
    retry: false,
  });

  const paymentDeadlineAt = reservationQuery.data?.paymentDeadlineAt ?? null;
  const paymentStatus = useMemo<BookingPaymentStatus>(() => {
    if (!enabled || !orderId || reservationQuery.isPending) return 'idle';
    const reservation = reservationQuery.data;
    if (reservationQuery.isError || !reservation || reservation.tossOrderId !== orderId) return 'unavailable';
    const state = getCheckoutState(reservation, reservationQuery.dataUpdatedAt);
    return state === 'ready' || state === 'processing' ? 'pending' : state;
  }, [enabled, orderId, reservationQuery.data, reservationQuery.dataUpdatedAt, reservationQuery.isError, reservationQuery.isPending]);

  const { refetch: refetchReservation } = reservationQuery;
  useEffect(() => {
    if (!enabled || !orderId || paymentStatus !== 'pending') {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void refetchReservation();
    }, pollIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    enabled,
    orderId,
    paymentStatus,
    pollIntervalMs,
    refetchReservation,
  ]);

  return {
    ...reservationQuery,
    paymentStatus,
    paymentDeadlineAt,
    reservation: reservationQuery.data ?? null,
  };
}

export function useCancelPendingReservation(options?: { showErrorToast?: boolean }) {
  return useMutation({
    mutationFn: (reservationId: string) =>
      apiClient.put<void>(`/api/v1/reservations/${reservationId}/cancel-pending`, undefined, options),
  });
}
