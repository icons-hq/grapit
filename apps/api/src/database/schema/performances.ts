import { pgTable, uuid, varchar, text, integer, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { venues } from './venues.js';

export const genreEnum = pgEnum('genre', [
  'musical', 'concert', 'play', 'exhibition',
  'classic', 'sports', 'kids_family', 'leisure_camping',
  'artist_celebrity', 'ip_popup',
]);

export const performanceStatusEnum = pgEnum('performance_status', [
  'upcoming', 'selling', 'closing_soon', 'ended',
]);

export const performances = pgTable('performances', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  genre: genreEnum('genre').notNull(),
  subcategory: varchar('subcategory', { length: 100 }),
  venueId: uuid('venue_id').references(() => venues.id),
  posterUrl: varchar('poster_url', { length: 1000 }),
  description: text('description'),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  runtime: varchar('runtime', { length: 50 }),
  ageRating: varchar('age_rating', { length: 50 }).notNull(),
  status: performanceStatusEnum('status').notNull().default('upcoming'),
  salesInfo: text('sales_info'),
  viewCount: integer('view_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_performances_genre').on(table.genre),
  index('idx_performances_status').on(table.status),
  index('idx_performances_title_trgm').using('gin', sql`${table.title} gin_trgm_ops`),
]);

// Note: search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, ''))) STORED
// is added via custom SQL in the migration since Drizzle doesn't support tsvector natively.
