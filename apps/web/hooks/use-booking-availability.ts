'use client';

import { useAuthStore } from '@/stores/use-auth-store';
import { useRuntimeFlags } from '@/hooks/use-runtime-flags';
import { useServerTimeReached } from '@/hooks/use-server-clock';
import {
  getBookingAvailabilityCheckingCopy,
  getBookingAvailabilityUnavailableCopy,
  getBookingEndedCopy,
  getBookingVerificationRequiredCopy,
} from '@/lib/runtime-flags';
import { parseServerDeadline } from '@/lib/booking/queue-access';
import type { PerformanceStatus } from '@grabit/shared';

export function useBookingAvailability(options: {
  performanceStatus?: PerformanceStatus | null;
  bookingStartsAt?: string | null;
} = {}) {
  const runtimeFlags = useRuntimeFlags();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const isEndedPerformance = options.performanceStatus === 'ended';
  const bookingStartsAtMs = parseServerDeadline(options.bookingStartsAt);
  const hasValidBookingStart = bookingStartsAtMs !== null;
  // Evaluated against the server-corrected clock on every render: a detail
  // response that lands after the opening instant, a tab waking from sleep or a
  // slow device clock can no longer pin the CTA to "opens later".
  const bookingStartReached = useServerTimeReached(bookingStartsAtMs);
  const isBeforeScheduledBookingStart =
    hasValidBookingStart && !bookingStartReached;
  const isUpcomingPerformance =
    options.performanceStatus === 'upcoming' &&
    (!hasValidBookingStart || !bookingStartReached);
  const bookingEndedMessage = getBookingEndedCopy(runtimeFlags.locale);
  const verificationRequired =
    Boolean(user) &&
    (user?.isEmailVerified !== true || user?.isPhoneVerified !== true);
  const bookingOpen =
    !isEndedPerformance &&
    ((runtimeFlags.bookingEnabled && !isUpcomingPerformance && !isBeforeScheduledBookingStart) || isAdmin);

  const bookingAvailable = bookingOpen && !verificationRequired;
  const isScheduledClosed = isUpcomingPerformance || isBeforeScheduledBookingStart;
  // An unknown flag keeps booking closed, but says so instead of "opens later".
  // useRuntimeFlags reports isResolved=false only until a flag value loads.
  const runtimeFlagsUnknown = runtimeFlags.isResolved === false;
  const runtimeFlagsDisabledMessage = !runtimeFlagsUnknown || isScheduledClosed
    ? runtimeFlags.bookingDisabledMessage
    : runtimeFlags.isError
      ? getBookingAvailabilityUnavailableCopy(runtimeFlags.locale)
      : getBookingAvailabilityCheckingCopy(runtimeFlags.locale);

  return {
    ...runtimeFlags,
    bookingDisabledMessage: verificationRequired
      ? getBookingVerificationRequiredCopy(runtimeFlags.locale)
      : isEndedPerformance
        ? bookingEndedMessage
        : runtimeFlagsDisabledMessage,
    bookingEndedMessage,
    isAdmin,
    bookingAvailable,
    bookingOpen,
    /** The clock bookingOpen was evaluated with; status displays must use the same instant. */
    nowMs,
    verificationRequiredForBooking: verificationRequired,
    isAdminBookingBypassActive:
      !verificationRequired &&
      !isEndedPerformance &&
      (!runtimeFlags.bookingEnabled || isScheduledClosed) &&
      isAdmin,
  };
}
