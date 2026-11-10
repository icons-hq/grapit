'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { EndCheckoutResponse, ReservationDetail } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { getClientLocale } from '@/lib/i18n/client-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getPaymentRecoveryCopy } from '@/lib/booking/payment-recovery-copy';
import { useBookingStore } from '@/stores/use-booking-store';
import { useAuthStore } from '@/stores/use-auth-store';
import { myLocksQueryKey, useUnlockAllSeats } from '@/hooks/use-booking';

/** An explicit server-approved end always creates a new order identity on retry. */
export function useRestartCheckout(options: {
  refetch: () => Promise<unknown>;
  beforeNavigate?: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const unlock = useUnlockAllSeats();
  const inFlight = useRef(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const locale = getClientLocale();

  async function restart(reservation: ReservationDetail, keepSelection = true) {
    if (inFlight.current || !reservation.tossOrderId || !reservation.performanceId || !reservation.showtimeId) return false;
    inFlight.current = true;
    setRestarting(true);
    setRestartError(null);
    const buyerId = useAuthStore.getState().user?.id;
    try {
      const result = await apiClient.post<EndCheckoutResponse>('/api/v1/payments/checkout/end', {
        orderId: reservation.tossOrderId, keepSelection,
      }, { showErrorToast: false });
      if (useAuthStore.getState().user?.id !== buyerId) return false;
      const base = getLocalizedPathname(`/booking/${reservation.performanceId}`, locale);
      if (result.canKeepSelection && keepSelection && result.paymentDeadlineAt) {
        useBookingStore.getState().setBookingData({
          selectedSeats: reservation.seats, selectedAddons: reservation.addons ?? [],
          showtimeId: reservation.showtimeId, performanceId: reservation.performanceId,
          performanceTitle: reservation.performanceTitle, showDateTime: reservation.showDateTime,
          venue: reservation.venue, posterUrl: reservation.posterUrl,
          expiresAt: Date.parse(result.paymentDeadlineAt),
          queueAccessExpiresAt: reservation.queueAdmission?.activeUntilAt
            ? Date.parse(reservation.queueAdmission.activeUntilAt) : null,
        });
        useBookingStore.getState().applyPaymentDeadline(result.paymentDeadlineAt);
      } else {
        // End first: unlock must never silently keep seats from this pending order.
        await unlock.mutateAsync({ showtimeId: reservation.showtimeId });
        useBookingStore.getState().clearBooking();
      }
      queryClient.removeQueries({ queryKey: myLocksQueryKey(reservation.showtimeId) });
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      options.beforeNavigate?.();
      router.replace(result.canKeepSelection && keepSelection ? `${base}/confirm` : base);
      return true;
    } catch {
      setRestartError(getPaymentRecoveryCopy(locale).restartError);
      await options.refetch().catch(() => undefined);
      return false;
    } finally {
      inFlight.current = false;
      setRestarting(false);
    }
  }
  return { restart, restarting, restartError };
}
