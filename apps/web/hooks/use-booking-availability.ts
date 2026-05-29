'use client';

import { useAuthStore } from '@/stores/use-auth-store';
import { useRuntimeFlags } from '@/hooks/use-runtime-flags';
import {
  getBookingEndedCopy,
  getBookingVerificationRequiredCopy,
} from '@/lib/runtime-flags';
import type { PerformanceStatus } from '@grabit/shared';

export function useBookingAvailability(options: {
  performanceStatus?: PerformanceStatus | null;
} = {}) {
  const runtimeFlags = useRuntimeFlags();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const isUpcomingPerformance = options.performanceStatus === 'upcoming';
  const isEndedPerformance = options.performanceStatus === 'ended';
  const bookingEndedMessage = getBookingEndedCopy(runtimeFlags.locale);
  const verificationRequired =
    Boolean(user) &&
    (user?.isEmailVerified !== true || user?.isPhoneVerified !== true);
  const bookingAvailable =
    !verificationRequired &&
    !isEndedPerformance &&
    ((runtimeFlags.bookingEnabled && !isUpcomingPerformance) || isAdmin);

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
      (!runtimeFlags.bookingEnabled || isUpcomingPerformance) &&
      isAdmin,
  };
}
