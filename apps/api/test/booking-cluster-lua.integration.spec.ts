import { beforeAll, describe, expect, it } from 'vitest';

/**
 * RED gate for Phase 20 Plan 03.
 *
 * The booking cluster Lua guard is intentionally failing until the Valkey
 * Cluster testcontainers harness and BookingService scenarios are implemented.
 */
describe('BookingService Lua scripts — Valkey Cluster mode', () => {
  beforeAll(async () => {
    throw new Error('booking cluster Lua guard not implemented yet');
  });

  it('runs lock/status/unlock and ownership helpers under cluster mode', () => {
    expect(true).toBe(true);
  });
});
