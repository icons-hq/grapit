import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { venues } from './venues.js';

export const venueLayouts = pgTable('venue_layouts', {
  id: uuid('id').defaultRandom().primaryKey(),
  venueId: uuid('venue_id')
    .notNull()
    .references(() => venues.id, { onDelete: 'cascade' }),
  layoutName: varchar('layout_name', { length: 255 }).notNull(),
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(false),
  sourceSvgUrl: varchar('source_svg_url', { length: 1000 }),
  normalizedSvgUrl: varchar('normalized_svg_url', { length: 1000 }),
  stagePosition: varchar('stage_position', { length: 20 }).notNull().default('top'),
  viewport: jsonb('viewport'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_venue_layouts_venue_name_version').on(
    table.venueId,
    table.layoutName,
    table.version,
  ),
  index('idx_venue_layouts_venue_active').on(table.venueId, table.isActive),
]);
