import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useCountdown } from '../use-countdown';
import {
  recordServerTimeSample,
  resetServerClockForTests,
} from '@/lib/server-clock';

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetServerClockForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns correct initial state when expiresAt is 600s from now', () => {
    const now = Date.now();
    const expiresAt = now + 600_000; // 10 minutes
    const onExpire = vi.fn();

    const { result } = renderHook(() => useCountdown(expiresAt, onExpire));

    expect(result.current.isActive).toBe(true);
    expect(result.current.isWarning).toBe(false);
    // Should be approximately 10 minutes (within 1 minute tolerance)
    expect(result.current.minutes).toBeGreaterThanOrEqual(9);
    expect(result.current.minutes).toBeLessThanOrEqual(10);
  });

  it('enters warning state at 3 minutes or less', () => {
    const now = Date.now();
    const expiresAt = now + 180_000; // exactly 3 minutes
    const onExpire = vi.fn();

    const { result } = renderHook(() => useCountdown(expiresAt, onExpire));

    expect(result.current.isWarning).toBe(true);
  });

  it('calls onExpire when remaining reaches 0', () => {
    const now = Date.now();
    const expiresAt = now + 2_000; // 2 seconds
    const onExpire = vi.fn();

    renderHook(() => useCountdown(expiresAt, onExpire));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('returns inactive state when expiresAt is null', () => {
    const onExpire = vi.fn();

    const { result } = renderHook(() => useCountdown(null, onExpire));

    expect(result.current.isActive).toBe(false);
    expect(result.current.minutes).toBe(0);
    expect(result.current.seconds).toBe(0);
    expect(result.current.isWarning).toBe(false);
  });

  describe('server clock offset (audit #95)', () => {
    const SERVER_NOW = Date.parse('2026-10-02T11:00:00.000Z');

    function syncServerClock(serverNowMs: number) {
      recordServerTimeSample({
        serverNowMs,
        requestStartedAtMs: Date.now() - 50,
        responseReceivedAtMs: Date.now() + 50,
      });
    }

    it('counts a server lock expiry on the server clock when the device runs 3 minutes fast', () => {
      vi.setSystemTime(SERVER_NOW + 180_000);
      syncServerClock(SERVER_NOW);
      const lockExpiresAt = SERVER_NOW + 600_000; // server: 10 minutes hold
      const onExpire = vi.fn();

      const { result } = renderHook(() => useCountdown(lockExpiresAt, onExpire));

      expect(result.current.minutes).toBe(10);
      expect(result.current.seconds).toBe(0);

      // Where the device clock would have expired the hold (7 minutes in).
      act(() => {
        vi.advanceTimersByTime(7 * 60_000 + 1_000);
      });
      expect(onExpire).not.toHaveBeenCalled();
      expect(result.current.isActive).toBe(true);

      act(() => {
        vi.advanceTimersByTime(3 * 60_000);
      });
      expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('recalculates when the offset arrives after the countdown started', () => {
      vi.setSystemTime(SERVER_NOW - 120_000); // device runs 2 minutes slow
      const lockExpiresAt = SERVER_NOW + 600_000;
      const onExpire = vi.fn();

      const { result } = renderHook(() => useCountdown(lockExpiresAt, onExpire));
      expect(result.current.minutes).toBe(12);

      act(() => {
        syncServerClock(SERVER_NOW);
      });

      expect(result.current.minutes).toBe(10);
      expect(result.current.seconds).toBe(0);
    });

    it('fires onExpire once per deadline even if the offset changes afterwards', () => {
      vi.setSystemTime(SERVER_NOW);
      const onExpire = vi.fn();

      renderHook(() => useCountdown(SERVER_NOW + 2_000, onExpire));
      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(onExpire).toHaveBeenCalledTimes(1);

      act(() => {
        syncServerClock(Date.now() + 5_000);
        vi.advanceTimersByTime(3_000);
      });
      expect(onExpire).toHaveBeenCalledTimes(1);
    });
  });

  it('cleans up interval on unmount', () => {
    const now = Date.now();
    const expiresAt = now + 60_000; // 1 minute
    const onExpire = vi.fn();

    const { unmount } = renderHook(() => useCountdown(expiresAt, onExpire));

    unmount();

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(onExpire).not.toHaveBeenCalled();
  });
});
