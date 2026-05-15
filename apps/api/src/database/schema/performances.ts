import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  pgEnum,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { venues } from './venues.js';

export const genreEnum = pgEnum('genre', [
  'musical', 'concert', 'play', 'exhibition',
  'classic', 'sports', 'kids_family', 'leisure_camping',
  'artist_celebrity', 'ip_popup',
]);

export const performanceStatusEnum = pgEnum('performance_status', [
  'upcoming', 'selling', 'closing_soon', 'ended',
]);

export const performancePublishStateEnum = pgEnum('performance_publish_state', [
  'draft', 'review', 'publish_ready', 'published',
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
  detailImages: jsonb('detail_images').notNull().default(sql`'[]'::jsonb`),
  publishState: performancePublishStateEnum('publish_state')
    .notNull()
    .default('draft'),
  publishReviewRequestedAt: timestamp('publish_review_requested_at', {
    withTimezone: true,
  }),
  publishReadyAt: timestamp('publish_ready_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedByUserId: uuid('published_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  salesInfo: text('sales_info'),
  viewCount: integer('view_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_performances_genre').on(table.genre),
  index('idx_performances_status').on(table.status),
  index('idx_performances_publish_state').on(table.publishState),
  index('idx_performances_title_trgm').using(
    'gin',
    sql`${table.title} gin_trgm_ops`,
  ),
]);

// Note: search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, ''))) STORED
// is added via custom SQL in the migration since Drizzle doesn't support tsvector natively.
