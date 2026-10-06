'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  getServerClockOffsetMs,
  getServerNowMs,
  subscribeServerClock,
} from '@/lib/server-clock';

const MAX_TIMEOUT_MS = 2_147_483_647;
const WAKE_EVENTS = ['focus', 'pageshow', 'online'] as const;

function getServerOffsetSnapshot(): number {
  return 0;
}

/** Re-renders when a better server clock sample changes the offset. */
export function useServerClockOffsetMs(): number {
  return useSyncExternalStore(
    subscribeServerClock,
    getServerClockOffsetMs,
    getServerOffsetSnapshot,
  );
}

/**
 * Whether the server clock has reached `targetMs`, evaluated on every render.
 *
 * The result is never pinned to the mount time: it flips at the target instant,
 * whenever the server clock offset is corrected, and when the tab wakes up from
 * background or sleep (where timers fire late). `null` never counts as reached.
 */
export function useServerTimeReached(targetMs: number | null): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (targetMs === null) {
        return () => {};
      }

      let timer: ReturnType<typeof setTimeout> | null = null;
      const clearTimer = () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      };
      const arm = () => {
        clearTimer();
        const remainingMs = targetMs - getServerNowMs();
        if (remainingMs <= 0) {
          return;
        }
        // Timers may fire early or late; re-arm until the clock really passes.
        timer = setTimeout(() => {
          timer = null;
          onStoreChange();
          arm();
        }, Math.min(remainingMs, MAX_TIMEOUT_MS));
      };
      const wake = () => {
        onStoreChange();
        arm();
      };
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          wake();
        }
      };

      arm();
      const unsubscribeClock = subscribeServerClock(wake);
      document.addEventListener('visibilitychange', handleVisibilityChange);
      for (const eventName of WAKE_EVENTS) {
        window.addEventListener(eventName, wake);
      }

      return () => {
        clearTimer();
        unsubscribeClock();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        for (const eventName of WAKE_EVENTS) {
          window.removeEventListener(eventName, wake);
        }
      };
    },
    [targetMs],
  );

  const getSnapshot = useCallback(
    () => targetMs !== null && getServerNowMs() >= targetMs,
    [targetMs],
  );

  // The server render cannot know the device offset, so it stays conservative
  // ("not reached") and the client snapshot takes over after hydration.
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
