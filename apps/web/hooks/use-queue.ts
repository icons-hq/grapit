'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { PerformanceWithDetails } from '@grabit/shared';
import { ApiClientError, apiClient } from '@/lib/api-client';
import { SHOWTIME_SALES_CLOSED_MESSAGE } from '@/lib/booking/showtime-sales';
import { getServerClockOffsetMs, getServerNowMs } from '@/lib/server-clock';

const AUTO_ENTER_DELAY_MS = 1_200;
const WAITING_POLL_INTERVAL_MS = 15_000;
const WAITING_POLL_JITTER_MS = 5_000;
// Fast enter responses (immediate admission) skip the queue surface; slower
// ones show the loading surface instead of a blank screen.
export const QUEUE_LOADING_SURFACE_DELAY_MS = 600;
// Spread the automatic re-entry at the booking open time over a few seconds.
export const QUEUE_OPEN_RETRY_JITTER_MS = 3_000;
// Without a known open time, re-check entry at this interval (plus jitter);
// well inside the 20/min queue-entry limit, so refreshing is never faster.
export const QUEUE_OPEN_UNKNOWN_RETRY_MS = 15_000;
// Re-check long pre-open waits so a moved open time is picked up.
export const QUEUE_OPEN_MAX_WAIT_MS = 5 * 60_000;
// The open time read from performance detail (before the 403 body carries it)
// is reused only for this long.
export const QUEUE_OPEN_TIME_CACHE_MS = 60_000;
// The open time has passed but entry is still refused (moved open time or
// clock skew): back off instead of retrying in a tight loop.
export const QUEUE_OPEN_OVERDUE_RETRY_BASE_MS = 2_000;
export const QUEUE_OPEN_OVERDUE_RETRY_MAX_MS = 60_000;
// Automatic re-entry hitting 429/5xx/network errors keeps the not-open surface
// and retries with these delays before falling back to the manual retry surface.
export const QUEUE_OPEN_TRANSIENT_RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;
// After the booking screen is shown the queue socket is closed, so the
// admission window end is confirmed with a single status request instead.
export const QUEUE_ADMISSION_CHECK_GRACE_MS = 2_000;
export const QUEUE_ADMISSION_RECHECK_MS = 15_000;

const BOOKING_NOT_OPEN_ERROR_CODE = 'BOOKING_NOT_OPEN';
const BOOKING_NOT_OPEN_MESSAGE = '예매는 추후 오픈 예정입니다';
const PERFORMANCE_NOT_FOUND_ERROR_CODE = 'PERFORMANCE_NOT_FOUND';
const PERFORMANCE_NOT_FOUND_MESSAGE = '공연을 찾을 수 없습니다';
const BOOKING_CLOSED_ERROR_CODES = new Set([
  'BOOKING_ENDED',
  'NO_BOOKABLE_SHOWTIME',
  'PERFORMANCE_NOT_FOUND',
]);
const BOOKING_CLOSED_MESSAGES = new Set([
  '판매가 종료된 공연입니다',
  // C1 cutoff: one web definition with the seat/date pickers (showtime-sales.ts).
  SHOWTIME_SALES_CLOSED_MESSAGE,
  '예매 가능한 회차가 없습니다.',
  '공연을 찾을 수 없습니다',
]);

type QueueTransportState =
  | 'WAITING'
  | 'ADMITTED'
  | 'PAYMENT_RECOVERY'
  | 'EXPIRED';

export type QueueStatus =
  | 'loading'
  | 'notOpen'
  | 'waiting'
  | 'admitted'
  | 'expired'
  | 'closed'
  | 'authRequired'
  | 'retry'
  | 'challenge'
  | 'blocked';

// Why the closed surface is shown: the performance does not exist (or the id
// is malformed), or it exists but nothing can be booked now.
export type QueueClosedReason = 'notFound' | 'unavailable';

