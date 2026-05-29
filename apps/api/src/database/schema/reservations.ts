import { pgTable, uuid, varchar, integer, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { showtimes } from './showtimes.js';

export const reservationStatusEnum = pgEnum('reservation_status', [
  'PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'FAILED',
]);

export const reservations = pgTable('reservations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  showtimeId: uuid('showtime_id').notNull().references(() => showtimes.id),
  reservationNumber: varchar('reservation_number', { length: 30 }).notNull().unique(),
  tossOrderId: varchar('toss_order_id', { length: 200 }).unique(),
  queueSessionId: varchar('queue_session_id', { length: 200 }),
  admissionToken: varchar('admission_token', { length: 500 }),
  refreshFamilyId: varchar('refresh_family_id', { length: 200 }),
  deviceSlotKey: varchar('device_slot_key', { length: 200 }),
  admittedAt: timestamp('admitted_at', { withTimezone: true }),
  admissionActiveUntilAt: timestamp('admission_active_until_at', { withTimezone: true }),
  reentryGraceUntilAt: timestamp('reentry_grace_until_at', { withTimezone: true }),
  paymentDeadlineAt: timestamp('payment_deadline_at', { withTimezone: true }),
  status: reservationStatusEnum('status').notNull().default('PENDING_PAYMENT'),
  totalAmount: integer('total_amount').notNull(),
  providerChargeCurrency: varchar('provider_charge_currency', { length: 10 }),
  providerChargeAmountMinor: integer('provider_charge_amount_minor'),
  providerChargeRate: varchar('provider_charge_rate', { length: 50 }),
  providerChargeQuotedAt: timestamp('provider_charge_quoted_at', { withTimezone: true }),
  cancelDeadline: timestamp('cancel_deadline', { withTimezone: true }).notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: varchar('cancel_reason', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_reservations_user_id').on(table.userId),
  index('idx_reservations_showtime_id').on(table.showtimeId),
  index('idx_reservations_status').on(table.status),
  index('idx_reservations_reservation_number').on(table.reservationNumber),
  index('idx_reservations_toss_order_id').on(table.tossOrderId),
  index('idx_reservations_queue_session_id').on(table.queueSessionId),
  index('idx_reservations_payment_deadline_at').on(table.paymentDeadlineAt),
]);
