'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getServerNowMs } from '@/lib/server-clock';
import { useServerClockOffsetMs } from '@/hooks/use-server-clock';

interface CountdownResult {
  minutes: number;
  seconds: number;
  isWarning: boolean;
  isActive: boolean;
}

/**
 * Counts down to a server-issued epoch (seat lock, queue access, payment
 * deadline). The remaining time is measured on the server-corrected clock so a
 * fast or slow device clock neither expires a still-valid lock early nor shows
 * time left on a lock the server already released.
 */
export function useCountdown(
  expiresAt: number | null,
  onExpire: () => void,
): CountdownResult {
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const expiredForRef = useRef<number | null>(null);
  const serverClockOffsetMs = useServerClockOffsetMs();

  const calculateRemaining = useCallback(() => {
    if (expiresAt === null) return 0;
    return Math.max(0, Math.floor((expiresAt - getServerNowMs()) / 1000));
  }, [expiresAt]);

  const [remaining, setRemaining] = useState(() => calculateRemaining());

  useEffect(() => {
    if (expiresAt === null) {
      setRemaining(0);
      return;
    }

    // Set initial value (also re-run when the server clock offset is corrected)
    setRemaining(calculateRemaining());

    const interval = setInterval(() => {
      const newRemaining = calculateRemaining();
      setRemaining(newRemaining);

      if (newRemaining <= 0) {
        clearInterval(interval);
        // An offset correction restarts this effect; expire each deadline once.
        if (expiredForRef.current !== expiresAt) {
          expiredForRef.current = expiresAt;
          onExpireRef.current();
        }
      }
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [expiresAt, calculateRemaining, serverClockOffsetMs]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const isWarning = remaining > 0 && remaining <= 180;
  const isActive = expiresAt !== null && remaining > 0;

  return { minutes, seconds, isWarning, isActive };
}
