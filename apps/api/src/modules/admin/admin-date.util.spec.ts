import { describe, expect, it } from 'vitest';

import { parseAdminKstDateTime } from './admin-date.util.js';

describe('admin date parsing', () => {
  it('treats timezone-less admin datetime input as KST wall time', () => {
    expect(parseAdminKstDateTime('2026-07-18T14:00:00').toISOString()).toBe(
      '2026-07-18T05:00:00.000Z',
    );
  });

  it('keeps explicit UTC instants unchanged', () => {
    expect(parseAdminKstDateTime('2026-07-18T05:00:00.000Z').toISOString()).toBe(
      '2026-07-18T05:00:00.000Z',
    );
  });

  it('supports timezone-less admin datetime values with milliseconds', () => {
    expect(parseAdminKstDateTime('2026-07-18T14:00:00.000').toISOString()).toBe(
      '2026-07-18T05:00:00.000Z',
    );
  });
});
