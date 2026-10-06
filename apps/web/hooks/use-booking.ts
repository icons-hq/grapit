import { getClientLocale } from '@/lib/i18n/client-copy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hashKey, useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiClientError, apiClient } from '@/lib/api-client';
import { BookingDisabledError } from '@/lib/runtime-flags';
import { getServerClockOffsetMs, getServerNowMs } from '@/lib/server-clock';
import { useBookingAvailability } from '@/hooks/use-booking-availability';
import { useServerTimeReached } from '@/hooks/use-server-clock';
import { useBookingStore } from '@/stores/use-booking-store';
import { useAuthStore } from '@/stores/use-auth-store';
import { getCheckoutState } from '@/lib/booking/checkout-state';
import { nextSeatSyncSequence } from '@/lib/booking/seat-sync-sequence';
import { refetchAfterInFlight } from '@/lib/booking/seat-resync';
import { overlayRecentSeatEvents } from '@/lib/booking/seat-event-overlay';
import {
  CONFIRM_PAYMENT_MAX_RETRIES,
  getConfirmPaymentRetryDelayMs,
  isRetryableConfirmPaymentError,
} from '@/lib/booking/payment-return';
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
  SeatState,
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
 * While connected the socket carries every lock/unlock, so the poll only has
 * to catch TTL expiry (10 min holds) and stays slow: 30-60 s. While the
 * socket is down (including after reconnect_failed) it is the only sync
 * path: 10-20 s. The per-viewer jitter spreads requests from viewers who
 * opened together.
 */
export const SEAT_STATUS_POLL_CONNECTED_MS = 30_000;
export const SEAT_STATUS_POLL_DISCONNECTED_MS = 10_000;
const SEAT_STATUS_POLL_JITTER_RATIO = 1;
/** Window focus refetches skip data younger than this (mobile app switches). */
const SEAT_STATUS_STALE_MS = 15_000;
/**
 * Minimum spacing of lock-failure resyncs per query. Repeated failures inside
 * the window share one trailing reload instead of one reload per click.
 */
export const LOCK_FAILURE_RESYNC_COOLDOWN_MS = 10_000;

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
 * it is cancelled first. Without cached data (first load still in flight, or
 * failed) nothing is patched and false is returned; the first load cannot be
 * cancelled and restarted (TanStack shares it with every new fetch).
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
 * Server 409 messages (Korean, optional trailing period) that mean the seat
 * itself is not available, with the seat-status they imply. Any other 409
 * (per-user/per-performance limits) is about the user, not the seat.
 */
const SEAT_CONFLICT_STATES: ReadonlyArray<readonly [message: string, state: SeatState]> = [
  ['이미 다른 사용자가 선택한 좌석입니다', 'locked'],
  ['이미 판매된 좌석입니다', 'sold'],
  ['환불 처리 중인 좌석입니다', 'held'],
  ['운영자가 판매를 중지한 좌석입니다', 'disabled'],
];

function normalizeServerMessage(message: string): string {
  return message.trim().replace(/[.!]+$/u, '');
}

/** Seat-status implied by a seat-level lock conflict, or null for any other error. */
export function getSeatConflictState(error: unknown): SeatState | null {
  if (!(error instanceof ApiClientError) || error.statusCode !== 409) {
    return null;
  }
  const message = normalizeServerMessage(error.message);
  return SEAT_CONFLICT_STATES.find(([candidate]) => candidate === message)?.[1] ?? null;
}

/**
 * Invalidates a query at most once per cooldown. A call inside the cooldown
 * schedules one trailing reload at the end of the window (later calls join
 * it), so the last failure is still followed by a reload.
 */
