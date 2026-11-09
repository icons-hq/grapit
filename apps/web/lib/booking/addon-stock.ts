import type { BookingAddonSnapshot, BookingAddonStockUpdate } from '@grabit/shared';

/** Keep private choices local and never let an older cross-instance event rewind counters. */
export function applyAddonStock(snapshot: BookingAddonSnapshot | undefined, update: BookingAddonStockUpdate) {
  if (!snapshot || snapshot.showtimeId !== update.showtimeId || (snapshot.revision ?? 0) >= update.revision) return snapshot;
  return { ...snapshot, revision: update.revision, generatedAt: update.generatedAt, nextExpiryAt: update.nextExpiryAt,
    addons: snapshot.addons.map((addon) => {
      const stock = update.stocks.find((s) => s.id === addon.id);
      return stock ? { ...addon, ...stock } : addon;
    }) };
}

/** A slow GET/mutation may finish after a newer broadcast; its private choices are still authoritative. */
export function preserveNewerAddonStock(fresh: BookingAddonSnapshot, cached: BookingAddonSnapshot | undefined): BookingAddonSnapshot {
  if (!cached?.revision) return fresh;
  return applyAddonStock(fresh, { showtimeId: cached.showtimeId, revision: cached.revision,
    generatedAt: cached.generatedAt, nextExpiryAt: cached.nextExpiryAt,
    stocks: cached.addons.map(({ id, available, held, sold, capacity, active }) => ({ id, available, held, sold, capacity, active })) })!;
}
