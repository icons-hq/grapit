'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import { toast } from 'sonner';
import type { SeatUpdateEvent, SeatStatusResponse } from '@grabit/shared';
import { normalizeSeatIdentity } from '@grabit/shared';
import { createBookingSocket } from '@/lib/socket-client';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getClientLocale } from '@/lib/i18n/client-copy';
import { useBookingStore } from '@/stores/use-booking-store';
import { useAuthStore } from '@/stores/use-auth-store';

/**
 * Upper bound of the random delay before resyncing seat-status after a
 * reconnect. A restarted WS instance reconnects every viewer at once; the
 * jitter keeps them from reloading the whole seat map in the same instant.
 */
export const SEAT_STATUS_RECONNECT_JITTER_MS = 3_000;

function toSeatKey(event: SeatUpdateEvent): string {
  return normalizeSeatIdentity({
    seatId: event.seatId,
    seatKey: event.seatKey,
    floorKey: event.floorKey,
  }).seatKey;
}

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
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;

    const resyncSeatStatus = (afterReconnect: boolean) => {
      if (resyncTimer !== null) {
        clearTimeout(resyncTimer);
        resyncTimer = null;
      }
      if (!afterReconnect) {
        // Events between the HTTP snapshot and the room join are not
        // delivered. Reload once after joining, unless the first load is still
        // running (that response is already newer than the join request).
        void queryClient.invalidateQueries(
          { queryKey: ['seat-status', showtimeId] },
          { cancelRefetch: false },
        );
        return;
      }
      resyncTimer = setTimeout(() => {
        resyncTimer = null;
        void queryClient.invalidateQueries({
          queryKey: ['seat-status', showtimeId],
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

      // Race condition check: if ANOTHER user locked a seat we selected
      // Ignore our own broadcasts (userId matches)
      const myUserId = useAuthStore.getState().user?.id;
      if (data.status === 'locked' && data.userId !== myUserId) {
        const store = useBookingStore.getState();
        if (store.selectedShowtimeId !== showtimeId) {
          return;
        }
        // Broadcasts carry the runtime seat id (floor-aware seat key), so
        // compare seat keys, not the per-floor seat id.
        const eventSeatKey = toSeatKey(data);
        const takenSeat = store.selectedSeats.find(
          (s) => s.seatKey === eventSeatKey,
        );
        if (takenSeat) {
          store.removeSeat(takenSeat.seatKey);
          toast.info(copy.seatTaken, {
            style: { backgroundColor: '#F3EFFF', color: '#6C3CE0' },
          });
        }
      }
    });

    socket.connect();

    return () => {
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
