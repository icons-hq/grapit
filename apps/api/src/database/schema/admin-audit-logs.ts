import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const adminAuditActionEnum = pgEnum('admin_audit_action', [
  'event.publish',
  'event.update',
  'refund.admin_refund',
  'support.escalate',
  'seat.disable',
  'seat.reactivate',
  'seat.manual_open',
  'banner.manage',
  'reservations.export_raw',
  'security.allowlist.update',
  'security.permission.update',
  'user.withdraw',
  'user.hard_delete',
]);

export const adminAuditStatusEnum = pgEnum('admin_audit_status', [
  'success',
  'denied',
  'failed',
]);

export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    action: adminAuditActionEnum('action').notNull(),
    resourceType: varchar('resource_type', { length: 80 }).notNull(),
    resourceId: varchar('resource_id', { length: 160 }).notNull(),
    status: adminAuditStatusEnum('status').notNull(),
    reason: text('reason'),
    changedFields: jsonb('changed_fields')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    maskedBeforeSnapshot: jsonb('masked_before_snapshot')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    maskedAfterSnapshot: jsonb('masked_after_snapshot')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: varchar('user_agent', { length: 500 }),
    requestId: varchar('request_id', { length: 120 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_admin_audit_logs_actor_user_id').on(table.actorUserId),
    index('idx_admin_audit_logs_action').on(table.action),
    index('idx_admin_audit_logs_resource').on(
      table.resourceType,
      table.resourceId,
    ),
    index('idx_admin_audit_logs_status_created_at').on(
      table.status,
      table.createdAt,
    ),
    index('idx_admin_audit_logs_request_id').on(table.requestId),
  ],
);
