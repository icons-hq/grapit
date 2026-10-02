'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FloorAwareSeatSelection, LockSeatResponse } from '@grabit/shared';
import { useLockSeat, useUnlockAllSeats, useUnlockSeat } from '@/hooks/use-booking';
import { nextSeatSyncSequence } from '@/lib/booking/seat-sync-sequence';
import { useBookingStore } from '@/stores/use-booking-store';

export interface SeatLockRejection {
  error: unknown;
  showtimeId: string;
  seat: FloorAwareSeatSelection;
  /** False when the user already dropped the seat (or the showtime) meanwhile. */
  stillWanted: boolean;
}

export interface LockSeatRequestOptions {
  /**
   * Per-user seat limit. Seats whose release is still in flight count on the
   * server until the release lands, so when selected + releasing seats would
   * exceed the limit the lock waits for those releases first. Without a
   * limit the lock always waits for them.
   */
  perUserLimit?: number;
}

export interface SeatLockController {
  /** Optimistically selects the seat and locks it on the server. */
  lockSeat: (showtimeId: string, seat: FloorAwareSeatSelection, options?: LockSeatRequestOptions) => void;
  /** Deselects the seat and releases its lock (after an in-flight lock lands). */
  releaseSeat: (showtimeId: string, seatKey: string) => void;
  /** Releases every lock the user holds in the showtime. The caller clears the selection. */
  releaseAll: (showtimeId: string) => void;
  isLockPending: (showtimeId: string, seatKey: string) => boolean;
  isUnlockPending: (showtimeId: string, seatKey: string) => boolean;
  hasPendingLocksFor: (showtimeId: string) => boolean;
  /**
   * True when no seat operation is in flight and a my-locks snapshot with
   * this request sequence was sent after the server answered every
   * operation, so it reflects all of them.
   */
  isSnapshotCurrent: (requestSeq: number) => boolean;
  /** Resolves once every in-flight seat operation has settled. */
  waitForIdle: () => Promise<void>;
  pendingLockCount: number;
  isReleasingAll: boolean;
}

type PendingLock = { showtimeId: string; seatKey: string; promise: Promise<void> };
type PendingUnlock = { showtimeId: string; promise: Promise<void> };

function toOperationKey(showtimeId: string, seatKey: string): string {
  return `${showtimeId}\u0000${seatKey}`;
}

function isSeatSelected(showtimeId: string, seatKey: string): boolean {
  const state = useBookingStore.getState();
  return state.selectedShowtimeId === showtimeId
    && state.selectedSeats.some((seat) => seat.seatKey === seatKey);
}

async function settleQuietly(promises: Iterable<Promise<unknown>>): Promise<void> {
  await Promise.allSettled(Array.from(promises));
}

/**
 * Coordinates seat lock/unlock requests for the seat selection page.
 *
 * - Each lock is awaited on its own promise (`mutateAsync`). Per-call
 *   `mutate()` callbacks are dropped by TanStack Query when the next seat is
 *   clicked, which left unheld seats selected and skipped timer updates.
 * - At most one lock request per seat is in flight. Clicking a seat whose lock
 *   is pending only toggles the local selection; when the lock lands, a seat
 *   that is no longer selected is released at once, so no hidden lock is left
 *   behind (double tap, quick cancel, showtime change, reset).
 * - A lock never goes out while a release of the same seat or of the whole
 *   showtime is in flight, so the release cannot drop the new lock.
 */
