import { pgTable, uuid, varchar, integer, timestamp, pgEnum, jsonb } from 'drizzle-orm/pg-core';
import { reservations } from './reservations.js';

export const paymentStatusEnum = pgEnum('payment_status', [
  'READY', 'IN_PROGRESS', 'DONE', 'CANCELED', 'ABORTED', 'EXPIRED',
]);

export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  reservationId: uuid('reservation_id').notNull().references(() => reservations.id).unique(),
  paymentKey: varchar('payment_key', { length: 200 }).notNull().unique(),
  tossOrderId: varchar('toss_order_id', { length: 200 }).notNull(),
  method: varchar('method', { length: 50 }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull().default('CARD'),
  currency: varchar('currency', { length: 10 }).notNull().default('KRW'),
  asyncStatus: varchar('async_status', { length: 50 }).notNull().default('sync'),
  pendingUrl: varchar('pending_url', { length: 1000 }),
  disclaimerAcceptedAt: timestamp('disclaimer_accepted_at', { withTimezone: true }),
  disclaimerVersion: varchar('disclaimer_version', { length: 50 }),
  disclaimerSnapshot: jsonb('disclaimer_snapshot'),
  providerMetadata: jsonb('provider_metadata'),
  amount: integer('amount').notNull(),
  providerChargeCurrency: varchar('provider_charge_currency', { length: 10 }),
  providerChargeAmountMinor: integer('provider_charge_amount_minor'),
  providerChargeRate: varchar('provider_charge_rate', { length: 50 }),
  providerChargeQuotedAt: timestamp('provider_charge_quoted_at', { withTimezone: true }),
  status: paymentStatusEnum('status').notNull().default('READY'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: varchar('cancel_reason', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