function useCooldownInvalidate(cooldownMs: number) {
  const queryClient = useQueryClient();
  const entriesRef = useRef(new Map<string, { lastAt: number; timer: ReturnType<typeof setTimeout> | null }>());

  useEffect(() => {
    const entries = entriesRef.current;
    return () => {
      for (const entry of entries.values()) {
        if (entry.timer !== null) clearTimeout(entry.timer);
      }
      entries.clear();
    };
  }, []);

  return useCallback((queryKey: QueryKey, options: { cancelRefetch: boolean }) => {
    const id = hashKey(queryKey);
    let entry = entriesRef.current.get(id);
    if (!entry) {
      entry = { lastAt: Number.NEGATIVE_INFINITY, timer: null };
      entriesRef.current.set(id, entry);
    }
    if (entry.timer !== null) {
      return;
    }
    const scheduled = entry;
    const run = () => {
      scheduled.timer = null;
      scheduled.lastAt = Date.now();
      void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: options.cancelRefetch });
    };
    const waitMs = scheduled.lastAt + cooldownMs - Date.now();
    if (waitMs <= 0) {
      run();
    } else {
      scheduled.timer = setTimeout(run, waitMs);
    }
  }, [cooldownMs, queryClient]);
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
  /**
   * The instant payment can no longer start: the server payment deadline once prepare
   * issued one, before that the checkout deadline (seat lock or queue access window,
   * whichever ends first). The server counts its payment window from prepare, so the
   * time spent on the review screen does not shorten it (audit #95).
   */
  paymentDeadlineAt: string | null;
  lockExpiresAt: string | null;
  bookingPolicy: BookingPolicy;
  allowedPaymentMethods: PerformanceBookingPolicy['allowedPaymentMethods'];
  /** False when the performance policy is not cached (e.g. a reload); the list is then only a fallback. */
  allowedPaymentMethodsKnown: boolean;
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
  now = getServerNowMs(),
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

/**
 * The checkout deadline the pay button follows: the server payment deadline once prepare
 * issued one, otherwise the booking store's `expiresAt` (seat lock and queue access
 * window, whichever ends first). Both are server instants.
 */
function resolveCheckoutDeadlineMs(
  lockExpiresAtMs: number | null,
  serverPaymentDeadlineAtMs: number | null,
): number | null {
  const deadline = serverPaymentDeadlineAtMs ?? lockExpiresAtMs;
  return typeof deadline === 'number' && Number.isFinite(deadline) && deadline > 0
    ? deadline
    : null;
}

