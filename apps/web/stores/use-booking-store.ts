'use client';

import { create } from 'zustand';
import type { FloorAwareSeatSelection, SeatSelection } from '@grabit/shared';

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

  setShowtime: (id) =>
    set({
      selectedShowtimeId: id,
      selectedSeats: [],
      timerExpiresAt: null,
      isTimerExpired: false,
    }),

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
    set((state) => ({
      selectedSeats: state.selectedSeats.filter((seat) => seat.seatKey !== seatKey),
    })),

  clearSeats: () => set({ selectedSeats: [], timerExpiresAt: null, isTimerExpired: false }),

  setTimerExpiry: (expiresAt) =>
    set((state) => ({
      timerExpiresAt: state.timerExpiresAt === null ? expiresAt : state.timerExpiresAt,
    })),

  applyPaymentDeadline: (paymentDeadlineAt) => {
    const parsedDeadline = Date.parse(paymentDeadlineAt);
    if (!Number.isFinite(parsedDeadline)) {
      return;
    }

    set((state) => ({
      expiresAt: parsedDeadline,
      paymentDeadlineAt: parsedDeadline,
      isTimerExpired: false,
      timerExpiresAt:
        state.timerExpiresAt === null || state.timerExpiresAt < parsedDeadline
          ? parsedDeadline
          : state.timerExpiresAt,
    }));
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