type QueueSnapshot = {
  queueSessionId: string;
  state: QueueTransportState;
  position: number;
  waitingCount: number;
  // Upper bound of the wait; etaMinSeconds is the lower bound.
  etaSeconds: number;
  etaMinSeconds?: number;
  etaUnavailable?: boolean;
  remainingSeats: number;
  autoEnter: boolean;
  admittedAt: string | null;
  activeUntilAt: string | null;
  reentryGraceUntilAt: string | null;
  // End of the payment recovery of a PAYMENT_RECOVERY session (older APIs
  // omit it; reentryGraceUntilAt is the same instant there).
  paymentRecoveryUntilAt?: string | null;
  // Set on a PAYMENT_RECOVERY session whose seat window closed while an order
  // still awaits payment: only that payment may continue, not the seat screen.
  recoveryOrderId?: string | null;
};

type QueueEnterResponse = QueueSnapshot & {
  queueActiveWindowSeconds?: number;
};

type QueueExpiredEvent = {
  queueSessionId: string;
  state: 'EXPIRED';
  autoEnter: boolean;
};

type UseQueueOptions = {
  performanceId: string;
  enabled?: boolean;
};

type UseQueueResult = {
  status: QueueStatus;
  queueSessionId: string | null;
  position: number;
  waitingCount: number;
  etaSeconds: number;
  etaMinSeconds: number;
  etaUnavailable: boolean;
  remainingSeats: number;
  autoEnter: boolean;
  isReady: boolean;
  isSlowLoading: boolean;
  bookingOpensAt: number | null;
  closedReason: QueueClosedReason | null;
  admittedAt: string | null;
  activeUntilAt: string | null;
  reentryGraceUntilAt: string | null;
  /** Order awaiting payment when only payment recovery is allowed. */
  recoveryOrderId: string | null;
  /**
   * The server answered that the last admission ended with no order awaiting
   * payment (EXPIRED, a waiting position, a closed sale, a missing session),
   * so the seats it held may be released. False while no such answer arrived:
   * an entry or check in flight, a transient failure, payment recovery, and a
   * closed PAYMENT_RECOVERY admission without `recoveryOrderId` (an older API
   * that does not say whether an order still awaits payment).
   */
  accessEndedByServer: boolean;
  retry: () => Promise<void>;
  /** Reads the current session status at once (e.g. after a queue 403). */
  recheck: () => Promise<void>;
  enterNow: () => void;
};

const EMPTY_SNAPSHOT: QueueSnapshot = {
  queueSessionId: '',
  state: 'WAITING',
  position: 0,
  waitingCount: 0,
  etaSeconds: 0,
  etaMinSeconds: 0,
  etaUnavailable: false,
  remainingSeats: 0,
  autoEnter: false,
  admittedAt: null,
  activeUntilAt: null,
  reentryGraceUntilAt: null,
};

function resolveQueueSocketUrl(): string {
  return (
    process.env.NEXT_PUBLIC_WS_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    ''
  ).replace(/\/+$/, '');
}

function createQueueSocket(): Socket {
  return io(`${resolveQueueSocketUrl()}/queue`, {
    transports: ['websocket', 'polling'],
    withCredentials: true,
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 5_000,
  });
}

function isAdmittedState(state: QueueTransportState): boolean {
  return state === 'ADMITTED' || state === 'PAYMENT_RECOVERY';
}

function isImmediateAdmission(snapshot: QueueSnapshot): boolean {
  return (
    isAdmittedState(snapshot.state) &&
    snapshot.autoEnter &&
    snapshot.position === 0 &&
    snapshot.waitingCount === 0
  );
}

/**
 * A PAYMENT_RECOVERY session bound to an order still awaiting payment after
 * its seat window closed. Seat locks and prepare are refused for it, so it
 * never opens the seat screen; the route offers to continue that payment.
 */
function isRecoveryOnly(snapshot: QueueSnapshot): boolean {
  return (
    snapshot.state === 'PAYMENT_RECOVERY' &&
    typeof snapshot.recoveryOrderId === 'string' &&
    snapshot.recoveryOrderId.length > 0
  );
}

/**
 * An admission whose seat window (activeUntilAt) already closed on the
 * server-corrected clock. Seat locks and prepare would be refused, so it must
 * not open (or keep) the seat screen.
 */
