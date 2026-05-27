import { describe, expect, it } from 'vitest';

import {
  buildFieldCheckInUrl,
  normalizeFieldCheckInOutcome,
  parseFieldCheckInToken,
} from './field-check-in-ingress';

describe('field check-in ingress helpers', () => {
  it('builds buyer QR URLs with the ticket query parameter', () => {
    expect(
      buildFieldCheckInUrl('opaque-ticket-token', 'https://heygrabit.com'),
    ).toBe('https://heygrabit.com/field/check-in?ticket=opaque-ticket-token');
  });

  it('parses direct tokens and QR URLs using ticket or legacy token parameters', () => {
    expect(parseFieldCheckInToken({ token: ' direct-token ' })).toBe('direct-token');
    expect(
      parseFieldCheckInToken({
        qrUrl: 'https://heygrabit.com/field/check-in?ticket=from-ticket',
      }),
    ).toBe('from-ticket');
    expect(
      parseFieldCheckInToken({
        qrUrl: 'https://heygrabit.com/field/check-in?token=from-token',
      }),
    ).toBe('from-token');
  });

  it('returns an empty token for malformed or empty ingress', () => {
    expect(parseFieldCheckInToken({})).toBe('');
    expect(parseFieldCheckInToken({ qrUrl: 'not a url' })).toBe('');
  });

  it('normalizes UI aliases to server field check-in outcomes', () => {
    expect(normalizeFieldCheckInOutcome('processed')).toBe('entered');
    expect(normalizeFieldCheckInOutcome('refunded')).toBe('refunded_cancelled');
    expect(normalizeFieldCheckInOutcome('wrong-showtime')).toBe('wrong_showtime');
    expect(normalizeFieldCheckInOutcome('offline-pending')).toBe('offline_pending');
    expect(normalizeFieldCheckInOutcome('processable')).toBe('processable');
    expect(normalizeFieldCheckInOutcome('unknown')).toBeNull();
  });
});
