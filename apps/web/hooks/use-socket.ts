'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import { toast } from 'sonner';
import {
  normalizeSeatIdentity,
  type SeatState,
  type SeatStatusResponse,
  type SeatUpdateEvent,
} from '@grabit/shared';
import { createBookingSocket } from '@/lib/socket-client';
import { refetchAfterInFlight, SEAT_STATUS_RECONNECT_JITTER_MS } from '@/lib/booking/seat-resync';
import { clearSeatUpdateEvents, recordSeatUpdateEvent } from '@/lib/booking/seat-event-overlay';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getClientLocale } from '@/lib/i18n/client-copy';
import { useBookingStore } from '@/stores/use-booking-store';

/**
 * Legacy seat update event. The API sends it for every state except `locked`,
 * so a page loaded before the v2 rollout never runs its old "someone else took
 * your seat" removal on the user's own lock (audit #92 compatibility).
 * TODO(next release): stop listening once the API no longer sends it.
 */
export const SEAT_UPDATE_EVENT = 'seat-update';
/** Every seat state, `locked` included. */
export const SEAT_UPDATE_V2_EVENT = 'seat-update.v2';

/**
 * Upper bound for applying buffered seat updates when no animation frame runs
 * (hidden tab, throttled timers); visible tabs apply them on the next frame.
 */
export const SEAT_UPDATE_FLUSH_MAX_DELAY_MS = 150;
/**
 * A non-locked v2 event is followed by its legacy copy. A legacy event that
 * matches a v2 event received within this window is that copy and is skipped.
 */
export const SEAT_UPDATE_ECHO_WINDOW_MS = 10_000;

type ReceivedSeatState = { status: SeatState; receivedAtMs: number };

function toSeatKey(seatId: string): string {
  return normalizeSeatIdentity({ seatId }).seatKey;
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
    const seatStatusKey = ['seat-status', showtimeId] as const;
    let disposed = false;
    let resyncGeneration = 0;
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;

    // Seat updates waiting for the next flush: normalized seatKey -> the
    // latest event for that seat. One cache write per frame instead of one per
    // event keeps the seat page from rebuilding its state at the event rate
    // during an opening peak (audit #11).
    const pendingSeatUpdates = new Map<string, SeatUpdateEvent>();
    let flushFrame: number | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    // v2 events (non-locked) whose legacy copy has not arrived yet.
    const pendingLegacyEchoes = new Map<string, ReceivedSeatState[]>();

    const cancelScheduledFlush = () => {
      if (flushFrame !== null) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(flushFrame);
        }
        flushFrame = null;
      }
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    };

    const flushSeatUpdates = () => {
      cancelScheduledFlush();
      if (disposed || pendingSeatUpdates.size === 0) {
        return;
      }
      const batch: SeatStatusResponse['seats'] = {};
      for (const event of pendingSeatUpdates.values()) {
        batch[event.seatId] = event.status;
      }
      pendingSeatUpdates.clear();
      // Merged into whatever the cache holds at flush time, so a seat-status
      // read that landed meanwhile is kept for every other seat.
      queryClient.setQueryData<SeatStatusResponse>(seatStatusKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          seats: { ...old.seats, ...batch },
        };
      });
    };

    const scheduleFlush = () => {
      if (flushFrame === null && typeof requestAnimationFrame === 'function') {
        flushFrame = requestAnimationFrame(flushSeatUpdates);
      }
      if (flushTimer === null) {
        flushTimer = setTimeout(flushSeatUpdates, SEAT_UPDATE_FLUSH_MAX_DELAY_MS);
      }
    };

    const handleVisibilityChange = () => {
      // Frames stop in a hidden tab and resume only after it is shown again.
      flushSeatUpdates();
    };

    const applySeatUpdate = (data: SeatUpdateEvent) => {
      // Recorded at receipt (not at flush) so a seat-status snapshot read
      // before this event (the API serves one up to 1s old) does not undo it
      // (useSeatStatus overlay).
      recordSeatUpdateEvent(showtimeId, data);
      pendingSeatUpdates.set(toSeatKey(data.seatId), data);
      scheduleFlush();

      // The broadcast never says who locked a seat (audit #92), so a 'locked'
      // event cannot tell our own lock from someone else's. Selected seats are
      // reconciled by the lock API response instead: a lost race returns 409
      // and the caller removes the seat there.
    };

    const handleSeatUpdateV2 = (data: SeatUpdateEvent) => {
      if (data.status !== 'locked') {
        const seatKey = toSeatKey(data.seatId);
        const echoes = pendingLegacyEchoes.get(seatKey) ?? [];
        echoes.push({ status: data.status, receivedAtMs: Date.now() });
        pendingLegacyEchoes.set(seatKey, echoes);
      }
      applySeatUpdate(data);
    };

    const handleLegacySeatUpdate = (data: SeatUpdateEvent) => {
      const seatKey = toSeatKey(data.seatId);
      const echoes = pendingLegacyEchoes.get(seatKey);
      if (echoes) {
        const nowMs = Date.now();
        const live = echoes.filter(
          (echo) => nowMs - echo.receivedAtMs <= SEAT_UPDATE_ECHO_WINDOW_MS,
        );
        const matchIndex = live.findIndex((echo) => echo.status === data.status);
        if (matchIndex >= 0) {
          live.splice(matchIndex, 1);
        }
        if (live.length > 0) {
          pendingLegacyEchoes.set(seatKey, live);
        } else {
          pendingLegacyEchoes.delete(seatKey);
        }
        if (matchIndex >= 0) {
          // The copy of a v2 event already applied. Applying it again could
          // undo a newer v2 state of the same seat received in between.
          return;
        }
      }
      // An API without v2 (rollback) or an instance still on the old release.
      applySeatUpdate(data);
    };

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

    socket.on(SEAT_UPDATE_V2_EVENT, handleSeatUpdateV2);
    socket.on(SEAT_UPDATE_EVENT, handleLegacySeatUpdate);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    socket.connect();

    return () => {
      disposed = true;
      // Buffered updates belong to the showtime being left: drop them.
      cancelScheduledFlush();
      pendingSeatUpdates.clear();
      pendingLegacyEchoes.clear();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
