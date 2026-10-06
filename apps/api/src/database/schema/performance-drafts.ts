import { sql } from 'drizzle-orm';
import { pgTable, uuid, jsonb, integer, timestamp, varchar, index, check, foreignKey } from 'drizzle-orm/pg-core';
import type { PerformancePreparationStep } from '@grabit/shared';
import { users } from './users.js';
import { performances } from './performances.js';

// Constraint names follow migration 0036, which declared the FKs and CHECKs inline
// (PostgreSQL default names), so drizzle-kit diffs address the real constraints.
export const performanceDrafts = pgTable('performance_drafts', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerUserId: uuid('owner_user_id').notNull(),
  performanceId: uuid('performance_id'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  step: varchar('step', { length: 20 }).$type<PerformancePreparationStep>().notNull().default('basic'),
  revision: integer('revision').notNull().default(1),
  baseUpdatedAt: timestamp('base_updated_at', { withTimezone: true }),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: 'performance_drafts_owner_user_id_fkey',
    columns: [table.ownerUserId],
    foreignColumns: [users.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'performance_drafts_performance_id_fkey',
    columns: [table.performanceId],
    foreignColumns: [performances.id],
  }).onDelete('restrict'),
  check('performance_drafts_step_check', sql`${table.step} IN ('basic', 'seats', 'content', 'review')`),
  check('performance_drafts_revision_check', sql`${table.revision} > 0`),
  index('idx_performance_drafts_owner_updated').on(table.ownerUserId, table.updatedAt),
]);
