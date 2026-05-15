'use client';

import { useAuthStore } from '@/stores/use-auth-store';
import { useRuntimeFlags } from '@/hooks/use-runtime-flags';
import type { PerformanceStatus } from '@grabit/shared';

export function useBookingAvailability(options: {
  performanceStatus?: PerformanceStatus | null;
} = {}) {
  const runtimeFlags = useRuntimeFlags();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const isUpcomingPerformance = options.performanceStatus === 'upcoming';
  const bookingAvailable =
    (runtimeFlags.bookingEnabled && !isUpcomingPerformance) || isAdmin;

  return {
    ...runtimeFlags,
    isAdmin,
    bookingAvailable,
    isAdminBookingBypassActive:
      (!runtimeFlags.bookingEnabled || isUpcomingPerformance) && isAdmin,
  };
}
