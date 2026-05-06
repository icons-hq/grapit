import { pgTable, uuid, text, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { localeEnum } from './users.js';
import { translationSources, translationStatusEnum } from './translation-sources.js';

export const translationDrafts = pgTable('translation_drafts', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => translationSources.id, { onDelete: 'cascade' }),
  targetLocale: localeEnum('target_locale').notNull(),
  status: translationStatusEnum('status').notNull().default('draft'),
  translatedText: text('translated_text').notNull(),
  sourceContentHash: varchar('source_content_hash', { length: 64 }).notNull(),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_translation_drafts_source_locale_status').on(
    table.sourceId,
    table.targetLocale,
    table.status,
  ),
  index('idx_translation_drafts_status').on(table.status),
]);