function isClosedAdmission(snapshot: QueueSnapshot): boolean {
  const activeUntilAtMs = parseTimeMs(snapshot.activeUntilAt);
  return activeUntilAtMs !== null && getServerNowMs() >= activeUntilAtMs;
}

function parseTimeMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readErrorField(error: ApiClientError, key: string): unknown {
  const data = error.data;
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  return (data as Record<string, unknown>)[key];
}

/** Whether the error body carries the field at all (`null` included). */
function hasErrorField(error: ApiClientError, key: string): boolean {
  const data = error.data;
  return Boolean(data) && typeof data === 'object' && Object.hasOwn(data as object, key);
}

function isBookingNotOpenError(error: unknown): error is ApiClientError {
  return (
    error instanceof ApiClientError &&
    error.statusCode === 403 &&
    (readErrorField(error, 'errorCode') === BOOKING_NOT_OPEN_ERROR_CODE ||
      error.message === BOOKING_NOT_OPEN_MESSAGE)
  );
}

function isBookingClosedError(error: ApiClientError): boolean {
  if (error.statusCode === 400) {
    // Malformed performance id on queue entry.
    return true;
  }

  if (error.statusCode !== 403 && error.statusCode !== 404) {
    return false;
  }

  const errorCode = readErrorField(error, 'errorCode');
  return (
    (typeof errorCode === 'string' && BOOKING_CLOSED_ERROR_CODES.has(errorCode)) ||
    BOOKING_CLOSED_MESSAGES.has(error.message)
  );
}

function resolveClosedReason(error: unknown): QueueClosedReason {
  if (!(error instanceof ApiClientError)) {
    return 'unavailable';
  }

  if (
    error.statusCode === 400 ||
    readErrorField(error, 'errorCode') === PERFORMANCE_NOT_FOUND_ERROR_CODE ||
    error.message === PERFORMANCE_NOT_FOUND_MESSAGE
  ) {
    return 'notFound';
  }

  return 'unavailable';
}

/**
 * Failures that say nothing about the queue itself (rate limit, server or
 * network trouble). The automatic re-entry at the open time retries these
 * instead of showing the manual retry surface at the busiest moment.
 */
function isTransientEntryError(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) {
    // fetch rejected: network failure or aborted request.
    return true;
  }

  if (mapSecurityError(error)) {
    return false;
  }

  return (
    error.statusCode === 429 ||
    error.statusCode >= 500 ||
    error.message === 'TRAFFIC_RATE_LIMITED'
  );
}

function openRetryJitterMs(): number {
  return Math.floor(Math.random() * QUEUE_OPEN_RETRY_JITTER_MS);
}

function mapSecurityError(error: ApiClientError): QueueStatus | null {
  if (error.statusCode === 401) {
    return 'authRequired';
  }

  if (error.statusCode === 403 && error.message === 'SECURITY_CHALLENGE_REQUIRED') {
    return 'challenge';
  }

  if (error.statusCode === 403 && error.message === 'SECURITY_BLOCKED') {
    return 'blocked';
  }

  return null;
}

function mapQueueEntryError(error: unknown): QueueStatus {
  if (error instanceof ApiClientError) {
    const securityStatus = mapSecurityError(error);
    if (securityStatus) {
      return securityStatus;
    }

    if (
      error.statusCode === 429 ||
      error.message === 'TRAFFIC_RATE_LIMITED'
    ) {
      return 'retry';
    }

    if (isBookingClosedError(error)) {
      return 'closed';
    }

    if (
      error.statusCode === 403 &&
      error.message.includes('만료')
    ) {
      return 'expired';
    }
  }

  return 'retry';
}

/**
 * Status poll / admission check failures. A sale that closed meanwhile (403
 * with a closed-sale code or message, e.g. NO_BOOKABLE_SHOWTIME) moves to the
 * closed surface. Any other missing (404) or rejected (403) session cannot
 * recover on its own, so it moves to the re-entry surface. Anything else
 * (429, 5xx, network) is transient: keep the current surface and let the next
 * scheduled check retry. Returns null for transient errors.
 */
