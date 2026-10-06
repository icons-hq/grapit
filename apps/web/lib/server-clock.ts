/**
 * Server-corrected clock for booking time decisions.
 *
 * The booking open instant, seat-lock expiry, queue access window and payment
 * deadline are absolute instants decided by server clocks (NTP-synced Cloud
 * Run). Device clocks drift by seconds to minutes, so client code that compares
 * against those instants must use getServerNowMs() instead of Date.now().
 *
 * The offset is measured from the same-origin `/api/runtime-flags` response,
 * which carries the web server's `serverNow` (see lib/runtime-flags.ts). Until a
 * sample arrives the offset is 0, which keeps the previous device-clock
 * behaviour.
 */

export interface ServerTimeSample {
  /** Server epoch ms written into the response body. */
  serverNowMs: number;
  /** Device Date.now() right before the request was sent. */
  requestStartedAtMs: number;
  /** Device Date.now() right after the response headers arrived. */
  responseReceivedAtMs: number;
}

interface AcceptedSample {
  offsetMs: number;
  rttMs: number;
  receivedAtMs: number;
}

/**
 * Samples with a slower round trip are too imprecise to correct anything: the error
 * of a sample is up to rtt/2, and an open-time burst can make the first response slow.
 */
export const SERVER_CLOCK_MAX_RTT_MS = 2_500;
/**
 * An offset within rtt/2 plus this margin cannot be told apart from an in-sync device
 * clock, so it is treated as zero: an NTP-synced device keeps its own clock instead of
 * taking on up to rtt/2 of measurement error.
 */
export const SERVER_CLOCK_INSIGNIFICANT_OFFSET_MARGIN_MS = 250;
/** A tighter sample is preferred, but an old one is refreshed after this age. */
export const SERVER_CLOCK_SAMPLE_MAX_AGE_MS = 10 * 60_000;

let acceptedSample: AcceptedSample | null = null;
const listeners = new Set<() => void>();

function shouldReplaceSample(
  current: AcceptedSample,
  next: AcceptedSample,
): boolean {
  if (next.rttMs <= current.rttMs) {
    return true;
  }

  const ageMs = next.receivedAtMs - current.receivedAtMs;
  if (ageMs < 0 || ageMs > SERVER_CLOCK_SAMPLE_MAX_AGE_MS) {
    return true;
  }

  // Each sample bounds the true offset within +/- rtt/2. Disjoint bounds mean
  // the device clock was changed since the previous sample.
  const toleranceMs = (current.rttMs + next.rttMs) / 2;
  return Math.abs(next.offsetMs - current.offsetMs) > toleranceMs;
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Records a server time sample and returns whether it was adopted. The offset
 * is server time minus the device time at the midpoint of the round trip.
 */
export function recordServerTimeSample(sample: ServerTimeSample): boolean {
  const { serverNowMs, requestStartedAtMs, responseReceivedAtMs } = sample;
  if (
    !Number.isFinite(serverNowMs) ||
    !Number.isFinite(requestStartedAtMs) ||
    !Number.isFinite(responseReceivedAtMs)
  ) {
    return false;
  }

  const rttMs = responseReceivedAtMs - requestStartedAtMs;
  if (rttMs < 0 || rttMs > SERVER_CLOCK_MAX_RTT_MS) {
    return false;
  }

  const measuredOffsetMs = Math.round(serverNowMs - (requestStartedAtMs + rttMs / 2));
  const nextSample: AcceptedSample = {
    offsetMs: Math.abs(measuredOffsetMs) <= rttMs / 2 + SERVER_CLOCK_INSIGNIFICANT_OFFSET_MARGIN_MS
      ? 0
      : measuredOffsetMs,
    rttMs,
    receivedAtMs: responseReceivedAtMs,
  };

  if (acceptedSample && !shouldReplaceSample(acceptedSample, nextSample)) {
    return false;
  }

  const previousOffsetMs = acceptedSample?.offsetMs ?? 0;
  acceptedSample = nextSample;
  if (nextSample.offsetMs !== previousOffsetMs) {
    notifyListeners();
  }
  return true;
}

export function getServerClockOffsetMs(): number {
  return acceptedSample?.offsetMs ?? 0;
}

/** Device time corrected to the server clock. */
export function getServerNowMs(): number {
  return Date.now() + getServerClockOffsetMs();
}

export function subscribeServerClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetServerClockForTests(): void {
  acceptedSample = null;
  notifyListeners();
}