function buildBookingPaymentSnapshot(
  lockExpiresAtMs: number | null,
  serverPaymentDeadlineAtMs: number | null,
  performancePolicy?: PerformanceBookingPolicy,
): BookingPaymentSnapshot {
  const paymentWindowMinutes = performancePolicy?.paymentWindowMinutes ?? DEFAULT_PAYMENT_WINDOW_MINUTES;
  const seatHoldMinutes = performancePolicy?.seatHoldMinutes ?? DEFAULT_SEAT_HOLD_MINUTES;
  const lockExpiresAt = lockExpiresAtMs ? new Date(lockExpiresAtMs).toISOString() : null;
  // No "screen entry + payment window" estimate: the server starts the payment window at
  // prepare, so an estimate would block the pay button while the lock and the queue
  // access window are still open.
  const paymentDeadlineAtMs = resolveCheckoutDeadlineMs(lockExpiresAtMs, serverPaymentDeadlineAtMs);
  const paymentDeadlineAt = paymentDeadlineAtMs !== null
    ? new Date(paymentDeadlineAtMs).toISOString()
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
    allowedPaymentMethodsKnown: Boolean(performancePolicy?.allowedPaymentMethods?.length),
    isPaymentDeadlineExpired: paymentDeadlineAt
      ? new Date(paymentDeadlineAt).getTime() <= getServerNowMs()
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
    queryFn: async () => {
      // Background resyncs must not toast every poll; only the first load does.
      const state = queryClient.getQueryState(seatStatusQueryKey(showtimeId));
      const isFirstLoad = !state || (state.dataUpdateCount === 0 && state.errorUpdateCount === 0);
      const requestStartedAtMs = Date.now();
      const response = await apiClient.get<SeatStatusResponse>(
        `/api/v1/booking/schedules/${showtimeId}/seats`,
        { showErrorToast: isFirstLoad },
      );
      // The snapshot can predate seat-update events already applied from the
      // socket (it is cached up to 1s, see generatedAt); keep those events.
      return showtimeId
        ? overlayRecentSeatEvents(showtimeId, response, { requestStartedAtMs })
        : response;
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

  const snapshot = useMemo(() => {
    const cachedPerformance = getCachedPerformanceDetail(queryClient, performanceId);
    return buildBookingPaymentSnapshot(
      lockExpiresAtMs,
      serverPaymentDeadlineAtMs,
      cachedPerformance?.bookingPolicy,
    );
  }, [lockExpiresAtMs, performanceId, queryClient, serverPaymentDeadlineAtMs]);
  // The snapshot is built once per deadline; expiry must still flip on time, and only at
  // a real deadline (server payment deadline, else seat lock or queue access window).
  const isPaymentDeadlineExpired = useServerTimeReached(
    resolveCheckoutDeadlineMs(lockExpiresAtMs, serverPaymentDeadlineAtMs),
  );

  return useMemo(
    () => ({ ...snapshot, isPaymentDeadlineExpired }),
    [isPaymentDeadlineExpired, snapshot],
  );
}

export interface SeatLockMutationOptions {
  /**
   * Called with the request's showtime once the server answered (success or
   * HTTP error). The seat page uses it to know which my-locks snapshots of
   * that showtime already include this change.
   */
  onServerResponse?: (showtimeId: string) => void;
}

async function withServerResponse<T>(
  request: Promise<T>,
  showtimeId: string,
  onServerResponse: ((showtimeId: string) => void) | undefined,
): Promise<T> {
  try {
    return await request;
  } finally {
    onServerResponse?.(showtimeId);
  }
}

export function useLockSeat(options: SeatLockMutationOptions = {}) {
  const queryClient = useQueryClient();
  const performanceId = useBookingStore((state) => state.performanceId);
  const { bookingAvailable, bookingDisabledMessage, bookingEndedMessage, isAdmin } =
    useBookingAvailability();
  const { onServerResponse } = options;
  const resyncAfterLockFailure = useCooldownInvalidate(LOCK_FAILURE_RESYNC_COOLDOWN_MS);

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
        data.showtimeId,
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
        // The first load is still in flight and may predate this lock (the
        // page then rejects it as older than this response). Read my-locks
        // once more after it lands, so holds from before a reload are still
        // restored.
        void refetchAfterInFlight(queryClient, myLocksQueryKey(variables.showtimeId));
      }
    },
    onError: (error, variables) => {
      if (error instanceof BookingDisabledError) {
        return;
      }
      // No full seat-status reload here: at an open peak most clicks end in a
      // conflict, and a reload per conflict is the O(N) per-click load that
      // audit #8 removed. Seats elsewhere on the map resync via polling.
      const conflictState = getSeatConflictState(error);
      if (conflictState) {
        // Only this seat was stale on our map; the rejected lock changed
        // nothing we hold.
        const runtimeSeatId = toRuntimeSeatId(variables);
        queryClient.setQueryData<SeatStatusResponse>(
          seatStatusQueryKey(variables.showtimeId),
          (old) => (old && old.seats[runtimeSeatId] !== conflictState
            ? { ...old, seats: { ...old.seats, [runtimeSeatId]: conflictState } }
            : old),
        );
        if (conflictState === 'locked') {
          // The server answers the same way when the seat is already ours
          // (another tab, or a lock whose response was lost). Read my-locks
          // back (rate-limited) so such a hold is restored as ours instead of
          // staying "taken by someone else".
          resyncAfterLockFailure(myLocksQueryKey(variables.showtimeId), { cancelRefetch: true });
        }
        return;
      }
      if (error instanceof ApiClientError && error.statusCode < 500) {
        if (error.statusCode === 409) {
          // A per-user limit: the user may hold locks this page does not show
          // (another tab, a lost response). Reload my-locks so they can be
          // restored and released.
          resyncAfterLockFailure(myLocksQueryKey(variables.showtimeId), { cancelRefetch: true });
        }
        // 401/403/429: nothing was locked.
        return;
      }
      // Transport failure or 5xx: the lock may have been created. A created
      // lock is broadcast to the seat map; my-locks must be read back so the
      // selection can restore (and release) it.
      resyncAfterLockFailure(myLocksQueryKey(variables.showtimeId), { cancelRefetch: true });
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
        showtimeId,
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
        showtimeId,
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
    // The confirm response renders the complete screen, so it needs the display locale too.
    mutationFn: (data: ConfirmPaymentRequest) =>
      apiClient.post<ReservationDetail>(
        `/api/v1/payments/confirm?locale=${encodeURIComponent(getClientLocale())}`,
        data,
        { showErrorToast: false },
      ),
    // Only the browser holds the paymentKey; the server cannot approve on its own.
    // A transient failure must not let the authenticated payment expire unconfirmed.
    retry: (failureCount, error) =>
      failureCount < CONFIRM_PAYMENT_MAX_RETRIES && isRetryableConfirmPaymentError(error),
    retryDelay: (failureCount) => getConfirmPaymentRetryDelayMs(failureCount),
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
    const state = getCheckoutState(
      reservation,
      reservationQuery.dataUpdatedAt + getServerClockOffsetMs(),
    );
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
