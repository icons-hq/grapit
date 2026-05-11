import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { performances } from './performances.js';

export const bookingPolicies = pgTable('booking_policies', {
  id: uuid('id').defaultRandom().primaryKey(),
  performanceId: uuid('performance_id')
    .notNull()
    .references(() => performances.id, { onDelete: 'cascade' }),
  maxTicketsPerUser: integer('max_tickets_per_user').notNull().default(1),
  changePolicyEnabled: boolean('change_policy_enabled').notNull().default(false),
  allowedPaymentMethods: jsonb('allowed_payment_methods')
    .$type<string[]>()
    .notNull()
    .default(sql`'["CARD"]'::jsonb`),
  paymentWindowMinutes: integer('payment_window_minutes').notNull().default(7),
  seatHoldMinutes: integer('seat_hold_minutes').notNull().default(10),
  cancelledSeatHoldMinMinutes: integer('cancelled_seat_hold_min_minutes')
    .notNull()
    .default(1),
  cancelledSeatHoldMaxMinutes: integer('cancelled_seat_hold_max_minutes')
    .notNull()
    .default(10),
  manualOpenEnabled: boolean('manual_open_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_booking_policies_performance_id').on(table.performanceId),
]);
