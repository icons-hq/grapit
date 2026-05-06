import { pgTable, uuid, varchar, text, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { localeEnum, users } from './users.js';

export const translationStatusEnum = pgEnum('translation_status', [
  'draft',
  'review',
  'published',
  'stale',
]);

export const translationSources = pgTable('translation_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityType: varchar('entity_type', { length: 100 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  field: varchar('field', { length: 100 }).notNull(),
  sourceLocale: localeEnum('source_locale').notNull().default('ko'),
  sourceText: text('source_text').notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_translation_sources_entity_field').on(table.entityType, table.entityId, table.field),
  index('idx_translation_sources_content_hash').on(table.contentHash),
]);
