import { pgTable, uuid, varchar, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  purpose: varchar('purpose', { length: 50 }).notNull().default('signup'),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_email_verification_tokens_token_hash').on(table.tokenHash),
  index('idx_email_verification_tokens_email_purpose_created').on(
    table.email,
    table.purpose,
    table.createdAt,
  ),
  index('idx_email_verification_tokens_user_purpose_created').on(
    table.userId,
    table.purpose,
    table.createdAt,
  ),
  index('idx_email_verification_tokens_expires_at').on(table.expiresAt),
]);
