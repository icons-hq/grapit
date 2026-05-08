import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { payments } from './payments.js';
import { reservations } from './reservations.js';

export const paymentWebhookEvents = pgTable('payment_webhook_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentId: uuid('payment_id').references(() => payments.id, {
    onDelete: 'set null',
  }),
  reservationId: uuid('reservation_id').references(() => reservations.id, {
    onDelete: 'set null',
  }),
  paymentKey: varchar('payment_key', { length: 200 }),
  tossOrderId: varchar('toss_order_id', { length: 200 }),
  eventId: varchar('event_id', { length: 200 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processingResultCode: varchar('processing_result_code', { length: 100 }),
  processingResultMessage: varchar('processing_result_message', { length: 500 }),
}, (table) => [
  uniqueIndex('idx_payment_webhook_events_event_id').on(table.eventId),
  index('idx_payment_webhook_events_event_type').on(table.eventType),
  index('idx_payment_webhook_events_received_at').on(table.receivedAt),
  index('idx_payment_webhook_events_payment_key').on(table.paymentKey),
  index('idx_payment_webhook_events_toss_order_id').on(table.tossOrderId),
]);
