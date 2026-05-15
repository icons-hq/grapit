import {
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { venueLayouts } from './venue-layouts.js';

export const venueLayoutFloors = pgTable('venue_layout_floors', {
  id: uuid('id').defaultRandom().primaryKey(),
  layoutId: uuid('layout_id')
    .notNull()
    .references(() => venueLayouts.id, { onDelete: 'cascade' }),
  floorKey: varchar('floor_key', { length: 20 }).notNull(),
  floorLabel: varchar('floor_label', { length: 100 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  svgUrl: varchar('svg_url', { length: 1000 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_venue_layout_floors_layout_floor').on(
    table.layoutId,
    table.floorKey,
  ),
  index('idx_venue_layout_floors_layout_sort').on(
    table.layoutId,
    table.sortOrder,
  ),
]);
