import { pgTable, uuid, varchar, text, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const legalContentTypeEnum = pgEnum('legal_content_type', [
  'legal',
  'notice',
  'refund',
  'booking_guide',
]);

export const legalContent = pgTable('legal_content', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: legalContentTypeEnum('type').notNull(),
  slug: varchar('slug', { length: 120 }).notNull(),
  version: varchar('version', { length: 50 }).notNull(),
  koTitle: varchar('ko_title', { length: 255 }).notNull(),
  koBody: text('ko_body').notNull(),
  enTitle: varchar('en_title', { length: 255 }).notNull(),
  enBody: text('en_body').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_legal_content_type_slug_version').on(table.type, table.slug, table.version),
  index('idx_legal_content_published_at').on(table.publishedAt),
]);
