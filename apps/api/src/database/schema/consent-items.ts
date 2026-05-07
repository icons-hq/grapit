import { pgTable, uuid, varchar, text, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { localeEnum } from './users.js';

export const consentItems = pgTable('consent_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: varchar('key', { length: 100 }).notNull(),
  version: varchar('version', { length: 50 }).notNull(),
  locale: localeEnum('locale').notNull().default('ko'),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body').notNull(),
  isRequired: boolean('is_required').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_consent_items_key_version_locale').on(table.key, table.version, table.locale),
  index('idx_consent_items_key_active').on(table.key, table.isActive),
]);