function mapQueueSessionError(error: unknown): QueueStatus | null {
  if (!(error instanceof ApiClientError)) {
    return null;
  }

  const securityStatus = mapSecurityError(error);
  if (securityStatus) {
    return securityStatus;
  }

  if (error.statusCode === 403 && isBookingClosedError(error)) {
    return 'closed';
  }

  if (error.statusCode === 404 || error.statusCode === 403) {
    return 'expired';
  }

  return null;
}

/**
 * When the route asks the server whether the admission ended: at the seat
 * window end while the seat screen is shown, and at the payment recovery end
 * for a recovery-only session.
 */
function resolveAdmissionCheckAt(snapshot: QueueSnapshot): number | null {
  if (isRecoveryOnly(snapshot)) {
    return (
      parseTimeMs(snapshot.paymentRecoveryUntilAt) ??
      parseTimeMs(snapshot.reentryGraceUntilAt)
    );
  }

  if (isAdmittedState(snapshot.state)) {
    return parseTimeMs(snapshot.activeUntilAt);
  }

  return null;
}

async function fetchBookingStartsAtMs(performanceId: string): Promise<number | null> {
  try {
    const performance = await apiClient.get<PerformanceWithDetails>(
      `/api/v1/performances/${encodeURIComponent(performanceId)}`,
      { showErrorToast: false },
    );
    return parseTimeMs(performance?.bookingPolicy?.bookingStartsAt);
  } catch {
    return null;
  }
}

