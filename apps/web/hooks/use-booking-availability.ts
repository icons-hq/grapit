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
import {
  resolveAdminCapabilitySnapshot,
  type PerformanceStatus,
  type UserProfile,
} from '@grabit/shared';

/**
 * Same verdict as the API's Admin Booking Bypass (`canUseAdminBookingBypass`):
 * only a full admin (superuser) skips the queue, the Sitewide Booking Gate and
 * the sale start. Restricted bundles (scanner, finance, ...) also carry
 * role='admin' but book like Buyers. Fails closed without capability claims.
 */
function canUseAdminBookingBypass(user: UserProfile | null | undefined): boolean {
  if (!user || user.role !== 'admin') {
    return false;
  }
  if (user.adminCapabilityBundle === undefined || !Array.isArray(user.adminCapabilities)) {
    return false;
  }
  return resolveAdminCapabilitySnapshot(user).superuser;
}

export function useBookingAvailability(options: {
  performanceStatus?: PerformanceStatus | null;
  bookingStartsAt?: string | null;
} = {}) {
  const runtimeFlags = useRuntimeFlags();
  const user = useAuthStore((state) => state.user);
  const isAdmin = canUseAdminBookingBypass(user);
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
    /**
     * The server-clock verdict bookingOpen was evaluated with. Status displays
     * (badge, schedule) must derive from it so they flip with the booking CTA.
     */
    isBeforeScheduledBookingStart,
    verificationRequiredForBooking: verificationRequired,
    isAdminBookingBypassActive:
      !verificationRequired &&
      !isEndedPerformance &&
      (!runtimeFlags.bookingEnabled || isScheduledClosed) &&
      isAdmin,
  };
}
