'use client';

import { useAuthStore } from '@/stores/use-auth-store';
import { useRuntimeFlags } from '@/hooks/use-runtime-flags';

export function useBookingAvailability() {
  const runtimeFlags = useRuntimeFlags();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const bookingAvailable = runtimeFlags.bookingEnabled || isAdmin;

  return {
    ...runtimeFlags,
    bookingAvailable,
    isAdminBookingBypassActive: !runtimeFlags.bookingEnabled && isAdmin,
  };
}
