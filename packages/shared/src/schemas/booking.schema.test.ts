import { describe, expect, it } from 'vitest';

import { prepareReservationSchema } from './booking.schema';
import {
  REQUIRED_CONSENT_ITEM_KEYS,
  type ConsentItemKey,
} from './consent.schema';

function makeBookingConsentItems(
  overrides: Partial<Record<ConsentItemKey, boolean>> = {},
) {
  return REQUIRED_CONSENT_ITEM_KEYS.map((key) => ({
    key,
    version: '2026-04-28',
    language: 'ko',
    accepted: overrides[key] ?? true,
    sourceFlow: 'booking' as const,
  }));
}

describe('prepareReservationSchema booking consent contract', () => {
  it('requires itemized booking consent rows before reservation prepare', () => {
    expect(() =>
      prepareReservationSchema.parse({
        orderId: 'GRP-NO-CONSENT',
        showtimeId: '11111111-1111-4111-8111-111111111111',
        seats: [{ seatId: 'A-1', tierName: 'VIP', price: 50000, row: 'A', number: '1' }],
        amount: 50000,
      }),
    ).toThrow(/예매 동의 항목/);
  });

  it('accepts booking consent rows tagged with sourceFlow=booking', () => {
    const parsed = prepareReservationSchema.parse({
      orderId: 'GRP-CONSENT',
      showtimeId: '11111111-1111-4111-8111-111111111111',
      seats: [{ seatId: 'A-1', tierName: 'VIP', price: 50000, row: 'A', number: '1' }],
      amount: 50000,
      consentItems: makeBookingConsentItems(),
    });

    expect(parsed.consentItems.map((item) => item.sourceFlow)).toEqual(
      REQUIRED_CONSENT_ITEM_KEYS.map(() => 'booking'),
    );
  });
});
