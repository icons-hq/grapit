/**
 * Queue access window helpers.
 *
 * After admission the server grants a fixed access window (`activeUntilAt`).
 * Seat locks and prepare are rejected once it closes, even while a seat lock
 * is still alive, so the booking screens count down to whichever ends first.
 */

/** Parses a server ISO instant; anything unusable is treated as absent. */
export function parseServerDeadline(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The earliest of the known deadlines (epoch ms), or null when none is set. */
export function earliestDeadline(
  ...deadlines: Array<number | null | undefined>
): number | null {
  let earliest: number | null = null;
  for (const deadline of deadlines) {
    if (typeof deadline !== 'number' || !Number.isFinite(deadline)) {
      continue;
    }
    if (earliest === null || deadline < earliest) {
      earliest = deadline;
    }
  }
  return earliest;
}
