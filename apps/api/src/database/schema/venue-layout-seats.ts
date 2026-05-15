import {
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { venueLayouts } from './venue-layouts.js';
import { venueLayoutFloors } from './venue-layout-floors.js';
import { venueLayoutSections } from './venue-layout-sections.js';

export const venueLayoutSeats = pgTable('venue_layout_seats', {
  id: uuid('id').defaultRandom().primaryKey(),
  layoutId: uuid('layout_id')
    .notNull()
    .references(() => venueLayouts.id, { onDelete: 'cascade' }),
  floorId: uuid('floor_id')
    .notNull()
    .references(() => venueLayoutFloors.id, { onDelete: 'cascade' }),
  sectionId: uuid('section_id').references(() => venueLayoutSections.id, {
    onDelete: 'set null',
  }),
  seatKey: varchar('seat_key', { length: 120 }).notNull(),
  sourceSeatId: varchar('source_seat_id', { length: 120 }).notNull(),
  rowLabel: varchar('row_label', { length: 50 }),
  seatNumber: varchar('seat_number', { length: 50 }),
  x: integer('x'),
  y: integer('y'),
  isAccessible: boolean('is_accessible').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_venue_layout_seats_layout_seat_key').on(
    table.layoutId,
    table.seatKey,
  ),
  index('idx_venue_layout_seats_floor_sort').on(table.floorId, table.sortOrder),
  index('idx_venue_layout_seats_source_seat_id').on(table.sourceSeatId),
]);
