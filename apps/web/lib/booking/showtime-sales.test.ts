import { describe, expect, it } from 'vitest';
import {
  SHOWTIME_SALES_CLOSED_MESSAGE,
  filterBookableShowtimes,
  getCutoffTimerDelay,
  getNextShowtimeCutoffAt,
  isShowtimeSalesClosed,
  isShowtimeSalesClosedError,
} from './showtime-sales';

const START = '2026-10-10T10:00:00.000Z';
const START_MS = Date.parse(START);

describe('showtime sales cutoff (audit #2, contract C1)', () => {
  it('closes sales exactly at the scheduled start time', () => {
    expect(isShowtimeSalesClosed(START, START_MS - 1)).toBe(false);
    expect(isShowtimeSalesClosed(START, START_MS)).toBe(true);
    expect(isShowtimeSalesClosed(START, START_MS + 1)).toBe(true);
  });

  it('leaves an unparseable start time to the server', () => {
    expect(isShowtimeSalesClosed('not-a-date', START_MS)).toBe(false);
  });

  it('filters started showtimes and finds the next cutoff', () => {
    const showtimes = [
      { id: 'past', dateTime: '2026-10-09T10:00:00.000Z' },
      { id: 'now', dateTime: START },
      { id: 'later', dateTime: '2026-10-11T10:00:00.000Z' },
      { id: 'soon', dateTime: '2026-10-10T12:00:00.000Z' },
    ];

    expect(filterBookableShowtimes(showtimes, START_MS).map((showtime) => showtime.id)).toEqual(['later', 'soon']);
    expect(getNextShowtimeCutoffAt(showtimes, START_MS)).toBe(Date.parse('2026-10-10T12:00:00.000Z'));
    expect(getNextShowtimeCutoffAt([{ dateTime: '2026-10-09T10:00:00.000Z' }], START_MS)).toBeNull();
  });

  it('clamps the cutoff timer to the setTimeout range', () => {
    expect(getCutoffTimerDelay(START_MS + 5_000, START_MS)).toBe(5_000);
    expect(getCutoffTimerDelay(START_MS - 5_000, START_MS)).toBe(0);
    expect(getCutoffTimerDelay(START_MS + 60 * 24 * 60 * 60 * 1000, START_MS)).toBe(2_147_483_647);
  });

  it('recognizes the server cutoff rejection by status and message', () => {
    expect(isShowtimeSalesClosedError({ statusCode: 403, message: SHOWTIME_SALES_CLOSED_MESSAGE })).toBe(true);
    expect(isShowtimeSalesClosedError({ statusCode: 403, message: '대기열 입장 정보가 현재 공연과 일치하지 않습니다' })).toBe(false);
    expect(isShowtimeSalesClosedError({ statusCode: 409, message: SHOWTIME_SALES_CLOSED_MESSAGE })).toBe(false);
    expect(isShowtimeSalesClosedError(null)).toBe(false);
  });
});
