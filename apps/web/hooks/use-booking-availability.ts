'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/use-auth-store';
import { useRuntimeFlags } from '@/hooks/use-runtime-flags';
import {
  getBookingEndedCopy,
  getBookingVerificationRequiredCopy,
} from '@/lib/runtime-flags';
import type { PerformanceStatus } from '@grabit/shared';

export function useBookingAvailability(options: {
  performanceStatus?: PerformanceStatus | null;
  bookingStartsAt?: string | null;
} = {}) {
  const runtimeFlags = useRuntimeFlags();
  const user = useAuthStore((state) => state.user);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isAdmin = user?.role === 'admin';
  const isEndedPerformance = options.performanceStatus === 'ended';
  const bookingStartsAtMs = options.bookingStartsAt
    ? Date.parse(options.bookingStartsAt)
    : null;
  const hasValidBookingStart =
    typeof bookingStartsAtMs === 'number' && Number.isFinite(bookingStartsAtMs);
  const isBeforeScheduledBookingStart =
    hasValidBookingStart && bookingStartsAtMs > nowMs;
  const isUpcomingPerformance =
    options.performanceStatus === 'upcoming' &&
    (!hasValidBookingStart || bookingStartsAtMs > nowMs);
  const bookingEndedMessage = getBookingEndedCopy(runtimeFlags.locale);
  const verificationRequired =
    Boolean(user) &&
    (user?.isEmailVerified !== true || user?.isPhoneVerified !== true);
  const bookingAvailable =
    !verificationRequired &&
    !isEndedPerformance &&
    ((runtimeFlags.bookingEnabled && !isUpcomingPerformance && !isBeforeScheduledBookingStart) || isAdmin);

  useEffect(() => {
    if (!hasValidBookingStart || bookingStartsAtMs <= Date.now()) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setNowMs(Date.now());
    }, Math.min(bookingStartsAtMs - Date.now(), 2_147_483_647));

    return () => window.clearTimeout(timeout);
  }, [bookingStartsAtMs, hasValidBookingStart]);

  return {
    ...runtimeFlags,
    bookingDisabledMessage: verificationRequired
      ? getBookingVerificationRequiredCopy(runtimeFlags.locale)
      : isEndedPerformance
        ? bookingEndedMessage
        : runtimeFlags.bookingDisabledMessage,
    bookingEndedMessage,
    isAdmin,
    bookingAvailable,
    verificationRequiredForBooking: verificationRequired,
    isAdminBookingBypassActive:
      !verificationRequired &&
      !isEndedPerformance &&
      (!runtimeFlags.bookingEnabled || isUpcomingPerformance || isBeforeScheduledBookingStart) &&
      isAdmin,
  };
}
