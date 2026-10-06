import { describe, it, expect, beforeEach } from 'vitest';
import { HOLD_EXPIRY_MARGIN_MS, useBookingStore } from '../use-booking-store';

function seat(seatId: string) {
  return {
    seatId,
    tierName: 'VIP',
    tierColor: '#6C3CE0',
    row: 'A',
    number: seatId.split('-')[1] ?? '1',
    price: 110000,
    floorKey: '1F',
    floorLabel: '1층',
    seatKey: `1F:${seatId}`,
  };
}

describe('booking store seat selection', () => {
  beforeEach(() => {
    useBookingStore.getState().resetBooking();
  });

  it('keeps seats and timer when the current showtime is selected again (audit #29)', () => {
    const store = useBookingStore.getState();
    store.setShowtime('showtime-1');
    store.addSeat(seat('A-1'));
    store.setTimerExpiry(1_000_000);

    useBookingStore.getState().setShowtime('showtime-1');

    expect(useBookingStore.getState().selectedSeats).toHaveLength(1);
    expect(useBookingStore.getState().timerExpiresAt).toBe(1_000_000);

    useBookingStore.getState().setShowtime('showtime-2');

    expect(useBookingStore.getState().selectedSeats).toEqual([]);
    expect(useBookingStore.getState().timerExpiresAt).toBeNull();
  });

  it('clears the hold timer when the last selected seat is removed (audit #31)', () => {
    const store = useBookingStore.getState();
    store.setShowtime('showtime-1');
    store.addSeat(seat('A-1'));
    store.addSeat(seat('A-2'));
    store.setTimerExpiry(1_000_000);

    useBookingStore.getState().removeSeat('1F:A-1');
    expect(useBookingStore.getState().timerExpiresAt).toBe(1_000_000);

    useBookingStore.getState().removeSeat('1F:A-2');
    expect(useBookingStore.getState().timerExpiresAt).toBeNull();
  });

  it('follows every new server deadline instead of keeping the first one (audit #31)', () => {
    const store = useBookingStore.getState();
    store.setTimerExpiry(1_000_000);
    useBookingStore.getState().setTimerExpiry(2_000_000);

    expect(useBookingStore.getState().timerExpiresAt).toBe(2_000_000);
  });

  it('keeps an expiry notice open when the selection empties, and closes it on a deadline still ahead', () => {
    const store = useBookingStore.getState();
    store.setShowtime('showtime-1');
    store.addSeat(seat('A-1'));
    store.setTimerExpiry(Date.now() - 1_000);
    useBookingStore.getState().expireTimer();

    useBookingStore.getState().removeSeat('1F:A-1');
    expect(useBookingStore.getState().isTimerExpired).toBe(true);

    useBookingStore.getState().setTimerExpiry(Date.now() + 5 * 60 * 1000);
    expect(useBookingStore.getState().isTimerExpired).toBe(false);
  });

  it('keeps the expiry notice when a background resync brings a deadline that is already over', () => {
    const store = useBookingStore.getState();
    store.setShowtime('showtime-1');
    store.addSeat(seat('A-1'));
    const expiredAt = Date.now() - 1_000;
    store.setTimerExpiry(expiredAt);
    useBookingStore.getState().expireTimer();

    // e.g. a focus refetch of my-locks reconciling the same (past) deadline
    useBookingStore.getState().setTimerExpiry(expiredAt);
    expect(useBookingStore.getState().isTimerExpired).toBe(true);

    // ...or a deadline inside the safety margin
    useBookingStore.getState().setTimerExpiry(Date.now() + HOLD_EXPIRY_MARGIN_MS / 2);
    expect(useBookingStore.getState().isTimerExpired).toBe(true);
  });
});
