import { pgTable, uuid, varchar, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { localeEnum, users } from './users.js';
import { consentItems } from './consent-items.js';

export const consentAuditLogs = pgTable('consent_audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  consentItemId: uuid('consent_item_id')
    .notNull()
    .references(() => consentItems.id, { onDelete: 'restrict' }),
  itemKey: varchar('item_key', { length: 100 }).notNull(),
  itemVersion: varchar('item_version', { length: 50 }).notNull(),
  language: localeEnum('language').notNull(),
  agreed: boolean('agreed').notNull(),
  agreedAt: timestamp('agreed_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }).notNull(),
  userAgent: varchar('user_agent', { length: 500 }),
}, (table) => [
  index('idx_consent_audit_logs_user').on(table.userId),
  index('idx_consent_audit_logs_item').on(table.consentItemId),
  index('idx_consent_audit_logs_item_version_language').on(
    table.itemKey,
    table.itemVersion,
    table.language,
  ),
  index('idx_consent_audit_logs_agreed_at').on(table.agreedAt),
  index('idx_consent_audit_logs_ip').on(table.ipAddress),
]);
