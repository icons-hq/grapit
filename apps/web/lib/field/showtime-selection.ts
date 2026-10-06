import { formatAdminKstDate } from '@/lib/admin-datetime';

/**
 * A scanner's showtime choice must survive the new tab that a phone OS camera
 * opens for every QR link. sessionStorage is per tab, so the choice lives in
 * localStorage (sessionStorage only when localStorage is unavailable) and is
 * restored only while it is fresh and still matches the current showtime list.
 */
const STORAGE_KEY_PREFIX = 'grabit-field-showtime:';
export const FIELD_SHOWTIME_SELECTION_TTL_MS = 12 * 60 * 60 * 1000;
/** A showtime that starts within this window from now can be restored. */
export const FIELD_SHOWTIME_RESTORE_AHEAD_MS = 12 * 60 * 60 * 1000;
/** A showtime that started at most this long ago can still be restored. */
export const FIELD_SHOWTIME_RESTORE_PAST_MS = 6 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface FieldShowtimeSelection {
  showtimeId: string;
  showtimeDateTime: string;
  selectedAt: string;
}

interface SelectableShowtime {
  id: string;
  dateTime: string;
}

export function fieldShowtimeSelectionKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

export function saveFieldShowtimeSelection(
  userId: string,
  showtime: SelectableShowtime,
  now: Date = new Date(),
): void {
  const value = JSON.stringify({
    showtimeId: showtime.id,
    showtimeDateTime: showtime.dateTime,
    selectedAt: now.toISOString(),
  } satisfies FieldShowtimeSelection);
  if (writeStorage('localStorage', userId, value)) {
    removeStorage('sessionStorage', userId);
    return;
  }
  writeStorage('sessionStorage', userId, value);
}

export function clearFieldShowtimeSelection(userId: string): void {
  removeStorage('localStorage', userId);
  removeStorage('sessionStorage', userId);
}

export function readFieldShowtimeSelection(userId: string): FieldShowtimeSelection | null {
  return parseSelection(readStorage('localStorage', userId))
    ?? parseSelection(readStorage('sessionStorage', userId));
}

/**
 * Returns the stored showtime only when every check passes: the choice is at
 * most 12 hours old, the showtime is still in the server list with the same
 * start time, and it starts today in KST, starts within the next 12 hours, or
 * started at most 6 hours ago. The window is asymmetric so that last night's
 * show is not restored in a tab opened the next morning.
 */
export function resolveRestorableFieldShowtime<T extends SelectableShowtime>(
  selection: FieldShowtimeSelection | null,
  showtimes: readonly T[],
  now: Date = new Date(),
): T | null {
  if (!selection) return null;
  const selectedAt = Date.parse(selection.selectedAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(selectedAt)) return null;
  if (selectedAt > nowMs + CLOCK_SKEW_MS || nowMs - selectedAt > FIELD_SHOWTIME_SELECTION_TTL_MS) return null;

  const showtime = showtimes.find((candidate) => candidate.id === selection.showtimeId);
  if (!showtime) return null;
  const startsAt = Date.parse(showtime.dateTime);
  if (!Number.isFinite(startsAt) || startsAt !== Date.parse(selection.showtimeDateTime)) return null;

  const sameKstDay = formatAdminKstDate(new Date(startsAt).toISOString())
    === formatAdminKstDate(now.toISOString());
  const nearNow = startsAt >= nowMs - FIELD_SHOWTIME_RESTORE_PAST_MS
    && startsAt <= nowMs + FIELD_SHOWTIME_RESTORE_AHEAD_MS;
  return sameKstDay || nearNow ? showtime : null;
}

function parseSelection(raw: string | null): FieldShowtimeSelection | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<FieldShowtimeSelection> | null;
    if (
      !value || typeof value.showtimeId !== 'string' || !value.showtimeId
      || typeof value.showtimeDateTime !== 'string' || typeof value.selectedAt !== 'string'
    ) {
      return null;
    }
    return { showtimeId: value.showtimeId, showtimeDateTime: value.showtimeDateTime, selectedAt: value.selectedAt };
  } catch {
    return null;
  }
}

type StorageName = 'localStorage' | 'sessionStorage';

function getStorage(name: StorageName): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window[name];
  } catch {
    return null;
  }
}

function readStorage(name: StorageName, userId: string): string | null {
  try {
    return getStorage(name)?.getItem(fieldShowtimeSelectionKey(userId)) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(name: StorageName, userId: string, value: string): boolean {
  const storage = getStorage(name);
  if (!storage) return false;
  try {
    storage.setItem(fieldShowtimeSelectionKey(userId), value);
    return true;
  } catch {
    return false;
  }
}

function removeStorage(name: StorageName, userId: string): void {
  try {
    getStorage(name)?.removeItem(fieldShowtimeSelectionKey(userId));
  } catch {
    // Storage may be blocked; nothing to clean up.
  }
}
