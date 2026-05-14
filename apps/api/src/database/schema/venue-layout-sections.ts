import {
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { venueLayoutFloors } from './venue-layout-floors.js';

export const venueLayoutSections = pgTable('venue_layout_sections', {
  id: uuid('id').defaultRandom().primaryKey(),
  floorId: uuid('floor_id')
    .notNull()
    .references(() => venueLayoutFloors.id, { onDelete: 'cascade' }),
  sectionKey: varchar('section_key', { length: 80 }).notNull(),
  sectionLabel: varchar('section_label', { length: 100 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_venue_layout_sections_floor_section').on(
    table.floorId,
    table.sectionKey,
  ),
  index('idx_venue_layout_sections_floor_sort').on(
    table.floorId,
    table.sortOrder,
  ),
]);
