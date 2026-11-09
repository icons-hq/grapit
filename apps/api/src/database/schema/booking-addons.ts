import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import type { BookingAddonDefinition } from '@grabit/shared';
import { showtimes } from './showtimes.js';
import { users } from './users.js';
import { reservations } from './reservations.js';

export const bookingAddons = pgTable('booking_addons', {
  id: uuid('id').defaultRandom().primaryKey(),
  showtimeId: uuid('showtime_id').notNull().references(() => showtimes.id),
  identity: varchar('identity', { length: 80 }).notNull(),
  displayCopy: jsonb('display_copy').$type<BookingAddonDefinition['displayCopy']>().notNull(),
  price: integer('price').notNull(),
  capacity: integer('capacity').notNull(),
  maxPerTicket: integer('max_per_ticket').notNull().default(1),
  eligibleTierNames: jsonb('eligible_tier_names').$type<string[]>().notNull(),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('booking_addons_showtime_identity').on(t.showtimeId, t.identity),
  check('booking_addons_positive', sql`${t.price} > 0 AND ${t.capacity} > 0`),
  check('booking_addons_max_per_ticket', sql`${t.maxPerTicket} BETWEEN 1 AND 10`),
]);

/** One independently redeemable unit per seat/product/slot. Bound allocations remain evidence. */
export const bookingAddonHolds = pgTable('booking_addon_holds', {
  id: uuid('id').defaultRandom().primaryKey(),
  addonId: uuid('addon_id').notNull().references(() => bookingAddons.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  seatKey: varchar('seat_key', { length: 120 }).notNull(),
  unitIndex: integer('unit_index').notNull().default(1),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  reservationId: uuid('reservation_id').references(() => reservations.id),
  price: integer('price').notNull(),
  displayCopy: jsonb('display_copy').$type<BookingAddonDefinition['displayCopy']>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('booking_addon_open_hold').on(t.addonId, t.userId, t.seatKey, t.unitIndex).where(sql`${t.reservationId} IS NULL`),
  uniqueIndex('booking_addon_order_item').on(t.reservationId, t.addonId, t.seatKey, t.unitIndex),
  index('booking_addon_hold_capacity').on(t.addonId, t.expiresAt),
  index('booking_addon_hold_owner').on(t.userId, t.reservationId),
  check('booking_addon_hold_positive_price', sql`${t.price} > 0`),
  check('booking_addon_hold_unit_index', sql`${t.unitIndex} BETWEEN 1 AND 10`),
]);
