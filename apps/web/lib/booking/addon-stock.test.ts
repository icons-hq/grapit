import { describe, expect, it } from 'vitest';
import type { BookingAddonSnapshot, BookingAddonStockUpdate } from '@grabit/shared';
import { applyAddonStock, preserveNewerAddonStock } from './addon-stock';

const initial = { showtimeId: 'show', revision: 1, generatedAt: '2026-11-09T00:00:00.000Z', nextExpiryAt: null,
  addons: [{ id: 'photo', available: 58, held: 0, sold: 0, capacity: 58, active: true }],
  selections: [{ addonId: 'photo', seatKey: '1F:A-1', price: 150000 }] } as BookingAddonSnapshot;
const update: BookingAddonStockUpdate = { showtimeId: 'show', revision: 3, generatedAt: '2026-11-09T00:00:01.000Z', nextExpiryAt: null,
  stocks: [{ id: 'photo', available: 57, held: 1, sold: 0, capacity: 58, active: true }] };

describe('limited stock event ordering', () => {
  it('preserves private selections and rejects out-of-order or unrelated events', () => {
    const latest = applyAddonStock(initial, update)!;
    expect(latest.addons[0]?.available).toBe(57);
    expect(latest.selections).toBe(initial.selections);
    expect(applyAddonStock(latest, { ...update, revision: 2 })).toBe(latest);
    expect(applyAddonStock(latest, { ...update, showtimeId: 'another-show', revision: 4 })).toBe(latest);
    expect(applyAddonStock(undefined, update)).toBeUndefined();
  });
  it('keeps a newer broadcast when a slow GET arrives, while taking the fresh private selections', () => {
    const latest = applyAddonStock(initial, update)!;
    const result = preserveNewerAddonStock({ ...initial, revision: 2, selections: [] }, latest);
    expect(result.addons[0]?.available).toBe(57);
    expect(result.revision).toBe(3);
    expect(result.selections).toEqual([]);
  });
});
