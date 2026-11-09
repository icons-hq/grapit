import { describe, expect, it } from 'vitest';
import { bookingAddonDefinitionSchema, bookingAddonSelectionsSchema } from './booking-addon.schema';

const addonId = '00000000-0000-4000-8000-000000000001';
const copy = Object.fromEntries(['ko', 'en', 'zh-CN', 'th'].map((locale) => [locale, { name: 'Hi-touch', description: 'Paid benefit' }]));

describe('paid add-on quantities', () => {
  it('accepts distinct unit slots on a ticket but rejects duplicate slots, including the legacy default', () => {
    expect(bookingAddonSelectionsSchema.safeParse([{ addonId, seatKey: '1F:A-1', unitIndex: 1 }, { addonId, seatKey: '1F:A-1', unitIndex: 2 }]).success).toBe(true);
    expect(bookingAddonSelectionsSchema.safeParse([{ addonId, seatKey: '1F:A-1' }, { addonId, seatKey: '1F:A-1', unitIndex: 1 }]).success).toBe(false);
  });
  it.each([0, -1, 1.5, 11])('rejects invalid unit index %s', (unitIndex) => {
    expect(bookingAddonSelectionsSchema.safeParse([{ addonId, seatKey: '1F:A-1', unitIndex }]).success).toBe(false);
  });
  it('accepts a per-ticket limit and preserves legacy definitions', () => {
    const definition = { identity: 'hi-touch', displayCopy: copy, price: 80000, capacity: 430, eligibleTierNames: ['SVIP', 'VIP'] };
    expect(bookingAddonDefinitionSchema.safeParse({ ...definition, maxPerTicket: 2 }).success).toBe(true);
    expect(bookingAddonDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(bookingAddonDefinitionSchema.safeParse({ ...definition, maxPerTicket: 0 }).success).toBe(false);
  });
});
