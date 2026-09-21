import { pgTable, uuid, jsonb, integer, timestamp, varchar, index } from 'drizzle-orm/pg-core';
import type { PerformancePreparationStep } from '@grabit/shared';
import { users } from './users.js';
import { performances } from './performances.js';

export const performanceDrafts = pgTable('performance_drafts', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  performanceId: uuid('performance_id').references(() => performances.id, { onDelete: 'restrict' }),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  step: varchar('step', { length: 20 }).$type<PerformancePreparationStep>().notNull().default('basic'),
  revision: integer('revision').notNull().default(1),
  baseUpdatedAt: timestamp('base_updated_at', { withTimezone: true }),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('idx_performance_drafts_owner_updated').on(table.ownerUserId, table.updatedAt)]);
