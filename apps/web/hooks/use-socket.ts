'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import { toast } from 'sonner';
import type { SeatUpdateEvent, SeatStatusResponse } from '@grabit/shared';
import { createBookingSocket } from '@/lib/socket-client';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getClientLocale } from '@/lib/i18n/client-copy';
import { useBookingStore } from '@/stores/use-booking-store';
import { useAuthStore } from '@/stores/use-auth-store';

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

    socket.on('connect', () => {
      useBookingStore.getState().setConnected(true);
      socket.emit('join-showtime', showtimeId);

      if (hadPreviousConnection.current) {
        // Reconnect after disconnect
        toast.success(copy.reconnected, {
          id: 'ws-status',
          duration: 3000,
        });
        queryClient.invalidateQueries({
          queryKey: ['seat-status', showtimeId],
        });
      }

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
        const isOurSeat = store.selectedSeats.some(
          (s) => s.seatId === data.seatId,
        );
        if (isOurSeat) {
          store.removeSeat(data.seatId);
          toast.info(copy.seatTaken, {
            style: { backgroundColor: '#F3EFFF', color: '#6C3CE0' },
          });
        }
      }
    });

    socket.connect();

    return () => {
      socket.emit('leave-showtime', showtimeId);
      socket.io?.off('reconnect_failed');
      socket.disconnect();
      socketRef.current = null;
      hadPreviousConnection.current = false;
    };
  }, [showtimeId, queryClient, copy]);
}
