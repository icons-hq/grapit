import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FIELD_SHOWTIME_SELECTION_TTL_MS,
  clearFieldShowtimeSelection,
  fieldShowtimeSelectionKey,
  readFieldShowtimeSelection,
  resolveRestorableFieldShowtime,
  saveFieldShowtimeSelection,
} from '../showtime-selection';

const USER_ID = 'scanner-user-1';
// 2026-10-03 18:00 KST
const NOW = new Date('2026-10-03T09:00:00.000Z');
const EVENING = { id: 'showtime-evening', dateTime: '2026-10-03T10:00:00.000Z', title: '저녁 회차' };
const MATINEE = { id: 'showtime-matinee', dateTime: '2026-10-03T05:00:00.000Z', title: '낮 회차' };

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('field showtime selection persistence', () => {
  it('stores the choice in localStorage so a camera-opened tab can read it', () => {
    saveFieldShowtimeSelection(USER_ID, EVENING, NOW);

    // A tab opened by the OS camera starts with an empty sessionStorage.
    sessionStorage.clear();
    expect(readFieldShowtimeSelection(USER_ID)).toEqual({
      showtimeId: EVENING.id,
      showtimeDateTime: EVENING.dateTime,
      selectedAt: NOW.toISOString(),
    });
    expect(localStorage.getItem(fieldShowtimeSelectionKey(USER_ID))).not.toBeNull();
  });

  it('falls back to sessionStorage only when localStorage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    saveFieldShowtimeSelection(USER_ID, EVENING, NOW);

    expect(localStorage.getItem(fieldShowtimeSelectionKey(USER_ID))).toBeNull();
    expect(sessionStorage.getItem(fieldShowtimeSelectionKey(USER_ID))).not.toBeNull();
    expect(readFieldShowtimeSelection(USER_ID)?.showtimeId).toBe(EVENING.id);
  });

  it('keeps choices separate per scanner account and clears both storages', () => {
    saveFieldShowtimeSelection(USER_ID, EVENING, NOW);
    expect(readFieldShowtimeSelection('other-scanner')).toBeNull();
    clearFieldShowtimeSelection(USER_ID);
    expect(readFieldShowtimeSelection(USER_ID)).toBeNull();
  });

  it('ignores malformed or legacy plain-id values', () => {
    sessionStorage.setItem(fieldShowtimeSelectionKey(USER_ID), EVENING.id);
    localStorage.setItem(fieldShowtimeSelectionKey(USER_ID), '{broken');
    expect(readFieldShowtimeSelection(USER_ID)).toBeNull();
  });
});

describe('resolveRestorableFieldShowtime', () => {
  const selection = (overrides: Partial<{ showtimeId: string; showtimeDateTime: string; selectedAt: string }> = {}) => ({
    showtimeId: EVENING.id,
    showtimeDateTime: EVENING.dateTime,
    selectedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    ...overrides,
  });

  it('restores a fresh choice that is still in the showtime list', () => {
    expect(resolveRestorableFieldShowtime(selection(), [MATINEE, EVENING], NOW)).toBe(EVENING);
  });

  it('rejects a choice older than the 12 hour TTL', () => {
    const stale = selection({ selectedAt: new Date(NOW.getTime() - FIELD_SHOWTIME_SELECTION_TTL_MS - 1).toISOString() });
    expect(resolveRestorableFieldShowtime(stale, [EVENING], NOW)).toBeNull();
  });

  it('rejects a showtime missing from the list or rescheduled since it was chosen', () => {
    expect(resolveRestorableFieldShowtime(selection(), [MATINEE], NOW)).toBeNull();
    const moved = { ...EVENING, dateTime: '2026-10-03T11:00:00.000Z' };
    expect(resolveRestorableFieldShowtime(selection(), [moved], NOW)).toBeNull();
  });

  it('rejects a showtime that is neither today in KST nor within 12 hours', () => {
    const nextWeek = { id: 'next-week', dateTime: '2026-10-10T10:00:00.000Z' };
    expect(resolveRestorableFieldShowtime(
      selection({ showtimeId: nextWeek.id, showtimeDateTime: nextWeek.dateTime }), [nextWeek], NOW,
    )).toBeNull();
  });

  it('restores a show that crosses midnight KST while still near now', () => {
    // 2026-10-04 00:30 KST, restored at 2026-10-03 23:40 KST.
    const lateNight = { id: 'late-night', dateTime: '2026-10-03T15:30:00.000Z' };
    const now = new Date('2026-10-03T14:40:00.000Z');
    expect(resolveRestorableFieldShowtime(
      { showtimeId: lateNight.id, showtimeDateTime: lateNight.dateTime, selectedAt: '2026-10-03T13:00:00.000Z' },
      [lateNight],
      now,
    )).toBe(lateNight);
  });

  it('does not restore last night\'s show in a tab opened the next morning', () => {
    // Chosen 2026-10-02 19:30 KST for the 20:00 KST show, camera tab opened 2026-10-03 07:00 KST:
    // the choice is still inside its 12 hour TTL and the show started 11 hours ago.
    const lastNight = { id: 'last-night', dateTime: '2026-10-02T11:00:00.000Z' };
    const nextMorning = new Date('2026-10-02T22:00:00.000Z');
    expect(resolveRestorableFieldShowtime(
      { showtimeId: lastNight.id, showtimeDateTime: lastNight.dateTime, selectedAt: '2026-10-02T10:30:00.000Z' },
      [lastNight],
      nextMorning,
    )).toBeNull();
  });

  it('keeps a show that started before midnight KST for six hours after its start', () => {
    // 2026-10-02 23:00 KST show, restored the next KST day.
    const late = { id: 'late', dateTime: '2026-10-02T14:00:00.000Z' };
    const selection = { showtimeId: late.id, showtimeDateTime: late.dateTime, selectedAt: '2026-10-02T13:30:00.000Z' };
    expect(resolveRestorableFieldShowtime(selection, [late], new Date('2026-10-02T19:59:00.000Z'))).toBe(late);
    expect(resolveRestorableFieldShowtime(selection, [late], new Date('2026-10-02T20:01:00.000Z'))).toBeNull();
  });

  it('rejects a choice whose selectedAt is in the future', () => {
    expect(resolveRestorableFieldShowtime(
      selection({ selectedAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString() }), [EVENING], NOW,
    )).toBeNull();
  });
});
