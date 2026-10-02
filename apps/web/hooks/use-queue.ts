'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { PerformanceWithDetails } from '@grabit/shared';
import { ApiClientError, apiClient } from '@/lib/api-client';

const AUTO_ENTER_DELAY_MS = 1_200;
const WAITING_POLL_INTERVAL_MS = 15_000;
const WAITING_POLL_JITTER_MS = 5_000;
// Fast enter responses (immediate admission) skip the queue surface; slower
// ones show the loading surface instead of a blank screen.
export const QUEUE_LOADING_SURFACE_DELAY_MS = 600;
// Spread the automatic re-entry at the booking open time over a few seconds.
export const QUEUE_OPEN_RETRY_JITTER_MS = 3_000;
// Without a known open time, re-check entry at this interval.
export const QUEUE_OPEN_UNKNOWN_RETRY_MS = 60_000;
// Re-check long pre-open waits so a moved open time is picked up.
export const QUEUE_OPEN_MAX_WAIT_MS = 10 * 60_000;
// After the booking screen is shown the queue socket is closed, so the
// admission window end is confirmed with a single status request instead.
export const QUEUE_ADMISSION_CHECK_GRACE_MS = 2_000;
export const QUEUE_ADMISSION_RECHECK_MS = 15_000;

const BOOKING_NOT_OPEN_ERROR_CODE = 'BOOKING_NOT_OPEN';
const BOOKING_NOT_OPEN_MESSAGE = '예매는 추후 오픈 예정입니다';
const BOOKING_CLOSED_ERROR_CODES = new Set([
  'BOOKING_ENDED',
  'NO_BOOKABLE_SHOWTIME',
  'PERFORMANCE_NOT_FOUND',
]);
const BOOKING_CLOSED_MESSAGES = new Set([
  '판매가 종료된 공연입니다',
  '이미 시작된 회차는 예매할 수 없습니다.',
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

type QueueSnapshot = {
  queueSessionId: string;
  state: QueueTransportState;
  position: number;
  waitingCount: number;
  etaSeconds: number;
  etaPending?: boolean;
  remainingSeats: number;
  autoEnter: boolean;
  admittedAt: string | null;
  activeUntilAt: string | null;
  reentryGraceUntilAt: string | null;
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
  etaPending: boolean;
  remainingSeats: number;
  autoEnter: boolean;
  isReady: boolean;
  isSlowLoading: boolean;
  bookingOpensAt: number | null;
  admittedAt: string | null;
  activeUntilAt: string | null;
  reentryGraceUntilAt: string | null;
  retry: () => Promise<void>;
  enterNow: () => void;
};

const EMPTY_SNAPSHOT: QueueSnapshot = {
  queueSessionId: '',
  state: 'WAITING',
  position: 0,
  waitingCount: 0,
  etaSeconds: 0,
  etaPending: false,
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

function normalizeSnapshot(snapshot: QueueSnapshot): QueueSnapshot {
  return {
    ...snapshot,
    autoEnter: snapshot.autoEnter || snapshot.state === 'PAYMENT_RECOVERY',
  };
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
 * Status poll / admission check failures. A missing (404) or rejected (403)
 * session cannot recover on its own, so it moves to the re-entry surface.
 * Anything else (429, 5xx, network) is transient: keep the current surface and
 * let the next scheduled check retry. Returns null for transient errors.
 */
function mapQueueSessionError(error: unknown): QueueStatus | null {
  if (!(error instanceof ApiClientError)) {
    return null;
  }

  const securityStatus = mapSecurityError(error);
  if (securityStatus) {
    return securityStatus;
  }

  if (error.statusCode === 404 || error.statusCode === 403) {
    return 'expired';
  }

  return null;
}

function resolveAdmissionCheckAt(snapshot: QueueSnapshot): number | null {
  if (snapshot.state === 'PAYMENT_RECOVERY') {
    return (
      parseTimeMs(snapshot.reentryGraceUntilAt) ??
      parseTimeMs(snapshot.activeUntilAt)
    );
  }

  if (snapshot.state === 'ADMITTED') {
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
  const socketRef = useRef<Socket | null>(null);
  const autoEnterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingSurfaceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReadyRef = useRef(false);
  // Bumped when the entry effect is torn down so in-flight entry attempts do
  // not schedule retries for an unmounted or disabled route.
  const entryGenerationRef = useRef(0);
  const bookingStartsAtFallbackRef = useRef<{ performanceId: string; startsAtMs: number | null } | null>(null);
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

  const applySnapshot = useCallback(
    (
      nextSnapshot: QueueSnapshot,
      options: { enterImmediately?: boolean } = {},
    ) => {
      const normalized = normalizeSnapshot(nextSnapshot);
      setSnapshot(normalized);

      if (normalized.state === 'EXPIRED') {
        clearAutoEnterTimer();
        setStatus('expired');
        updateReady(false);
        return;
      }

      if (isAdmittedState(normalized.state)) {
        setStatus('admitted');
        if (isReadyRef.current) {
          // Already on the booking screen: a refreshed admitted snapshot must
          // not unmount it again.
          return;
        }

        clearAutoEnterTimer();
        if (options.enterImmediately && normalized.autoEnter) {
          updateReady(true);
        } else {
          updateReady(false);
          autoEnterTimerRef.current = setTimeout(() => {
            updateReady(true);
          }, AUTO_ENTER_DELAY_MS);
        }
        return;
      }

      clearAutoEnterTimer();
      setStatus('waiting');
      updateReady(false);
    },
    [clearAutoEnterTimer, updateReady],
  );

  const handleSessionError = useCallback(
    (error: unknown) => {
      const nextStatus = mapQueueSessionError(error);
      if (!nextStatus) {
        return;
      }

      clearAutoEnterTimer();
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

  const scheduleEntryRetry = useCallback(
    (opensAtMs: number | null) => {
      clearEntryRetryTimer();
      const untilOpenMs =
        opensAtMs === null
          ? QUEUE_OPEN_UNKNOWN_RETRY_MS
          : Math.max(0, opensAtMs - Date.now());
      const jitterMs = Math.floor(Math.random() * QUEUE_OPEN_RETRY_JITTER_MS);
      entryRetryTimerRef.current = setTimeout(() => {
        entryRetryTimerRef.current = null;
        void enterQueueRef.current({ background: true });
      }, Math.min(untilOpenMs, QUEUE_OPEN_MAX_WAIT_MS) + jitterMs);
    },
    [clearEntryRetryTimer],
  );

  const resolveBookingOpensAt = useCallback(
    async (error: ApiClientError, receivedAtMs: number): Promise<number | null> => {
      const serverNowMs =
        parseTimeMs(readErrorField(error, 'serverNow')) ??
        parseTimeMs(readErrorField(error, 'timestamp'));
      const clockOffsetMs = serverNowMs === null ? 0 : serverNowMs - receivedAtMs;

      let startsAtMs = parseTimeMs(readErrorField(error, 'bookingStartsAt'));
      if (startsAtMs === null) {
        const cached = bookingStartsAtFallbackRef.current;
        if (cached?.performanceId === performanceId) {
          startsAtMs = cached.startsAtMs;
        } else {
          startsAtMs = await fetchBookingStartsAtMs(performanceId);
          bookingStartsAtFallbackRef.current = { performanceId, startsAtMs };
        }
      }

      // Convert the server open time into this device's clock.
      return startsAtMs === null ? null : startsAtMs - clockOffsetMs;
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

        setBookingOpensAt(null);
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
          const opensAtMs = await resolveBookingOpensAt(error, Date.now());
          if (generation !== entryGenerationRef.current) {
            return;
          }
          setBookingOpensAt(opensAtMs);
          setStatus('notOpen');
          scheduleEntryRetry(opensAtMs);
          return;
        }

        setBookingOpensAt(null);
        setStatus(mapQueueEntryError(error));
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

  // Once the booking screen is shown (or the session ended) the queue socket is
  // no longer needed; closing it frees a long-lived connection slot per buyer.
  const queueSocketWanted =
    enabled &&
    Boolean(snapshot.queueSessionId) &&
    !isReady &&
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

  const admissionCheckAt = isReady ? resolveAdmissionCheckAt(snapshot) : null;

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

    scheduleCheck(
      Math.max(0, admissionCheckAt - Date.now()) + QUEUE_ADMISSION_CHECK_GRACE_MS,
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

  const result = useMemo<UseQueueResult>(
    () => ({
      status,
      queueSessionId: snapshot.queueSessionId || null,
      position: snapshot.position,
      waitingCount: snapshot.waitingCount,
      etaSeconds: snapshot.etaSeconds,
      etaPending: snapshot.etaPending === true,
      remainingSeats: snapshot.remainingSeats,
      autoEnter: status === 'admitted' && snapshot.autoEnter,
      isReady,
      isSlowLoading: status === 'loading' && loadingSlow,
      bookingOpensAt: status === 'notOpen' ? bookingOpensAt : null,
      admittedAt: snapshot.admittedAt,
      activeUntilAt: snapshot.activeUntilAt,
      reentryGraceUntilAt: snapshot.reentryGraceUntilAt,
      retry,
      enterNow,
    }),
    [bookingOpensAt, enterNow, isReady, loadingSlow, retry, snapshot, status],
  );

  return result;
}
