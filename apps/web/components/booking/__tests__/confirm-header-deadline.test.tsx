import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmHeader } from '@/components/booking/confirm-header';
import {
  recordServerTimeSample,
  resetServerClockForTests,
} from '@/lib/server-clock';
import { useBookingStore } from '@/stores/use-booking-store';

vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
}));

const SERVER_NOW = Date.parse('2026-10-02T11:05:00.000Z');

describe('ConfirmHeader deadline (audit #95, #97)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetServerClockForTests();
    useBookingStore.getState().resetBooking();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires on the server clock even when the device clock runs fast', () => {
    vi.setSystemTime(SERVER_NOW + 3 * 60_000);
    recordServerTimeSample({
      serverNowMs: SERVER_NOW,
      requestStartedAtMs: Date.now() - 50,
      responseReceivedAtMs: Date.now() + 50,
    });
    useBookingStore.setState({ expiresAt: SERVER_NOW + 5 * 60_000 });
    const onExpire = vi.fn();

    render(<ConfirmHeader onExpire={onExpire} onBack={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(2 * 60_000 + 1_000);
    });
    expect(onExpire).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
