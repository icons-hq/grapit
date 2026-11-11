import { describe, expect, it } from 'vitest';
import { signupMonitoringQuerySchema } from '@grabit/shared';
import { signupMonitoringWindow } from './signup-monitoring.js';

describe('signup monitoring bounds', () => {
  const now = new Date('2026-11-11T06:23:45.000Z');
  it('compares the elapsed KST day with an exactly equal preceding window', () => {
    const window = signupMonitoringWindow({ period: 'today' }, now);
    expect(window.since.toISOString()).toBe('2026-11-10T15:00:00.000Z');
    expect(window.previousSince.toISOString()).toBe('2026-11-09T23:36:15.000Z');
    expect(window.until.getTime() - window.since.getTime()).toBe(window.since.getTime() - window.previousSince.getTime());
  });
  it('keeps an exact announcement instant and handles the KST midnight rollover', () => {
    expect(signupMonitoringWindow({ period: 'announcement', since: '2026-11-11T14:03:27+09:00' }, now).since.toISOString()).toBe('2026-11-11T05:03:27.000Z');
    expect(signupMonitoringWindow({ period: 'today' }, new Date('2026-11-11T15:00:00Z')).since.toISOString()).toBe('2026-11-11T15:00:00.000Z');
  });
  it.each([['24h', 24], ['7d', 168]] as const)('uses elapsed hours for %s', (period, hours) => {
    const window = signupMonitoringWindow({ period }, now);
    expect(window.until.getTime() - window.since.getTime()).toBe(hours * 3_600_000);
  });
  it('rejects missing offsets, unknown params, future and unbounded windows', () => {
    expect(signupMonitoringQuerySchema.safeParse({ period: 'announcement' }).success).toBe(false);
    expect(signupMonitoringQuerySchema.safeParse({ period: 'announcement', since: '2026-11-11T14:00' }).success).toBe(false);
    expect(signupMonitoringQuerySchema.safeParse({ period: 'all' }).success).toBe(false);
    expect(signupMonitoringQuerySchema.safeParse({ period: 'today', email: 'hidden@example.com' }).success).toBe(false);
    for (const since of ['2027-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 'invalid']) {
      expect(() => signupMonitoringWindow({ period: 'announcement', since }, now)).toThrow();
    }
  });
});