export function useQueue({
  performanceId,
  enabled = true,
}: UseQueueOptions): UseQueueResult {
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(EMPTY_SNAPSHOT);
  const [status, setStatus] = useState<QueueStatus>('loading');
  const [isReady, setIsReady] = useState(false);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const [bookingOpensAt, setBookingOpensAt] = useState<number | null>(null);
  const [closedReason, setClosedReason] = useState<QueueClosedReason | null>(null);
  const [accessEndedByServer, setAccessEndedByServer] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const autoEnterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingSurfaceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReadyRef = useRef(false);
  // Bumped when the entry effect is torn down so in-flight entry attempts do
  // not schedule retries for an unmounted or disabled route.
  const entryGenerationRef = useRef(0);
  const bookingStartsAtFallbackRef = useRef<{
    performanceId: string;
    startsAtMs: number | null;
    fetchedAtMs: number;
  } | null>(null);
  // Consecutive not-open answers after the known open time already passed.
  const overdueOpenRetryCountRef = useRef(0);
  // Consecutive transient failures of the automatic (background) re-entry.
  const transientEntryRetryCountRef = useRef(0);
  // An admission whose seat window had already closed is re-entered once on
  // its own; reset by every entry the user starts.
  const closedAdmissionReentryUsedRef = useRef(false);
  const enterQueueRef = useRef<(options?: { background?: boolean }) => Promise<void>>(
    async () => undefined,
  );

  const updateReady = useCallback((ready: boolean) => {
    isReadyRef.current = ready;
    setIsReady(ready);
  }, []);

  const clearAutoEnterTimer = useCallback(() => {
    if (autoEnterTimerRef.current) {
      clearTimeout(autoEnterTimerRef.current);
      autoEnterTimerRef.current = null;
    }
  }, []);

  const clearLoadingSurfaceTimer = useCallback(() => {
    if (loadingSurfaceTimerRef.current) {
      clearTimeout(loadingSurfaceTimerRef.current);
      loadingSurfaceTimerRef.current = null;
    }
  }, []);

  const clearEntryRetryTimer = useCallback(() => {
    if (entryRetryTimerRef.current) {
      clearTimeout(entryRetryTimerRef.current);
      entryRetryTimerRef.current = null;
    }
  }, []);

  const scheduleEntryRetry = useCallback(
    (delayMs: number) => {
      clearEntryRetryTimer();
      entryRetryTimerRef.current = setTimeout(() => {
        entryRetryTimerRef.current = null;
        void enterQueueRef.current({ background: true });
      }, delayMs);
    },
    [clearEntryRetryTimer],
  );

  const applySnapshot = useCallback(
    (
      nextSnapshot: QueueSnapshot,
      options: { enterImmediately?: boolean } = {},
    ) => {
      setSnapshot(nextSnapshot);

      if (nextSnapshot.state === 'EXPIRED') {
        clearAutoEnterTimer();
        setAccessEndedByServer(true);
        setStatus('expired');
        updateReady(false);
        return;
      }

      if (isRecoveryOnly(nextSnapshot)) {
        // Only the bound order's payment may continue (the route offers it);
        // the seat screen would refuse every seat lock.
        clearAutoEnterTimer();
        setAccessEndedByServer(false);
        setStatus('admitted');
        updateReady(false);
        return;
      }

      if (isAdmittedState(nextSnapshot.state)) {
        if (isClosedAdmission(nextSnapshot)) {
          // Defensive: the server should not hand out an admission whose seat
          // window already closed. Show the re-entry surface instead of a
          // seat screen without a countdown, and enter once more on its own.
          // A closed ADMITTED session never prepared an order; a closed
          // PAYMENT_RECOVERY one without recoveryOrderId (older API) may
          // still have one awaiting payment, so its seats stay.
          clearAutoEnterTimer();
          setAccessEndedByServer(nextSnapshot.state === 'ADMITTED');
          setStatus('expired');
          updateReady(false);
          if (!closedAdmissionReentryUsedRef.current) {
            closedAdmissionReentryUsedRef.current = true;
            scheduleEntryRetry(0);
          }
          return;
        }

        setAccessEndedByServer(false);
        setStatus('admitted');
        if (isReadyRef.current) {
          // Already on the booking screen: a refreshed admitted snapshot must
          // not unmount it again.
          return;
        }

        clearAutoEnterTimer();
        if (options.enterImmediately && nextSnapshot.autoEnter) {
          updateReady(true);
        } else {
          updateReady(false);
          autoEnterTimerRef.current = setTimeout(() => {
            updateReady(true);
          }, AUTO_ENTER_DELAY_MS);
        }
        return;
      }

      // A waiting position (a new one after the admission ended, see the queue
      // re-entry contract) holds no seats and no order.
      clearAutoEnterTimer();
      setAccessEndedByServer(true);
      setStatus('waiting');
      updateReady(false);
    },
    [clearAutoEnterTimer, scheduleEntryRetry, updateReady],
  );

  const handleSessionError = useCallback(
    (error: unknown) => {
      const nextStatus = mapQueueSessionError(error);
      if (!nextStatus) {
        return;
      }

      clearAutoEnterTimer();
      setAccessEndedByServer(nextStatus === 'closed' || nextStatus === 'expired');
      setClosedReason(nextStatus === 'closed' ? resolveClosedReason(error) : null);
      setStatus(nextStatus);
      updateReady(false);
    },
    [clearAutoEnterTimer, updateReady],
  );

  const loadQueueSession = useCallback(
    async (queueSessionId: string) => {
      const response = await apiClient.get<QueueSnapshot>(
        `/api/v1/queue/sessions/${queueSessionId}`,
        { showErrorToast: false },
      );
      applySnapshot(response, {
        enterImmediately: isImmediateAdmission(response),
      });
    },
    [applySnapshot],
  );

  // Delay until the next automatic entry attempt after a not-open answer.
  const resolveNotOpenRetryDelay = useCallback((opensAtMs: number | null): number => {
    const nowMs = Date.now();
    if (opensAtMs === null) {
      overdueOpenRetryCountRef.current = 0;
      return QUEUE_OPEN_UNKNOWN_RETRY_MS + openRetryJitterMs();
    }

    if (opensAtMs > nowMs) {
      overdueOpenRetryCountRef.current = 0;
      return Math.min(opensAtMs - nowMs, QUEUE_OPEN_MAX_WAIT_MS) + openRetryJitterMs();
    }

    // The open time has passed but the server still refuses entry.
    const overdueCount = overdueOpenRetryCountRef.current;
    overdueOpenRetryCountRef.current = overdueCount + 1;
    return (
      Math.min(
        QUEUE_OPEN_OVERDUE_RETRY_BASE_MS * 2 ** overdueCount,
        QUEUE_OPEN_OVERDUE_RETRY_MAX_MS,
      ) + openRetryJitterMs()
    );
  }, []);

  const resolveBookingOpensAt = useCallback(
    async (error: ApiClientError, receivedAtMs: number): Promise<number | null> => {
      const serverNowMs =
        parseTimeMs(readErrorField(error, 'serverNow')) ??
        parseTimeMs(readErrorField(error, 'timestamp'));
      // Without a server time in the body, use the offset measured from other
      // responses: the device clock alone would delay a slow device's entry.
      const clockOffsetMs =
        serverNowMs === null ? getServerClockOffsetMs() : serverNowMs - receivedAtMs;
      // Convert a server open time into this device's clock.
      const toDeviceClock = (startsAtMs: number | null) =>
        startsAtMs === null ? null : startsAtMs - clockOffsetMs;

      if (hasErrorField(error, 'bookingStartsAt')) {
        // The API states the open time, `null` meaning "not scheduled yet";
        // reading the public detail again would only add a counted view.
        return toDeviceClock(parseTimeMs(readErrorField(error, 'bookingStartsAt')));
      }

      // Older API bodies without bookingStartsAt: read it from performance
      // detail. Reuse that only while it is fresh, and never once the cached
      // open time has passed while the server still refuses entry: the open
      // time was moved, so read it again instead of looping on the old one.
      const cached = bookingStartsAtFallbackRef.current;
      if (
        cached?.performanceId === performanceId &&
        receivedAtMs - cached.fetchedAtMs < QUEUE_OPEN_TIME_CACHE_MS
      ) {
        const cachedOpensAtMs = toDeviceClock(cached.startsAtMs);
        const fetchedBeforeOverdueOpen =
          cachedOpensAtMs !== null &&
          cachedOpensAtMs <= receivedAtMs &&
          cached.fetchedAtMs < cachedOpensAtMs;
        if (!fetchedBeforeOverdueOpen) {
          return cachedOpensAtMs;
        }
      }

      const startsAtMs = await fetchBookingStartsAtMs(performanceId);
      bookingStartsAtFallbackRef.current = {
        performanceId,
        startsAtMs,
        fetchedAtMs: Date.now(),
      };
      return toDeviceClock(startsAtMs);
    },
    [performanceId],
  );

  const enterQueue = useCallback(
    async (options: { background?: boolean } = {}) => {
      if (!enabled || !performanceId) {
        return;
      }

      const generation = entryGenerationRef.current;
      clearAutoEnterTimer();
      clearEntryRetryTimer();
      if (!options.background) {
        transientEntryRetryCountRef.current = 0;
        closedAdmissionReentryUsedRef.current = false;
        // The entry's answer decides again whether the last admission ended.
        setAccessEndedByServer(false);
        setStatus('loading');
        updateReady(false);
        setLoadingSlow(false);
        clearLoadingSurfaceTimer();
        loadingSurfaceTimerRef.current = setTimeout(() => {
          loadingSurfaceTimerRef.current = null;
          setLoadingSlow(true);
        }, QUEUE_LOADING_SURFACE_DELAY_MS);
      }

      try {
        const response = await apiClient.post<QueueEnterResponse>(
          `/api/v1/queue/performances/${performanceId}/enter`,
          undefined,
          { showErrorToast: false },
        );

        transientEntryRetryCountRef.current = 0;
        overdueOpenRetryCountRef.current = 0;
        setBookingOpensAt(null);
        setClosedReason(null);
        if (!response.queueSessionId) {
          setStatus('retry');
          return;
        }

        if (!response.state) {
          await loadQueueSession(response.queueSessionId);
          return;
        }

        applySnapshot(response, {
          enterImmediately: isImmediateAdmission(response),
        });
      } catch (error) {
        updateReady(false);
        if (isBookingNotOpenError(error)) {
          transientEntryRetryCountRef.current = 0;
          const opensAtMs = await resolveBookingOpensAt(error, Date.now());
          if (generation !== entryGenerationRef.current) {
            return;
          }
          setBookingOpensAt(opensAtMs);
          setClosedReason(null);
          setStatus('notOpen');
          scheduleEntryRetry(resolveNotOpenRetryDelay(opensAtMs));
          return;
        }

        if (options.background && isTransientEntryError(error)) {
          const attempt = transientEntryRetryCountRef.current;
          const delayMs = QUEUE_OPEN_TRANSIENT_RETRY_DELAYS_MS[attempt];
          if (delayMs !== undefined) {
            if (generation !== entryGenerationRef.current) {
              return;
            }
            // Keep the not-open surface ("entering now") and retry quietly.
            transientEntryRetryCountRef.current = attempt + 1;
            scheduleEntryRetry(delayMs + openRetryJitterMs());
            return;
          }
        }

        transientEntryRetryCountRef.current = 0;
        const nextStatus = mapQueueEntryError(error);
        if (nextStatus === 'closed' || nextStatus === 'expired') {
          setAccessEndedByServer(true);
        }
        setBookingOpensAt(null);
        setClosedReason(nextStatus === 'closed' ? resolveClosedReason(error) : null);
        setStatus(nextStatus);
      } finally {
        clearLoadingSurfaceTimer();
        setLoadingSlow(false);
      }
    },
    [
      applySnapshot,
      clearAutoEnterTimer,
      clearEntryRetryTimer,
      clearLoadingSurfaceTimer,
      enabled,
      loadQueueSession,
      performanceId,
      resolveBookingOpensAt,
      resolveNotOpenRetryDelay,
      scheduleEntryRetry,
      updateReady,
    ],
  );

  useEffect(() => {
    enterQueueRef.current = enterQueue;
  }, [enterQueue]);

  useEffect(() => {
    if (!enabled) {
      clearAutoEnterTimer();
      clearEntryRetryTimer();
      setStatus('loading');
      updateReady(false);
      return;
    }

    void enterQueue();

    return () => {
      entryGenerationRef.current += 1;
      clearAutoEnterTimer();
      clearEntryRetryTimer();
      clearLoadingSurfaceTimer();
    };
  }, [
    clearAutoEnterTimer,
    clearEntryRetryTimer,
    clearLoadingSurfaceTimer,
    enabled,
    enterQueue,
    updateReady,
  ]);

  const recoveryOnly = isRecoveryOnly(snapshot);

  // Once the booking screen is shown (or the session ended, or only payment
  // recovery is left) the queue socket is no longer needed; closing it frees a
  // long-lived connection slot per buyer.
  const queueSocketWanted =
    enabled &&
    Boolean(snapshot.queueSessionId) &&
    !isReady &&
    !recoveryOnly &&
    (status === 'loading' || status === 'waiting' || status === 'admitted');

  useEffect(() => {
    if (!queueSocketWanted) {
      return;
    }

    const socket = createQueueSocket();
    socketRef.current = socket;

    const handleConnect = () => {
      socket.emit('join-queue-session', snapshot.queueSessionId);
    };

    const handlePosition = (nextSnapshot: QueueSnapshot) => {
      applySnapshot(nextSnapshot);
    };

    const handleAdmitted = (nextSnapshot: QueueSnapshot) => {
      applySnapshot(nextSnapshot);
    };

    const handleExpired = (payload: QueueExpiredEvent) => {
      applySnapshot({
        ...EMPTY_SNAPSHOT,
        queueSessionId: payload.queueSessionId,
        state: payload.state,
        autoEnter: payload.autoEnter,
      });
    };

    socket.on('connect', handleConnect);
    socket.on('queue:position', handlePosition);
    socket.on('queue:admitted', handleAdmitted);
    socket.on('queue:expired', handleExpired);
    socket.connect();

    return () => {
      socket.emit('leave-queue-session', snapshot.queueSessionId);
      socket.off('connect', handleConnect);
      socket.off('queue:position', handlePosition);
      socket.off('queue:admitted', handleAdmitted);
      socket.off('queue:expired', handleExpired);
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [applySnapshot, queueSocketWanted, snapshot.queueSessionId]);

  useEffect(() => {
    if (!enabled || status !== 'waiting' || !snapshot.queueSessionId) {
      return;
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const queueSessionId = snapshot.queueSessionId;

    const schedulePoll = () => {
      const jitter = Math.floor(Math.random() * WAITING_POLL_JITTER_MS);
      timer = setTimeout(() => {
        if (stopped) {
          return;
        }

        void loadQueueSession(queueSessionId)
          .catch(handleSessionError)
          .finally(() => {
            if (!stopped) {
              schedulePoll();
            }
          });
      }, WAITING_POLL_INTERVAL_MS + jitter);
    };

    schedulePoll();

    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [enabled, handleSessionError, loadQueueSession, snapshot.queueSessionId, status]);

  const admissionCheckAt =
    isReady || (recoveryOnly && status === 'admitted')
      ? resolveAdmissionCheckAt(snapshot)
      : null;

  useEffect(() => {
    if (!enabled || admissionCheckAt === null || !snapshot.queueSessionId) {
      return;
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const queueSessionId = snapshot.queueSessionId;

    const scheduleCheck = (delayMs: number) => {
      timer = setTimeout(() => {
        if (stopped) {
          return;
        }

        void loadQueueSession(queueSessionId)
          .catch(handleSessionError)
          .finally(() => {
            if (!stopped) {
              scheduleCheck(QUEUE_ADMISSION_RECHECK_MS);
            }
          });
      }, delayMs);
    };

    // activeUntilAt is a server instant: compare it with the server-corrected
    // clock, or a device clock running behind delays the expiry notice.
    scheduleCheck(
      Math.max(0, admissionCheckAt - getServerNowMs()) + QUEUE_ADMISSION_CHECK_GRACE_MS,
    );

    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [admissionCheckAt, enabled, handleSessionError, loadQueueSession, snapshot.queueSessionId]);

  useEffect(() => {
    return () => {
      clearAutoEnterTimer();
      clearEntryRetryTimer();
      clearLoadingSurfaceTimer();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [clearAutoEnterTimer, clearEntryRetryTimer, clearLoadingSurfaceTimer]);

  const enterNow = useCallback(() => {
    updateReady(true);
  }, [updateReady]);

  const retry = useCallback(() => enterQueue(), [enterQueue]);

  const currentQueueSessionId = snapshot.queueSessionId;
  const recheck = useCallback(async () => {
    if (!enabled || !currentQueueSessionId) {
      return;
    }

    try {
      await loadQueueSession(currentQueueSessionId);
    } catch (error) {
      handleSessionError(error);
    }
  }, [currentQueueSessionId, enabled, handleSessionError, loadQueueSession]);

  const result = useMemo<UseQueueResult>(
    () => ({
      status,
      queueSessionId: snapshot.queueSessionId || null,
      position: snapshot.position,
      waitingCount: snapshot.waitingCount,
      etaSeconds: snapshot.etaSeconds,
      etaMinSeconds: snapshot.etaMinSeconds ?? 0,
      etaUnavailable: snapshot.etaUnavailable === true,
      remainingSeats: snapshot.remainingSeats,
      autoEnter: status === 'admitted' && snapshot.autoEnter,
      isReady,
      isSlowLoading: status === 'loading' && loadingSlow,
      bookingOpensAt: status === 'notOpen' ? bookingOpensAt : null,
      closedReason: status === 'closed' ? closedReason : null,
      admittedAt: snapshot.admittedAt,
      activeUntilAt: snapshot.activeUntilAt,
      reentryGraceUntilAt: snapshot.reentryGraceUntilAt,
      recoveryOrderId:
        recoveryOnly && status === 'admitted' ? (snapshot.recoveryOrderId ?? null) : null,
      accessEndedByServer,
      retry,
      recheck,
      enterNow,
    }),
    [
      accessEndedByServer,
      bookingOpensAt,
      closedReason,
      enterNow,
      isReady,
      loadingSlow,
      recheck,
      recoveryOnly,
      retry,
      snapshot,
      status,
    ],
  );

  return result;
}
