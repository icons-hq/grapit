import { integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { reservations } from './reservations.js';

/** One automatic reminder per reservation. A lease is never evidence of delivery. */
export const qrReminderDeliveries = pgTable('qr_reminder_deliveries', {
  reservationId: uuid('reservation_id').primaryKey().references(() => reservations.id, { onDelete: 'cascade' }),
  claimToken: uuid('claim_token'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  payloadHash: varchar('payload_hash', { length: 64 }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  providerMessageId: varchar('provider_message_id', { length: 200 }),
  attentionAt: timestamp('attention_at', { withTimezone: true }),
  attentionReason: varchar('attention_reason', { length: 100 }),
  suppressedAt: timestamp('suppressed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
