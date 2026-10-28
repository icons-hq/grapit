'use client';
import { useEffect, useState } from 'react';
import type { Showtime } from '@grabit/shared';
import { useServerClockOffsetMs } from '@/hooks/use-server-clock';
import { getCutoffTimerDelay, getNextShowtimeCutoffAt } from '@/lib/booking/showtime-sales';

/** Re-evaluate exactly at the next server-clock sales cutoff, including wakeups. */
export function useShowtimeSalesClock(showtimes: readonly Showtime[]): number {
  const [deviceNow, setDeviceNow] = useState(() => Date.now());
  const now = deviceNow + useServerClockOffsetMs();
  useEffect(() => {
    const cutoff = getNextShowtimeCutoffAt(showtimes, now);
    if (cutoff === null) return;
    const timer = window.setTimeout(() => setDeviceNow(Date.now()), getCutoffTimerDelay(cutoff));
    return () => window.clearTimeout(timer);
  }, [now, showtimes]);
  useEffect(() => {
    const sync = () => { if (document.visibilityState === 'visible') setDeviceNow(Date.now()); };
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return now;
}
