import {
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { payments } from './payments.js';
import { reservations } from './reservations.js';
import { showtimes } from './showtimes.js';

export const ticketItemStatusEnum = pgEnum('ticket_item_status', [
  'active',
  'cancellation_pending',
  'cancelled',
  'expired',
]);

export const ticketItemAdmissionStateEnum = pgEnum(
  'ticket_item_admission_state',
  ['not_entered', 'entered'],
);

export const ticketItemReopenStateEnum = pgEnum('ticket_item_reopen_state', [
  'not_required',
  'held_cancelled',
  'available',
  'manual_opened',
]);

export const ticketItems = pgTable(
  'ticket_items',
  {
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
    seatId: varchar('seat_id', { length: 120 }).notNull(),
    seatKey: varchar('seat_key', { length: 120 }).notNull(),
    floorKey: varchar('floor_key', { length: 50 }).notNull(),
    floorLabel: varchar('floor_label', { length: 100 }).notNull(),
    tierName: varchar('tier_name', { length: 50 }).notNull(),
    row: varchar('row', { length: 50 }).notNull(),
    number: varchar('number', { length: 50 }).notNull(),
    price: integer('price').notNull(),
    serviceFee: integer('service_fee').notNull().default(2000),
    status: ticketItemStatusEnum('status').notNull().default('active'),
    admissionState: ticketItemAdmissionStateEnum('admission_state')
      .notNull()
      .default('not_entered'),
    enteredAt: timestamp('entered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: varchar('cancel_reason', { length: 200 }),
    cancellationFee: integer('cancellation_fee').notNull().default(0),
    serviceFeeRefund: integer('service_fee_refund').notNull().default(0),
    refundableAmount: integer('refundable_amount').notNull().default(0),
    reopenState: ticketItemReopenStateEnum('reopen_state')
      .notNull()
      .default('not_required'),
    reopenHoldUntil: timestamp('reopen_hold_until', { withTimezone: true }),
    reopenJobId: varchar('reopen_job_id', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_ticket_items_reservation_seat').on(
      table.reservationId,
      table.seatKey,
    ),
    index('idx_ticket_items_reservation_id').on(table.reservationId),
    index('idx_ticket_items_payment_id').on(table.paymentId),
    index('idx_ticket_items_showtime_id').on(table.showtimeId),
    index('idx_ticket_items_status').on(table.status),
    index('idx_ticket_items_admission_state').on(table.admissionState),
  ],
);
