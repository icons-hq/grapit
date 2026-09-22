'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReservationDetail } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';
import { getCheckoutState } from '@/lib/booking/checkout-state';
import { getClientLocale } from '@/lib/i18n/client-copy';

export function useCheckoutRecovery(orderId: string | null, performanceId: string, paused = false) {
  const [nowMs, setNowMs] = useState(Date.now);
  const userId = useAuthStore((store) => store.user?.id);
  const locale = getClientLocale();
  const query = useQuery({
    queryKey: ['checkout-recovery', userId, orderId, locale],
    queryFn: () => apiClient.get<ReservationDetail | null>(
      `/api/v1/reservations?orderId=${encodeURIComponent(orderId!)}&locale=${locale}`,
      { showErrorToast: false },
    ),
    enabled: Boolean(orderId && userId && !paused),
    retry: false,
  });
  const reservation = query.data;
  const matchesOrder = reservation?.tossOrderId === orderId
    && reservation?.performanceId === performanceId;
  const deadline = reservation?.paymentDeadlineAt;
  useEffect(() => {
    if (!deadline || !Number.isFinite(Date.parse(deadline))) return;
    const delay = Math.min(2_147_483_647, Math.max(0, Date.parse(deadline) - Date.now()));
    const timer = window.setTimeout(() => setNowMs(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [deadline]);
  const checkoutState = reservation ? getCheckoutState(reservation, nowMs) : 'unavailable';
  const state = !orderId ? 'none'
    : query.isPending ? 'loading'
    : query.isError || !reservation || !matchesOrder ? 'unavailable'
    : checkoutState === 'failed' || checkoutState === 'expired' ? 'ended'
    : checkoutState;

  useEffect(() => {
    if (state !== 'ready' || !reservation?.showtimeId) return;
    const store = useBookingStore.getState();
    const sameSelection = store.performanceId === performanceId
      && store.selectedShowtimeId === reservation.showtimeId
      && store.performanceTitle === reservation.performanceTitle
      && JSON.stringify(store.selectedSeats) === JSON.stringify(reservation.seats);
    if (!sameSelection) {
      store.setBookingData({
        selectedSeats: reservation.seats,
        showtimeId: reservation.showtimeId,
        performanceId,
        performanceTitle: reservation.performanceTitle,
        showDateTime: reservation.showDateTime,
        venue: reservation.venue,
        posterUrl: reservation.posterUrl,
        expiresAt: Date.parse(reservation.paymentDeadlineAt),
      });
    }
    store.applyPaymentDeadline(reservation.paymentDeadlineAt);
  }, [performanceId, reservation, state]);

  return { state, reservation: matchesOrder ? reservation : null, refetch: query.refetch, isFetching: query.isFetching };
}
