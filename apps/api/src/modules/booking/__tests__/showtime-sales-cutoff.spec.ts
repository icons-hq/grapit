import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  SHOWTIME_STARTED_MESSAGE,
  assertShowtimeSalesOpen,
  isShowtimeSalesClosed,
} from '../showtime-sales-cutoff.js';

describe('showtime sales cutoff', () => {
  const startsAt = new Date('2026-10-05T10:00:00.000Z');

  it('keeps sales open until the scheduled start', () => {
    expect(isShowtimeSalesClosed(startsAt, new Date('2026-10-05T09:59:59.999Z'))).toBe(false);
    expect(() => assertShowtimeSalesOpen(startsAt, new Date('2026-10-05T09:59:59.999Z'))).not.toThrow();
  });

  it('closes sales at and after the scheduled start', () => {
    expect(isShowtimeSalesClosed(startsAt, startsAt)).toBe(true);
    expect(isShowtimeSalesClosed(startsAt, new Date('2026-10-06T00:00:00.000Z'))).toBe(true);
    expect(() => assertShowtimeSalesOpen(startsAt, startsAt)).toThrow(ForbiddenException);
    expect(() => assertShowtimeSalesOpen(startsAt, startsAt)).toThrow(SHOWTIME_STARTED_MESSAGE);
  });

  it('accepts ISO strings and treats an unreadable start time as closed', () => {
    expect(isShowtimeSalesClosed('2026-10-05T10:00:00.000Z', new Date('2026-10-05T09:00:00.000Z'))).toBe(false);
    expect(isShowtimeSalesClosed('not-a-date', new Date('2026-10-05T09:00:00.000Z'))).toBe(true);
    expect(isShowtimeSalesClosed(null)).toBe(true);
    expect(isShowtimeSalesClosed(undefined)).toBe(true);
  });

  it('uses the contract message', () => {
    expect(SHOWTIME_STARTED_MESSAGE).toBe('이미 시작된 회차는 예매할 수 없습니다.');
  });
});
