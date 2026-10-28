import { pgTable, uuid, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { performances } from './performances.js';

export const performanceFavorites = pgTable('performance_favorites', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  performanceId: uuid('performance_id').notNull().references(() => performances.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.performanceId] }),
  index('idx_performance_favorites_user_created').on(table.userId, table.createdAt),
]);
