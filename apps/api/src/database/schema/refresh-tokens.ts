import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  family: varchar('family', { length: 255 }).notNull(), // for rotation detection
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  index('idx_refresh_tokens_token_hash').on(table.tokenHash),
  index('idx_refresh_tokens_family').on(table.family),
  index('idx_refresh_tokens_user_id').on(table.userId),
  index('idx_refresh_tokens_active_family_query').on(
    table.userId,
    table.family,
    table.revokedAt,
    table.expiresAt,
  ),
]);
