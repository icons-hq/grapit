import { describe, expect, it } from 'vitest';

import { formatAdminKstDate, formatAdminKstDateTime, parseAdminKstDateTimeInput } from './admin-datetime';

describe('admin datetime formatting', () => {
  it('formats persisted UTC showtime instants as KST admin input values', () => {
    expect(formatAdminKstDateTime('2026-07-18T05:00:00.000Z')).toBe(
      '2026-07-18T14:00:00',
    );
  });

  it('keeps timezone-less admin input values unchanged', () => {
    expect(formatAdminKstDateTime('2026-07-18T14:00:00')).toBe(
      '2026-07-18T14:00:00',
    );
  });

  it('formats persisted UTC dates as KST calendar dates', () => {
    expect(formatAdminKstDate('2026-07-17T15:00:00.000Z')).toBe('2026-07-18');
  });

  it('keeps a mistyped early year representable as a datetime-local value', () => {
    // Intl Asia/Seoul produced '2-10-01T19:27:52' (unpadded year, local mean time),
    // which a datetime-local input rejects and renders empty.
    expect(formatAdminKstDateTime('0002-10-01T11:00:00.000Z')).toBe('0002-10-01T20:00:00');
    expect(formatAdminKstDateTime('0202-10-01T11:00:00.000Z')).toBe('0202-10-01T20:00:00');
    expect(formatAdminKstDate('0202-10-01T11:00:00.000Z')).toBe('0202-10-01');
  });
});

describe('parseAdminKstDateTimeInput', () => {
  const range = { min: 2000, max: 2100 };

  it('converts a complete KST datetime-local value to a UTC instant', () => {
    expect(parseAdminKstDateTimeInput('2026-10-01T20:00', range)).toBe('2026-10-01T11:00:00.000Z');
    expect(parseAdminKstDateTimeInput('2099-11-01T12:00:30', range)).toBe('2099-11-01T03:00:30.000Z');
  });

  it('rejects intermediate years emitted while a year is typed digit by digit', () => {
    for (const value of ['0002-10-01T20:00:00', '0020-10-01T20:00:00', '0202-10-01T20:00:00', '20266-10-01T20:00']) {
      expect(parseAdminKstDateTimeInput(value, range)).toBeNull();
    }
    expect(parseAdminKstDateTimeInput('', range)).toBeNull();
  });
});