export function useSeatLockController(options: {
  onLockRejected?: (rejection: SeatLockRejection) => void;
} = {}): SeatLockController {
  const lastServerResponseSeqRef = useRef(0);
  const markServerResponse = useCallback(() => {
    lastServerResponseSeqRef.current = nextSeatSyncSequence();
  }, []);
  const mutationOptions = { onServerResponse: markServerResponse };
  const lockMutation = useLockSeat(mutationOptions);
  const unlockMutation = useUnlockSeat(mutationOptions);
  const unlockAllMutation = useUnlockAllSeats(mutationOptions);

  const lockMutateRef = useRef(lockMutation.mutateAsync);
  const unlockMutateRef = useRef(unlockMutation.mutateAsync);
  const unlockAllMutateRef = useRef(unlockAllMutation.mutateAsync);
  const onLockRejectedRef = useRef(options.onLockRejected);
  useEffect(() => {
    lockMutateRef.current = lockMutation.mutateAsync;
    unlockMutateRef.current = unlockMutation.mutateAsync;
    unlockAllMutateRef.current = unlockAllMutation.mutateAsync;
    onLockRejectedRef.current = options.onLockRejected;
  });

  const pendingLocksRef = useRef(new Map<string, PendingLock>());
  const pendingUnlocksRef = useRef(new Map<string, PendingUnlock>());
  const pendingReleaseAllRef = useRef(new Map<string, Promise<void>>());
  /** Bumped by every release-all; a lock sent before the bump may have been released by it. */
  const releaseGenerationRef = useRef(new Map<string, number>());
  const [pendingLockCount, setPendingLockCount] = useState(0);
  const [releasingAllCount, setReleasingAllCount] = useState(0);

  const startUnlock = useCallback((showtimeId: string, seatKey: string): Promise<void> => {
    const key = toOperationKey(showtimeId, seatKey);
    const existing = pendingUnlocksRef.current.get(key);
    if (existing) {
      return existing.promise;
    }

    const promise = (async () => {
      try {
        await unlockMutateRef.current({ showtimeId, seatId: seatKey });
      } catch {
        // The hook resyncs my-locks; a lock that survived is restored into the selection.
      }
    })().finally(() => {
      pendingUnlocksRef.current.delete(key);
    });
    pendingUnlocksRef.current.set(key, { showtimeId, promise });
    return promise;
  }, []);

  const collectReleases = useCallback((showtimeId: string, exceptKey: string) => {
    const releases: Promise<void>[] = [];
    for (const [key, unlock] of pendingUnlocksRef.current) {
      if (key !== exceptKey && unlock.showtimeId === showtimeId) {
        releases.push(unlock.promise);
      }
    }
    for (const [key, lock] of pendingLocksRef.current) {
      if (key !== exceptKey && lock.showtimeId === showtimeId && !isSeatSelected(showtimeId, lock.seatKey)) {
        releases.push(lock.promise);
      }
    }
    return releases;
  }, []);

  const lockSeat = useCallback((
    showtimeId: string,
    seat: FloorAwareSeatSelection,
    requestOptions: LockSeatRequestOptions = {},
  ) => {
    const key = toOperationKey(showtimeId, seat.seatKey);
    useBookingStore.getState().addSeat(seat);
    if (pendingLocksRef.current.has(key)) {
      // Selected again while its request is in flight: the running operation
      // keeps or re-acquires the lock based on the selection when it lands.
      return;
    }

    const pendingReleases = collectReleases(showtimeId, key);
    const selectedCount = useBookingStore.getState().selectedSeats.length;
    const extraReleases = requestOptions.perUserLimit === undefined
      || selectedCount + pendingReleases.length > requestOptions.perUserLimit
      ? pendingReleases
      : [];

    const promise = (async () => {
      let isFirstAttempt = true;
      // Repeats only when the seat is selected again while its lock is being
      // released, so the final server state matches the final selection.
      while (isSeatSelected(showtimeId, seat.seatKey)) {
        for (;;) {
          const blockers: Promise<void>[] = isFirstAttempt ? [...extraReleases] : [];
          isFirstAttempt = false;
          const sameSeatUnlock = pendingUnlocksRef.current.get(key);
          if (sameSeatUnlock) blockers.push(sameSeatUnlock.promise);
          const pendingReleaseAll = pendingReleaseAllRef.current.get(showtimeId);
          if (pendingReleaseAll) blockers.push(pendingReleaseAll);
          if (blockers.length === 0) {
            break;
          }
          await settleQuietly(blockers);
          if (!isSeatSelected(showtimeId, seat.seatKey)) {
            return;
          }
        }

        const releaseGeneration = releaseGenerationRef.current.get(showtimeId) ?? 0;
        let response: LockSeatResponse;
        try {
          response = await lockMutateRef.current({
            showtimeId,
            seatId: seat.seatId,
            floorKey: seat.floorKey,
            floorLabel: seat.floorLabel,
            seatKey: seat.seatKey,
          });
        } catch (error) {
          const stillWanted = isSeatSelected(showtimeId, seat.seatKey);
          if (stillWanted) {
            useBookingStore.getState().removeSeat(seat.seatKey);
          }
          onLockRejectedRef.current?.({ error, showtimeId, seat, stillWanted });
          return;
        }

        const raceWithReleaseAll = (releaseGenerationRef.current.get(showtimeId) ?? 0) !== releaseGeneration;
        if (isSeatSelected(showtimeId, seat.seatKey) && !raceWithReleaseAll) {
          if (response?.expiresAt) {
            useBookingStore.getState().setTimerExpiry(response.expiresAt);
          }
          return;
        }

        // Dropped while the request was in flight, or a release-all raced
        // with it (the lock may or may not have survived). Release it
        // explicitly instead of leaving a lock the page does not show.
        const racingReleaseAll = pendingReleaseAllRef.current.get(showtimeId);
        if (racingReleaseAll) {
          await settleQuietly([racingReleaseAll]);
        }
        await startUnlock(showtimeId, seat.seatKey);
      }
    })().finally(() => {
      pendingLocksRef.current.delete(key);
      setPendingLockCount(pendingLocksRef.current.size);
    });

    pendingLocksRef.current.set(key, { showtimeId, seatKey: seat.seatKey, promise });
    setPendingLockCount(pendingLocksRef.current.size);
  }, [collectReleases, startUnlock]);

  const releaseSeat = useCallback((showtimeId: string, seatKey: string) => {
    const state = useBookingStore.getState();
    if (state.selectedShowtimeId === showtimeId) {
      state.removeSeat(seatKey);
    }
    if (pendingLocksRef.current.has(toOperationKey(showtimeId, seatKey))) {
      // The pending lock releases itself when it lands (see lockSeat).
      return;
    }
    void startUnlock(showtimeId, seatKey);
  }, [startUnlock]);

  const releaseAll = useCallback((showtimeId: string) => {
    releaseGenerationRef.current.set(showtimeId, (releaseGenerationRef.current.get(showtimeId) ?? 0) + 1);
    if (pendingReleaseAllRef.current.has(showtimeId)) {
      return;
    }
    const promise = (async () => {
      try {
        await unlockAllMutateRef.current({ showtimeId });
      } catch {
        // The hook resyncs seat-status and my-locks.
      }
    })().finally(() => {
      pendingReleaseAllRef.current.delete(showtimeId);
      setReleasingAllCount(pendingReleaseAllRef.current.size);
    });
    pendingReleaseAllRef.current.set(showtimeId, promise);
    setReleasingAllCount(pendingReleaseAllRef.current.size);
  }, []);

  const isLockPending = useCallback(
    (showtimeId: string, seatKey: string) => pendingLocksRef.current.has(toOperationKey(showtimeId, seatKey)),
    [],
  );
  const isUnlockPending = useCallback(
    (showtimeId: string, seatKey: string) => pendingUnlocksRef.current.has(toOperationKey(showtimeId, seatKey)),
    [],
  );
  const hasPendingLocksFor = useCallback((showtimeId: string) => {
    for (const lock of pendingLocksRef.current.values()) {
      if (lock.showtimeId === showtimeId) return true;
    }
    return false;
  }, []);

  const hasPendingOperations = useCallback(
    () => pendingLocksRef.current.size > 0
      || pendingUnlocksRef.current.size > 0
      || pendingReleaseAllRef.current.size > 0,
    [],
  );

  const isSnapshotCurrent = useCallback(
    (requestSeq: number) => !hasPendingOperations() && requestSeq >= lastServerResponseSeqRef.current,
    [hasPendingOperations],
  );

  const waitForIdle = useCallback(async () => {
    while (hasPendingOperations()) {
      await settleQuietly([
        ...Array.from(pendingLocksRef.current.values(), (lock) => lock.promise),
        ...Array.from(pendingUnlocksRef.current.values(), (unlock) => unlock.promise),
        ...pendingReleaseAllRef.current.values(),
      ]);
    }
  }, [hasPendingOperations]);

  return useMemo(() => ({
    lockSeat,
    releaseSeat,
    releaseAll,
    isLockPending,
    isUnlockPending,
    hasPendingLocksFor,
    isSnapshotCurrent,
    waitForIdle,
    pendingLockCount,
    isReleasingAll: releasingAllCount > 0,
  }), [
    hasPendingLocksFor,
    isLockPending,
    isSnapshotCurrent,
    isUnlockPending,
    lockSeat,
    pendingLockCount,
    releaseAll,
    releaseSeat,
    releasingAllCount,
    waitForIdle,
  ]);
}
