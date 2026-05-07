import { describe, expect, it } from 'vitest';

import { formatAdminKstDate, formatAdminKstDateTime } from './admin-datetime';

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
});
