'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingAddonSnapshot } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';
import { getServerNowMs } from '@/lib/server-clock';
import { preserveNewerAddonStock } from '@/lib/booking/addon-stock';

export function useBookingAddons(showtimeId: string | null) {
  const userId = useAuthStore((s) => s.user?.id);
  const connected = useBookingStore((s) => s.isConnected);
  const selectedSeats = useBookingStore((s) => s.selectedSeats);
  const queryClient = useQueryClient();
  const queryKey = ['booking-addons', showtimeId, userId] as const;
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const snapshot = await apiClient.get<BookingAddonSnapshot>(`/api/v1/booking/addons/${showtimeId}`, { showErrorToast: false });
      return preserveNewerAddonStock(snapshot, queryClient.getQueryData(queryKey));
    },
    enabled: Boolean(showtimeId && userId),
    staleTime: 0,
    refetchOnWindowFocus: true,
    // WebSocket changes are immediate; polling also repairs a lost broadcast.
    refetchInterval: connected ? 5000 : 1500,
  });
  useEffect(() => {
    const seatKeys = new Set(selectedSeats.map((s) => s.seatKey));
    useBookingStore.getState().setAddons((query.data?.selections ?? []).filter((s) => seatKeys.has(s.seatKey)));
  }, [query.data, selectedSeats, showtimeId, userId]);
  useEffect(() => {
    const deadlines = [query.data?.nextExpiryAt, ...(query.data?.selections.map((s) => s.expiresAt) ?? [])]
      .filter((date): date is string => Boolean(date)).map(Date.parse);
    if (!deadlines.length) return;
    const delay = Math.max(50, Math.min(...deadlines) - getServerNowMs() + 100);
    const timer = setTimeout(() => { void queryClient.invalidateQueries({ queryKey: ['booking-addons', showtimeId] }); }, Math.min(delay, 2147483647));
    return () => clearTimeout(timer);
  }, [query.data, queryClient, showtimeId]);
  const mutation = useMutation({
    mutationFn: (input: { addonId: string; seatKey: string; selected: boolean }) =>
      apiClient.put<BookingAddonSnapshot>('/api/v1/booking/addons/holds', { ...input, showtimeId }),
    onMutate: async () => { await queryClient.cancelQueries({ queryKey }); },
    onSuccess: (data) => { queryClient.setQueryData<BookingAddonSnapshot>(queryKey, (cached) => preserveNewerAddonStock(data, cached)); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey }); },
  });
  return { ...query, setSelection: mutation.mutate, selectionPending: mutation.isPending };
}
