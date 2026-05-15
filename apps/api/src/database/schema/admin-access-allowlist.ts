import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { adminAuditLogs } from './admin-audit-logs.js';
import { users } from './users.js';

export const adminAllowlistSourceEnum = pgEnum('admin_allowlist_source', [
  'env_bootstrap',
  'db_managed',
  'temporary_exception',
]);

export const adminAllowlistStatusEnum = pgEnum('admin_allowlist_status', [
  'active',
  'disabled',
  'expired',
]);

export const adminAccessAllowlist = pgTable(
  'admin_access_allowlist',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cidr: varchar('cidr', { length: 64 }).notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    source: adminAllowlistSourceEnum('source').notNull(),
    status: adminAllowlistStatusEnum('status').notNull().default('active'),
    reason: text('reason').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    auditLogId: uuid('audit_log_id').references(() => adminAuditLogs.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_admin_access_allowlist_cidr').on(table.cidr),
    index('idx_admin_access_allowlist_source_status').on(
      table.source,
      table.status,
    ),
    index('idx_admin_access_allowlist_audit_log_id').on(table.auditLogId),
    index('idx_admin_access_allowlist_expires_at').on(table.expiresAt),
  ],
);
