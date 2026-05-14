import { pgTable, uuid, varchar, integer, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { performances } from './performances.js';
import { venueLayouts } from './venue-layouts.js';

export const seatMaps = pgTable('seat_maps', {
  id: uuid('id').defaultRandom().primaryKey(),
  performanceId: uuid('performance_id').notNull().references(() => performances.id, { onDelete: 'cascade' }),
  venueLayoutId: uuid('venue_layout_id').references(() => venueLayouts.id, { onDelete: 'set null' }),
  floorKey: varchar('floor_key', { length: 20 }).notNull().default('1F'),
  floorLabel: varchar('floor_label', { length: 100 }).notNull().default('1층'),
  sortOrder: integer('sort_order').notNull().default(0),
  svgUrl: varchar('svg_url', { length: 1000 }).notNull(),
  seatConfig: jsonb('seat_config'),
  totalSeats: integer('total_seats').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_seat_maps_performance_floor_key').on(
    table.performanceId,
    table.floorKey,
  ),
  index('idx_seat_maps_venue_layout_id').on(table.venueLayoutId),
]);
