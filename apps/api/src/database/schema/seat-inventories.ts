import { pgTable, uuid, varchar, timestamp, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core';
import { showtimes } from './showtimes.js';

export const seatStatusEnum = pgEnum('seat_status', [
  'available',
  'locked',
  'held_cancelled',
  'sold',
]);

export const seatInventories = pgTable('seat_inventories', {
  id: uuid('id').defaultRandom().primaryKey(),
  showtimeId: uuid('showtime_id').notNull().references(() => showtimes.id, { onDelete: 'cascade' }),
  seatId: varchar('seat_id', { length: 20 }).notNull(),
  floorKey: varchar('floor_key', { length: 20 }).notNull().default('1F'),
  seatKey: varchar('seat_key', { length: 80 }),
  status: seatStatusEnum('status').notNull().default('available'),
  lockedBy: uuid('locked_by'),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  reopenHoldUntil: timestamp('reopen_hold_until', { withTimezone: true }),
  reopenJobId: varchar('reopen_job_id', { length: 200 }),
  heldCancelledAt: timestamp('held_cancelled_at', { withTimezone: true }),
  soldAt: timestamp('sold_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_seat_inv_showtime_floor_seat_key').on(
    table.showtimeId,
    table.floorKey,
    table.seatKey,
  ),
]);
