import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SERVER_CLOCK_MAX_RTT_MS,
  getServerClockOffsetMs,
  getServerNowMs,
  recordServerTimeSample,
  resetServerClockForTests,
  subscribeServerClock,
} from '@/lib/server-clock';

const SERVER_OPEN_AT = Date.parse('2026-10-02T11:00:00.000Z');

describe('server clock offset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetServerClockForTests();
  });

  afterEach(() => {
    resetServerClockForTests();
    vi.useRealTimers();
  });

  it('falls back to the device clock until a sample arrives', () => {
    vi.setSystemTime(SERVER_OPEN_AT);

    expect(getServerClockOffsetMs()).toBe(0);
    expect(getServerNowMs()).toBe(SERVER_OPEN_AT);
  });

  it('corrects a device clock that runs 90 seconds slow using the round-trip midpoint', () => {
    // Server is at 11:00:00.100 when it writes the body; the device clock reads
    // 90s earlier and the request took 200ms.
    const deviceSentAt = SERVER_OPEN_AT - 90_000;
    expect(
      recordServerTimeSample({
        serverNowMs: SERVER_OPEN_AT + 100,
        requestStartedAtMs: deviceSentAt,
        responseReceivedAtMs: deviceSentAt + 200,
      }),
    ).toBe(true);

    expect(getServerClockOffsetMs()).toBe(90_000);

    vi.setSystemTime(SERVER_OPEN_AT - 90_000);
    expect(getServerNowMs()).toBe(SERVER_OPEN_AT);
  });

  it('ignores unusable samples', () => {
    expect(
      recordServerTimeSample({
        serverNowMs: Number.NaN,
        requestStartedAtMs: 0,
        responseReceivedAtMs: 10,
      }),
    ).toBe(false);
    expect(
      recordServerTimeSample({
        serverNowMs: SERVER_OPEN_AT,
        requestStartedAtMs: 1_000,
        responseReceivedAtMs: 900,
      }),
    ).toBe(false);
    expect(
      recordServerTimeSample({
        serverNowMs: SERVER_OPEN_AT,
        requestStartedAtMs: 0,
        responseReceivedAtMs: SERVER_CLOCK_MAX_RTT_MS + 1,
      }),
    ).toBe(false);

    expect(getServerClockOffsetMs()).toBe(0);
  });

  it('keeps the tighter sample unless the device clock was changed', () => {
    recordServerTimeSample({
      serverNowMs: 10_050,
      requestStartedAtMs: 0,
      responseReceivedAtMs: 100,
    });
    expect(getServerClockOffsetMs()).toBe(10_000);

    // A slower sample within the same uncertainty window does not replace it.
    expect(
      recordServerTimeSample({
        serverNowMs: 21_000,
        requestStartedAtMs: 10_000,
        responseReceivedAtMs: 11_200,
      }),
    ).toBe(false);
    expect(getServerClockOffsetMs()).toBe(10_000);

    // The device clock jumped 3 minutes ahead: bounds no longer overlap.
    expect(
      recordServerTimeSample({
        serverNowMs: 30_000,
        requestStartedAtMs: 200_000,
        responseReceivedAtMs: 200_400,
      }),
    ).toBe(true);
    expect(getServerClockOffsetMs()).toBe(30_000 - 200_200);
  });

  it('rejects a slow round trip whose error could exceed the correction (RTT 4s, offset 300ms)', () => {
    expect(SERVER_CLOCK_MAX_RTT_MS).toBe(2_500);
    expect(
      recordServerTimeSample({
        serverNowMs: 2_000 + 300,
        requestStartedAtMs: 0,
        responseReceivedAtMs: 4_000,
      }),
    ).toBe(false);
    expect(getServerClockOffsetMs()).toBe(0);
  });

  it('keeps an in-sync device clock when the offset is within rtt/2 + 250ms', () => {
    // RTT 400ms, measured offset 300ms <= 200 + 250: indistinguishable from no skew.
    expect(
      recordServerTimeSample({
        serverNowMs: 200 + 300,
        requestStartedAtMs: 0,
        responseReceivedAtMs: 400,
      }),
    ).toBe(true);
    expect(getServerClockOffsetMs()).toBe(0);

    // Just past the margin the offset is applied.
    resetServerClockForTests();
    expect(
      recordServerTimeSample({
        serverNowMs: 200 + 451,
        requestStartedAtMs: 0,
        responseReceivedAtMs: 400,
      }),
    ).toBe(true);
    expect(getServerClockOffsetMs()).toBe(451);
  });

  it('adopts a tight sample from a device clock 90 seconds off (RTT 200ms, offset 90s)', () => {
    expect(
      recordServerTimeSample({
        serverNowMs: 100 + 90_000,
        requestStartedAtMs: 0,
        responseReceivedAtMs: 200,
      }),
    ).toBe(true);
    expect(getServerClockOffsetMs()).toBe(90_000);
  });

  it('notifies subscribers when the offset changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeServerClock(listener);

    recordServerTimeSample({
      serverNowMs: 5_050,
      requestStartedAtMs: 0,
      responseReceivedAtMs: 100,
    });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    recordServerTimeSample({
      serverNowMs: 9_010,
      requestStartedAtMs: 0,
      responseReceivedAtMs: 20,
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
