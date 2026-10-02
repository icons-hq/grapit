/**
 * Monotonic ordering for seat-lock sync on this page: every my-locks request
 * and every answered lock/unlock request takes the next number. A my-locks
 * snapshot reflects an operation only when it was requested after that
 * operation's response (a strictly larger number). Wall-clock milliseconds
 * cannot order a request and a response that happen in the same millisecond.
 */
let sequence = 0;

export function nextSeatSyncSequence(): number {
  sequence += 1;
  return sequence;
}
