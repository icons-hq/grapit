import { afterEach, describe, expect, it } from 'vitest';
import {
  SEAT_EVENT_OVERLAY_MARGIN_MS,
  SEAT_EVENT_OVERLAY_RETENTION_MS,
  SEAT_STATUS_SNAPSHOT_MAX_AGE_MS,
  clearSeatUpdateEvents,
  getSnapshotEventCutoffMs,
  overlayRecentSeatEvents,
  recordSeatUpdateEvent,
} from './seat-event-overlay';
import { recordServerTimeSample, resetServerClockForTests } from '@/lib/server-clock';

const SHOWTIME = 'showtime-1';
const T0 = 1_800_000_000_000;

describe('seat-status snapshot overlay (u07 generatedAt × w1a socket events)', () => {
  afterEach(() => {
    clearSeatUpdateEvents();
    resetServerClockForTests();
  });

  it('keeps a lock broadcast after the cached snapshot was read', () => {
    // Snapshot read at T0-800 (cache hit), event at T0-300, request at T0.
    recordSeatUpdateEvent(SHOWTIME, { seatId: 'A-1', status: 'locked' }, T0 - 300);

    const merged = overlayRecentSeatEvents(
      SHOWTIME,
      { showtimeId: SHOWTIME, seats: {}, generatedAt: T0 - 800 },
      { requestStartedAtMs: T0, nowMs: T0 + 50 },
    );

    expect(merged.seats).toEqual({ 'A-1': 'locked' });
  });

  it('keeps a release received while the request was in flight', () => {
    recordSeatUpdateEvent(SHOWTIME, { seatId: 'A-2', status: 'available' }, T0 + 20);

    const merged = overlayRecentSeatEvents(
      SHOWTIME,
      { showtimeId: SHOWTIME, seats: { 'A-2': 'locked', 'A-3': 'sold' }, generatedAt: T0 - 900 },
      { requestStartedAtMs: T0, nowMs: T0 + 60 },
    );

    expect(merged.seats).toEqual({ 'A-2': 'available', 'A-3': 'sold' });
  });

  it('lets the snapshot win over events older than any snapshot it could be', () => {
    const cutoff = T0 - SEAT_STATUS_SNAPSHOT_MAX_AGE_MS - SEAT_EVENT_OVERLAY_MARGIN_MS;
    recordSeatUpdateEvent(SHOWTIME, { seatId: 'A-4', status: 'locked' }, cutoff - 1);

    const response = { showtimeId: SHOWTIME, seats: {}, generatedAt: T0 };
    const merged = overlayRecentSeatEvents(SHOWTIME, response, { requestStartedAtMs: T0, nowMs: T0 });

    // e.g. a lock that expired by Redis TTL (never broadcast) reappears as available.
    expect(merged).toBe(response);
  });

  it('never moves the cut-off later than the request start minus the cache age, even with a skewed clock', () => {
    // Server clock estimated 5s ahead of the device.
    recordServerTimeSample({ serverNowMs: T0 + 5_000, requestStartedAtMs: T0 - 10, responseReceivedAtMs: T0 + 10 });

    expect(getSnapshotEventCutoffMs({ generatedAt: T0 + 5_000 }, T0))
      .toBe(T0 - SEAT_STATUS_SNAPSHOT_MAX_AGE_MS - SEAT_EVENT_OVERLAY_MARGIN_MS);
    // An older generatedAt widens the window instead.
    expect(getSnapshotEventCutoffMs({ generatedAt: T0 + 5_000 - 3_000 }, T0))
      .toBe(T0 - 3_000 - SEAT_EVENT_OVERLAY_MARGIN_MS);
    // Older servers without generatedAt fall back to the request start.
    expect(getSnapshotEventCutoffMs({}, T0))
      .toBe(T0 - SEAT_STATUS_SNAPSHOT_MAX_AGE_MS - SEAT_EVENT_OVERLAY_MARGIN_MS);
  });

  it('keeps one entry per seat when the snapshot spells the id differently', () => {
    recordSeatUpdateEvent(SHOWTIME, { seatId: 'A-5', status: 'available' }, T0);

    const merged = overlayRecentSeatEvents(
      SHOWTIME,
      { showtimeId: SHOWTIME, seats: { '1F:A-5': 'locked' }, generatedAt: T0 - 500 },
      { requestStartedAtMs: T0, nowMs: T0 },
    );

    expect(merged.seats).toEqual({ 'A-5': 'available' });
  });

  it('applies only the latest event per seat and forgets old ones', () => {
    recordSeatUpdateEvent(SHOWTIME, { seatId: 'A-6', status: 'locked' }, T0 - 200);
    recordSeatUpdateEvent(SHOWTIME, { seatId: 'A-6', status: 'sold' }, T0 - 100);

    const merged = overlayRecentSeatEvents(
      SHOWTIME,
      { showtimeId: SHOWTIME, seats: {}, generatedAt: T0 - 900 },
      { requestStartedAtMs: T0, nowMs: T0 },
    );
    expect(merged.seats).toEqual({ 'A-6': 'sold' });

    const later = T0 + SEAT_EVENT_OVERLAY_RETENTION_MS + 1;
    const response = { showtimeId: SHOWTIME, seats: {}, generatedAt: T0 - 10_000 };
    expect(overlayRecentSeatEvents(SHOWTIME, response, { requestStartedAtMs: T0, nowMs: later }))
      .toBe(response);
  });

  it('keeps showtimes apart and clears them with the socket', () => {
    recordSeatUpdateEvent('other-showtime', { seatId: 'A-7', status: 'locked' }, T0);
    const response = { showtimeId: SHOWTIME, seats: {}, generatedAt: T0 - 500 };
    expect(overlayRecentSeatEvents(SHOWTIME, response, { requestStartedAtMs: T0, nowMs: T0 })).toBe(response);

    recordSeatUpdateEvent(SHOWTIME, { seatId: 'A-8', status: 'locked' }, T0);
    clearSeatUpdateEvents(SHOWTIME);
    expect(overlayRecentSeatEvents(SHOWTIME, response, { requestStartedAtMs: T0, nowMs: T0 })).toBe(response);
  });
});
