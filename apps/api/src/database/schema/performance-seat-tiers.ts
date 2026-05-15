import {
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { performances } from './performances.js';

export const performanceSeatTiers = pgTable('performance_seat_tiers', {
  id: uuid('id').defaultRandom().primaryKey(),
  performanceId: uuid('performance_id')
    .notNull()
    .references(() => performances.id, { onDelete: 'cascade' }),
  tierName: varchar('tier_name', { length: 50 }).notNull(),
  color: varchar('color', { length: 20 }).notNull(),
  price: integer('price').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_performance_seat_tiers_performance_name').on(
    table.performanceId,
    table.tierName,
  ),
  index('idx_performance_seat_tiers_performance_sort').on(
    table.performanceId,
    table.sortOrder,
  ),
]);
