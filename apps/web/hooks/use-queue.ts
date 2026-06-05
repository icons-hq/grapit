'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ApiClientError, apiClient } from '@/lib/api-client';

const AUTO_ENTER_DELAY_MS = 1_200;
const WAITING_POLL_INTERVAL_MS = 15_000;
const WAITING_POLL_JITTER_MS = 5_000;

type QueueTransportState =
  | 'WAITING'
  | 'ADMITTED'
  | 'PAYMENT_RECOVERY'
  | 'EXPIRED';

export type QueueStatus =
  | 'loading'
  | 'waiting'
  | 'admitted'
  | 'expired'
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
  remainingSeats: number;
  autoEnter: boolean;
  isReady: boolean;
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

function normalizeSnapshot(snapshot: QueueSnapshot): QueueSnapshot {
  return {
    ...snapshot,
    autoEnter: snapshot.autoEnter || snapshot.state === 'PAYMENT_RECOVERY',
  };
}

function mapQueueError(error: unknown): QueueStatus {
  if (error instanceof ApiClientError) {
    if (error.statusCode === 401) {
      return 'authRequired';
    }

    if (
      error.statusCode === 429 ||
      error.message === 'TRAFFIC_RATE_LIMITED'
    ) {
      return 'retry';
    }

    if (
      error.statusCode === 403 &&
      error.message === 'SECURITY_CHALLENGE_REQUIRED'
    ) {
      return 'challenge';
    }

    if (
      error.statusCode === 403 &&
      error.message === 'SECURITY_BLOCKED'
    ) {
      return 'blocked';
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

export function useQueue({
  performanceId,
  enabled = true,
}: UseQueueOptions): UseQueueResult {
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(EMPTY_SNAPSHOT);
  const [status, setStatus] = useState<QueueStatus>('loading');
  const [isReady, setIsReady] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const autoEnterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoEnterTimer = useCallback(() => {
    if (autoEnterTimerRef.current) {
      clearTimeout(autoEnterTimerRef.current);
      autoEnterTimerRef.current = null;
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
        setIsReady(false);
        return;
      }

      if (isAdmittedState(normalized.state)) {
        setStatus('admitted');
        clearAutoEnterTimer();
        if (options.enterImmediately && normalized.autoEnter) {
          setIsReady(true);
        } else {
          setIsReady(false);
          autoEnterTimerRef.current = setTimeout(() => {
            setIsReady(true);
          }, AUTO_ENTER_DELAY_MS);
        }
        return;
      }

      clearAutoEnterTimer();
      setStatus('waiting');
      setIsReady(false);
    },
    [clearAutoEnterTimer],
  );

  const loadQueueSession = useCallback(
    async (queueSessionId: string) => {
      const response = await apiClient.get<QueueSnapshot>(
        `/api/v1/queue/sessions/${queueSessionId}`,
        { showErrorToast: false },
      );
      applySnapshot(response);
    },
    [applySnapshot],
  );

  const enterQueue = useCallback(async () => {
    if (!enabled || !performanceId) {
      return;
    }

    clearAutoEnterTimer();
    setStatus('loading');
    setIsReady(false);

    try {
      const response = await apiClient.post<QueueEnterResponse>(
        `/api/v1/queue/performances/${performanceId}/enter`,
        undefined,
        { showErrorToast: false },
      );

      if (!response.queueSessionId) {
        setStatus('retry');
        return;
      }

      if (!response.state) {
        await loadQueueSession(response.queueSessionId);
        return;
      }

      applySnapshot(response, {
        enterImmediately:
          isAdmittedState(response.state) &&
          response.autoEnter &&
          response.position === 0 &&
          response.waitingCount === 0,
      });
    } catch (error) {
      setStatus(mapQueueError(error));
      setIsReady(false);
    }
  }, [applySnapshot, clearAutoEnterTimer, enabled, loadQueueSession, performanceId]);

  useEffect(() => {
    if (!enabled) {
      clearAutoEnterTimer();
      setStatus('loading');
      setIsReady(false);
      return;
    }

    void enterQueue();

    return () => {
      clearAutoEnterTimer();
    };
  }, [clearAutoEnterTimer, enabled, enterQueue]);

  useEffect(() => {
    if (!enabled || !snapshot.queueSessionId) {
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
      socketRef.current = null;
    };
  }, [applySnapshot, enabled, snapshot.queueSessionId]);

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

        void loadQueueSession(queueSessionId).finally(() => {
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
  }, [enabled, loadQueueSession, snapshot.queueSessionId, status]);

  useEffect(() => {
    return () => {
      clearAutoEnterTimer();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [clearAutoEnterTimer]);

  const enterNow = useCallback(() => {
    setIsReady(true);
  }, []);

  const result = useMemo<UseQueueResult>(
    () => ({
      status,
      queueSessionId: snapshot.queueSessionId || null,
      position: snapshot.position,
      waitingCount: snapshot.waitingCount,
      etaSeconds: snapshot.etaSeconds,
      remainingSeats: snapshot.remainingSeats,
      autoEnter: status === 'admitted' && snapshot.autoEnter,
      isReady,
      admittedAt: snapshot.admittedAt,
      activeUntilAt: snapshot.activeUntilAt,
      reentryGraceUntilAt: snapshot.reentryGraceUntilAt,
      retry: enterQueue,
      enterNow,
    }),
    [enterNow, enterQueue, isReady, snapshot, status],
  );

  return result;
}
