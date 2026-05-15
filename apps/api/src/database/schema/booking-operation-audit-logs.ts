import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { reservations } from './reservations.js';

export const bookingOperationActionEnum = pgEnum('booking_operation_action', [
  'manual_open',
  'admin_refund',
]);

export const bookingOperationAuditLogs = pgTable(
  'booking_operation_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    operatorUserId: uuid('operator_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    action: bookingOperationActionEnum('action').notNull(),
    seatKey: varchar('seat_key', { length: 120 }).notNull(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_booking_operation_audit_logs_operator_user_id').on(
      table.operatorUserId,
    ),
    index('idx_booking_operation_audit_logs_reservation_id').on(
      table.reservationId,
    ),
    index('idx_booking_operation_audit_logs_seat_key').on(table.seatKey),
  ],
);
