'use client';

import { create } from 'zustand';
import type { FloorAwareSeatSelection, SeatSelection } from '@grabit/shared';

/**
 * A hold deadline closer than this is treated as already over: it cannot be
 * used to continue, so it neither dismisses an expiry notice nor counts as a
 * live server hold.
 */
export const HOLD_EXPIRY_MARGIN_MS = 1_000;

const DEFAULT_FLOOR_KEY = '1F';
const DEFAULT_FLOOR_LABEL = '1층';

function normalizeSeatSelection(
  seat: FloorAwareSeatSelection | SeatSelection,
): FloorAwareSeatSelection {
  const candidate = seat as Partial<FloorAwareSeatSelection>;
  const floorKey = candidate.floorKey?.trim() || DEFAULT_FLOOR_KEY;
  const floorLabel = candidate.floorLabel?.trim()
    || (floorKey === DEFAULT_FLOOR_KEY ? DEFAULT_FLOOR_LABEL : floorKey);

  return {
    ...seat,
    floorKey,
    floorLabel,
    seatKey: candidate.seatKey?.trim() || `${floorKey}:${seat.seatId}`,
  };
}

interface BookingState {
  selectedDate: Date | null;
  selectedShowtimeId: string | null;
  selectedSeats: FloorAwareSeatSelection[];
  timerExpiresAt: number | null;
  isTimerExpired: boolean;
  isConnected: boolean;

  // Confirm page fields
  performanceId: string | null;
  performanceTitle: string | null;
  showDateTime: string | null;
  venue: string | null;
  posterUrl: string | null;
  expiresAt: number | null;
  paymentDeadlineAt: number | null;

  setDate: (date: Date | null) => void;
  setShowtime: (id: string | null) => void;
  addSeat: (seat: FloorAwareSeatSelection | SeatSelection) => void;
  removeSeat: (seatKey: string) => void;
  clearSeats: () => void;
  setTimerExpiry: (expiresAt: number) => void;
  applyPaymentDeadline: (paymentDeadlineAt: string) => void;
  expireTimer: () => void;
  setConnected: (connected: boolean) => void;
  setBookingData: (data: {
    selectedSeats: Array<FloorAwareSeatSelection | SeatSelection>;
    showtimeId: string | null;
    performanceId: string | null;
    performanceTitle: string | null;
    showDateTime: string | null;
    venue: string | null;
    posterUrl: string | null;
    expiresAt: number | null;
  }) => void;
  clearBooking: () => void;
  resetBooking: () => void;
}

const initialState = {
  selectedDate: null,
  selectedShowtimeId: null,
  selectedSeats: [] as FloorAwareSeatSelection[],
  timerExpiresAt: null,
  isTimerExpired: false,
  isConnected: false,
  performanceId: null,
  performanceTitle: null,
  showDateTime: null,
  venue: null,
  posterUrl: null,
  expiresAt: null,
  paymentDeadlineAt: null,
};

export const useBookingStore = create<BookingState>((set) => ({
  ...initialState,

  setDate: (date) => set({ selectedDate: date }),

  // Re-selecting the current showtime must keep the selection: clearing it
  // would orphan the server locks behind it.
  setShowtime: (id) =>
    set((state) => (state.selectedShowtimeId === id
      ? state
      : {
        selectedShowtimeId: id,
        selectedSeats: [],
        timerExpiresAt: null,
        isTimerExpired: false,
      })),

  addSeat: (seat) =>
    set((state) => {
      const normalizedSeat = normalizeSeatSelection(seat);
      if (state.selectedSeats.some((selected) => selected.seatKey === normalizedSeat.seatKey)) {
        return state;
      }

      return {
        selectedSeats: [...state.selectedSeats, normalizedSeat],
      };
    }),

  removeSeat: (seatKey) =>
    set((state) => {
      const selectedSeats = state.selectedSeats.filter((seat) => seat.seatKey !== seatKey);
      if (selectedSeats.length === state.selectedSeats.length) {
        return state;
      }
      // No held seat means no server deadline: a later first lock gets a fresh
      // TTL. An expiry notice already shown stays (see setTimerExpiry).
      return selectedSeats.length === 0
        ? { selectedSeats, timerExpiresAt: null }
        : { selectedSeats };
    }),

  clearSeats: () => set({ selectedSeats: [], timerExpiresAt: null, isTimerExpired: false }),

  // Always follow the latest server deadline (lock response or my-locks).
  // Seats held together share the user's TTL, so overwriting is safe. An
  // expiry notice already shown is dismissed only by a deadline that is still
  // ahead (the server proved the hold alive); a past deadline, e.g. from a
  // background resync, keeps it until the user resets.
  setTimerExpiry: (expiresAt) =>
    set((state) => {
      const isTimerExpired = state.isTimerExpired
        && expiresAt - Date.now() <= HOLD_EXPIRY_MARGIN_MS;
      if (state.timerExpiresAt === expiresAt && state.isTimerExpired === isTimerExpired) {
        return state;
      }
      return { timerExpiresAt: expiresAt, isTimerExpired };
    }),

  applyPaymentDeadline: (paymentDeadlineAt) => {
    const parsedDeadline = Date.parse(paymentDeadlineAt);
    if (!Number.isFinite(parsedDeadline)) {
      return;
    }

    set({
      expiresAt: parsedDeadline,
      paymentDeadlineAt: parsedDeadline,
      isTimerExpired: false,
      timerExpiresAt: parsedDeadline,
    });
  },

  expireTimer: () => set({ isTimerExpired: true }),

  setConnected: (connected) => set({ isConnected: connected }),

  setBookingData: (data) =>
    set({
      selectedSeats: data.selectedSeats.map(normalizeSeatSelection),
      selectedShowtimeId: data.showtimeId,
      performanceId: data.performanceId,
      performanceTitle: data.performanceTitle,
      showDateTime: data.showDateTime,
      venue: data.venue,
      posterUrl: data.posterUrl,
      expiresAt: data.expiresAt,
      paymentDeadlineAt: null,
    }),

  clearBooking: () => set(initialState),

  resetBooking: () => set(initialState),
}));

// ============================================================================
// E2E fixture hook (dev/test only) — Phase 9 DEBT-05 / REVIEWS.md HIGH-01
// Allows Playwright specs to inject booking state via `window.__BOOKING_FIXTURE__`
// so the confirm page doesn't redirect to /booking/:id (see confirm/page.tsx:62-66).
//
// `setBookingData()` normalizes both legacy SeatSelection fixtures and the newer
// FloorAwareSeatSelection payloads into the floor-aware store contract.
//
// Production tree-shake: the `process.env.NODE_ENV !== 'production'` gate is
// resolved at build time by Next.js / Turbopack, removing this entire block
// from the production bundle.
// ============================================================================
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  // Defer to next tick so the store is fully constructed when we read it.
  queueMicrotask(() => {
    const fixture = (
      window as unknown as {
        __BOOKING_FIXTURE__?: {
          performanceId: string;
          showtimeId: string;
          seats: Array<FloorAwareSeatSelection | SeatSelection>;
          performanceTitle: string;
          showDateTime: string;
          venue: string;
          posterUrl?: string;
        };
      }
    ).__BOOKING_FIXTURE__;

    if (fixture) {
      useBookingStore.getState().setBookingData({
        selectedSeats: fixture.seats,
        showtimeId: fixture.showtimeId,
        performanceId: fixture.performanceId,
        performanceTitle: fixture.performanceTitle,
        showDateTime: fixture.showDateTime,
        venue: fixture.venue,
        posterUrl: fixture.posterUrl ?? null,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
    }
  });
}
