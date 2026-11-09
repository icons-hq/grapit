'use client';

import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingAddonSnapshot } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';
import { getServerNowMs } from '@/lib/server-clock';
import { preserveNewerAddonStock } from '@/lib/booking/addon-stock';

export interface PendingAddonSelection {
  addonId: string;
  seatKey: string;
  unitIndex?: number;
  selected: boolean;
}

function selectionKey(input: PendingAddonSelection) {
  return `${input.addonId}:${input.seatKey}:${input.unitIndex ?? 1}`;
}

export function useBookingAddons(showtimeId: string | null) {
  const userId = useAuthStore((s) => s.user?.id);
  const connected = useBookingStore((s) => s.isConnected);
  const selectedSeats = useBookingStore((s) => s.selectedSeats);
  const queryClient = useQueryClient();
  const [, updatePending] = useReducer((value: number) => value + 1, 0);
  // Each account/showtime owns its queue. A stale response cannot update another
  // account, and queued requests are discarded when the buyer leaves this scope.
  const session = useMemo(() => ({
    queryKey: ['booking-addons', showtimeId, userId] as const,
    pending: new Map<string, PendingAddonSelection>(),
    queue: [] as PendingAddonSelection[],
    generation: 0,
    running: false,
    active: true,
  }), [showtimeId, userId]);
  useEffect(() => {
    session.active = true;
    return () => {
      session.active = false;
      session.queue.length = 0;
      session.pending.clear();
    };
  }, [session]);

  const loadSnapshot = useCallback(async () => {
    const generation = session.generation;
    const snapshot = await apiClient.get<BookingAddonSnapshot>(`/api/v1/booking/addons/${showtimeId}`, { showErrorToast: false });
    const cached = queryClient.getQueryData<BookingAddonSnapshot>(session.queryKey);
    // A read started before a hold finished must not erase that confirmed choice.
    if (generation !== session.generation && cached) return cached;
    return preserveNewerAddonStock(snapshot, cached);
  }, [queryClient, session, showtimeId]);
  const query = useQuery({
    queryKey: session.queryKey,
    queryFn: loadSnapshot,
    enabled: Boolean(showtimeId && userId) && !session.running,
    // A successful PUT already returns the authoritative snapshot. Re-enabling
    // polling must not immediately issue a redundant GET after every selection.
    staleTime: 1000,
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

  const setSelection = useCallback((input: PendingAddonSelection) => {
    const isCurrentSession = () => session.active && useAuthStore.getState().user?.id === userId;
    if (!showtimeId || !userId || !isCurrentSession() || session.pending.has(selectionKey(input))) return;
    session.pending.set(selectionKey(input), input);
    session.queue.push(input);
    updatePending();
    if (session.running) return;
    session.running = true;
    session.generation += 1;

    // Show every clicked option immediately, while serializing the writes. The
    // server returns whole private snapshots; concurrent responses could otherwise
    // arrive backwards and erase another successful selection.
    void (async () => {
      let needsReconcile = false;
      try {
        await queryClient.cancelQueries({ queryKey: session.queryKey });
        while ((session.queue.length || needsReconcile) && isCurrentSession()) {
          if (!session.queue.length) {
            try {
              await queryClient.fetchQuery({ queryKey: session.queryKey, queryFn: loadSnapshot, staleTime: 0 });
            } catch {
              // Keep the query error visible. A choice queued during this read
              // still gets its turn and may itself restore an authoritative snapshot.
            }
            needsReconcile = false;
            continue;
          }
          const next = session.queue.shift()!;
          try {
            const data = await apiClient.put<BookingAddonSnapshot>('/api/v1/booking/addons/holds', { ...next, showtimeId });
            if (!isCurrentSession()) return;
            session.generation += 1;
            queryClient.setQueryData<BookingAddonSnapshot>(session.queryKey, (cached) => preserveNewerAddonStock(data, cached));
            needsReconcile = false;
          } catch {
            // A lost response can still have committed. Read server truth before
            // allowing checkout; the API client presents the selection error.
            needsReconcile = true;
          } finally {
            session.pending.delete(selectionKey(next));
            if (isCurrentSession()) updatePending();
          }
        }
      } catch {
        // A failed recovery stays a query error, so the booking page blocks
        // checkout and offers its existing retry action.
      } finally {
        session.running = false;
        if (isCurrentSession()) updatePending();
      }
    })();
  }, [loadSnapshot, queryClient, session, showtimeId, userId]);

  return { ...query, setSelection, selectionPending: session.running || session.pending.size > 0,
    pendingSelections: Array.from(session.pending.values()) };
}
