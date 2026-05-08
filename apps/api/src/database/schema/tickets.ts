import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { reservations } from './reservations.js';
import { payments } from './payments.js';
import { showtimes } from './showtimes.js';

export const ticketStatusEnum = pgEnum('ticket_status', [
  'active',
  'revoked',
  'used',
  'expired',
]);

export const tickets = pgTable('tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  reservationId: uuid('reservation_id')
    .notNull()
    .references(() => reservations.id, { onDelete: 'cascade' }),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payments.id, { onDelete: 'cascade' }),
  showtimeId: uuid('showtime_id')
    .notNull()
    .references(() => showtimes.id, { onDelete: 'cascade' }),
  qrTokenJti: varchar('qr_token_jti', { length: 200 }).notNull().unique(),
  secretVersion: varchar('secret_version', { length: 100 }).notNull(),
  status: ticketStatusEnum('status').notNull().default('active'),
  emailJobId: varchar('email_job_id', { length: 200 }),
  issuedAt: timestamp('issued_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  emailScheduledAt: timestamp('email_scheduled_at', { withTimezone: true }),
  emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex('idx_tickets_reservation_id').on(table.reservationId),
  uniqueIndex('idx_tickets_payment_id').on(table.paymentId),
  index('idx_tickets_showtime_id').on(table.showtimeId),
  index('idx_tickets_status').on(table.status),
]);
