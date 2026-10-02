'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import { toast } from 'sonner';
import type { SeatUpdateEvent, SeatStatusResponse } from '@grabit/shared';
import { createBookingSocket } from '@/lib/socket-client';
import { refetchAfterInFlight, SEAT_STATUS_RECONNECT_JITTER_MS } from '@/lib/booking/seat-resync';
import { clearSeatUpdateEvents, recordSeatUpdateEvent } from '@/lib/booking/seat-event-overlay';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getClientLocale } from '@/lib/i18n/client-copy';
import { useBookingStore } from '@/stores/use-booking-store';

export function useBookingSocket(showtimeId: string | null): void {
  const socketRef = useRef<Socket | null>(null);
  const queryClient = useQueryClient();
  const hadPreviousConnection = useRef(false);
  const locale = getClientLocale();
  const copy = getVisibleCopy(locale).socket;

  useEffect(() => {
    if (!showtimeId) return;

    const socket = createBookingSocket();
    socketRef.current = socket;
    const seatStatusKey = ['seat-status', showtimeId] as const;
    let disposed = false;
    let resyncGeneration = 0;
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;

    const resyncSeatStatus = (afterReconnect: boolean) => {
      resyncGeneration += 1;
      const generation = resyncGeneration;
      if (resyncTimer !== null) {
        clearTimeout(resyncTimer);
        resyncTimer = null;
      }
      if (!afterReconnect) {
        // Events between the HTTP snapshot and the room join are never
        // delivered, so the map needs one read sent after the join. A load
        // still in flight was sent before the join: wait for it, then read
        // once more.
        void refetchAfterInFlight(
          queryClient,
          seatStatusKey,
          () => disposed || generation !== resyncGeneration,
        );
        return;
      }
      resyncTimer = setTimeout(() => {
        resyncTimer = null;
        void queryClient.invalidateQueries({
          queryKey: seatStatusKey,
        });
      }, Math.floor(Math.random() * SEAT_STATUS_RECONNECT_JITTER_MS));
    };

    socket.on('connect', () => {
      useBookingStore.getState().setConnected(true);
      socket.emit('join-showtime', showtimeId);

      const isReconnect = hadPreviousConnection.current;
      if (isReconnect) {
        // Reconnect after disconnect
        toast.success(copy.reconnected, {
          id: 'ws-status',
          duration: 3000,
        });
      }
      resyncSeatStatus(isReconnect);

      hadPreviousConnection.current = true;
    });

    socket.on('connect_error', () => {
      if (!hadPreviousConnection.current) {
        toast.error(copy.connectFailed, {
          id: 'ws-status',
          duration: 5000,
        });
      }
    });

    socket.on('disconnect', (reason) => {
      useBookingStore.getState().setConnected(false);
      if (hadPreviousConnection.current && reason !== 'io client disconnect') {
        toast.loading(copy.reconnecting, {
          id: 'ws-status',
        });
      }
    });

    // After the final failed attempt the store stays disconnected, which
    // switches seat-status to the faster fallback polling in useSeatStatus.
    socket.io?.on('reconnect_failed', () => {
      toast.error(
        copy.reconnectFailed,
        {
          id: 'ws-status',
          duration: Infinity,
        },
      );
    });

    socket.on('seat-update', (data: SeatUpdateEvent) => {
      // Kept briefly so a seat-status snapshot read before this event (the API
      // serves one up to 1s old) does not undo it (useSeatStatus overlay).
      recordSeatUpdateEvent(showtimeId, data);
      // Update React Query cache directly
      queryClient.setQueryData<SeatStatusResponse>(
        ['seat-status', showtimeId],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            seats: { ...old.seats, [data.seatId]: data.status },
          };
        },
      );

      // The broadcast never says who locked a seat (audit #92), so a 'locked'
      // event cannot tell our own lock from someone else's. Selected seats are
      // reconciled by the lock API response instead: a lost race returns 409
      // and the caller removes the seat there.
    });

    socket.connect();

    return () => {
      disposed = true;
      clearSeatUpdateEvents(showtimeId);
      if (resyncTimer !== null) {
        clearTimeout(resyncTimer);
      }
      socket.emit('leave-showtime', showtimeId);
      socket.io?.off('reconnect_failed');
      socket.disconnect();
      socketRef.current = null;
      hadPreviousConnection.current = false;
      useBookingStore.getState().setConnected(false);
    };
  }, [showtimeId, queryClient, copy]);
}
