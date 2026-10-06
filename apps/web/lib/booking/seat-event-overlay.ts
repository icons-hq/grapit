import { normalizeSeatIdentity, type SeatState, type SeatStatusResponse, type SeatUpdateEvent } from '@grabit/shared';
import { getServerClockOffsetMs } from '@/lib/server-clock';

/**
 * Keeps live seat-update events from being overwritten by an older seat-status
 * snapshot (audit #8 × #92 seam).
 *
 * The API answers GET seat-status from a shared snapshot that can be up to
 * SEAT_STATUS_SNAPSHOT_MAX_AGE_MS old (`generatedAt`). A poll, a reconnect
 * resync or a focus refetch replaces the whole cached seat map with that
 * snapshot, so a lock or release broadcast after the snapshot was read (and
 * already applied from the socket) would flip back until the next poll. Each
 * snapshot is therefore merged with the events received since it may have
 * been read.
 *
 * Erring early is the safe side: re-applying an event the snapshot already
 * contains changes nothing, while dropping a newer one shows a wrong seat.
 * That is why the cut-off is the earliest instant the snapshot can have been
 * read (request start minus the cache age, or `generatedAt` if older), minus
 * a margin for clock error. Events are kept only briefly, so a
 * change the socket never announces (Redis TTL expiry) still wins at the next
 * poll.
 */

/** Matches the API seat-status cache TTL (booking.service SEAT_STATUS_CACHE_TTL_MS). */
export const SEAT_STATUS_SNAPSHOT_MAX_AGE_MS = 1_000;
/** Clock-offset error and server-side read/broadcast ordering. */
export const SEAT_EVENT_OVERLAY_MARGIN_MS = 500;
/** Events older than this are never newer than a snapshot requested now. */
export const SEAT_EVENT_OVERLAY_RETENTION_MS = 10_000;

interface RecordedSeatEvent {
  seatId: string;
  status: SeatState;
  receivedAtMs: number;
}

/** showtimeId -> normalized seatKey -> latest event for that seat. */
const recentEventsByShowtime = new Map<string, Map<string, RecordedSeatEvent>>();

function toSeatKey(seatId: string): string {
  return normalizeSeatIdentity({ seatId }).seatKey;
}

function prune(events: Map<string, RecordedSeatEvent>, nowMs: number): void {
  for (const [seatKey, event] of events) {
    if (nowMs - event.receivedAtMs > SEAT_EVENT_OVERLAY_RETENTION_MS) {
      events.delete(seatKey);
    }
  }
}

/** Remembers a seat-update event (device clock at receipt). */
export function recordSeatUpdateEvent(
  showtimeId: string,
  event: Pick<SeatUpdateEvent, 'seatId' | 'status'>,
  receivedAtMs: number = Date.now(),
): void {
  let events = recentEventsByShowtime.get(showtimeId);
  if (!events) {
    events = new Map();
    recentEventsByShowtime.set(showtimeId, events);
  }
  prune(events, receivedAtMs);
  events.set(toSeatKey(event.seatId), {
    seatId: event.seatId,
    status: event.status,
    receivedAtMs,
  });
}

/** Forgets a showtime's events (socket closed or showtime changed). */
export function clearSeatUpdateEvents(showtimeId?: string): void {
  if (showtimeId === undefined) {
    recentEventsByShowtime.clear();
    return;
  }
  recentEventsByShowtime.delete(showtimeId);
}

/** Device time before which an event is assumed to be part of the snapshot. */
export function getSnapshotEventCutoffMs(
  response: Pick<SeatStatusResponse, 'generatedAt'>,
  requestStartedAtMs: number,
): number {
  // A snapshot served for this request was read at most this long before it.
  const fromRequest = requestStartedAtMs - SEAT_STATUS_SNAPSHOT_MAX_AGE_MS;
  const generatedAt = response.generatedAt;
  // `generatedAt` (server epoch ms, converted to device time) only moves the
  // cut-off earlier: a skewed clock estimate then keeps a few extra events
  // instead of dropping newer ones.
  const fromGeneratedAt = typeof generatedAt === 'number' && Number.isFinite(generatedAt)
    ? generatedAt - getServerClockOffsetMs()
    : Number.POSITIVE_INFINITY;
  return Math.min(fromRequest, fromGeneratedAt) - SEAT_EVENT_OVERLAY_MARGIN_MS;
}

/**
 * Applies the events received after the snapshot may have been read on top
 * of it. Returns the response unchanged when there is nothing newer.
 */
export function overlayRecentSeatEvents(
  showtimeId: string,
  response: SeatStatusResponse,
  options: { requestStartedAtMs: number; nowMs?: number },
): SeatStatusResponse {
  const events = recentEventsByShowtime.get(showtimeId);
  if (!events || events.size === 0 || !response?.seats) {
    return response;
  }
  prune(events, options.nowMs ?? Date.now());
  const cutoffMs = getSnapshotEventCutoffMs(response, options.requestStartedAtMs);
  const newer = [...events.entries()].filter(([, event]) => event.receivedAtMs >= cutoffMs);
  if (newer.length === 0) {
    return response;
  }

  const newerKeys = new Set(newer.map(([seatKey]) => seatKey));
  const seats: SeatStatusResponse['seats'] = {};
  for (const [seatId, state] of Object.entries(response.seats)) {
    // One entry per seat: the snapshot may spell the id differently.
    if (!newerKeys.has(toSeatKey(seatId))) {
      seats[seatId] = state;
    }
  }
  for (const [, event] of newer) {
    seats[event.seatId] = event.status;
  }
  return { ...response, seats };
}
