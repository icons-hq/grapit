import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  jsonb,
  integer,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { reservations } from './reservations.js';
import { payments } from './payments.js';

export const refundStatusEnum = pgEnum('refund_status', [
  'requested',
  'sent_to_pg',
  'processing_at_pg',
  'completed',
  'failed',
]);

export const refunds = pgTable('refunds', {
  id: uuid('id').defaultRandom().primaryKey(),
  reservationId: uuid('reservation_id')
    .notNull()
    .references(() => reservations.id, { onDelete: 'cascade' }),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payments.id, { onDelete: 'cascade' }),
  status: refundStatusEnum('status').notNull().default('requested'),
  provider: varchar('provider', { length: 50 }).notNull(),
  providerRefundKey: varchar('provider_refund_key', { length: 200 }),
  resultCode: varchar('result_code', { length: 100 }),
  resultMessage: varchar('result_message', { length: 500 }),
  failureReason: varchar('failure_reason', { length: 500 }),
  providerMetadata: jsonb('provider_metadata'),
  retryCount: integer('retry_count').notNull().default(0),
  customerServiceCtaVisible: boolean('customer_service_cta_visible')
    .notNull()
    .default(false),
  requestedAt: timestamp('requested_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  sentToPgAt: timestamp('sent_to_pg_at', { withTimezone: true }),
  processingAtPgAt: timestamp('processing_at_pg_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  expectedDepositAt: timestamp('expected_deposit_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex('idx_refunds_reservation_id').on(table.reservationId),
  uniqueIndex('idx_refunds_payment_id').on(table.paymentId),
  index('idx_refunds_status').on(table.status),
  index('idx_refunds_requested_at').on(table.requestedAt),
]);
