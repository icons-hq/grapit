import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { adminAuditLogs } from './admin-audit-logs.js';
import { reservations } from './reservations.js';
import { seatInventories, seatStatusEnum } from './seat-inventories.js';
import { showtimes } from './showtimes.js';
import { users } from './users.js';

export const seatOperationActionEnum = pgEnum('seat_operation_action', [
  'seat.disable',
  'seat.reactivate',
  'seat.manual_open',
]);

export const seatOperationHistory = pgTable(
  'seat_operation_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    action: seatOperationActionEnum('action').notNull(),
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'restrict' }),
    seatInventoryId: uuid('seat_inventory_id').references(
      () => seatInventories.id,
      { onDelete: 'set null' },
    ),
    seatId: varchar('seat_id', { length: 20 }).notNull(),
    floorKey: varchar('floor_key', { length: 20 }).notNull(),
    seatKey: varchar('seat_key', { length: 80 }).notNull(),
    previousStatus: seatStatusEnum('previous_status').notNull(),
    nextStatus: seatStatusEnum('next_status').notNull(),
    reason: text('reason').notNull(),
    auditLogId: uuid('audit_log_id')
      .notNull()
      .references(() => adminAuditLogs.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id').references(() => reservations.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_seat_operation_history_actor_user_id').on(table.actorUserId),
    index('idx_seat_operation_history_showtime_seat_key').on(
      table.showtimeId,
      table.floorKey,
      table.seatKey,
    ),
    index('idx_seat_operation_history_action_created_at').on(
      table.action,
      table.createdAt,
    ),
    index('idx_seat_operation_history_audit_log_id').on(table.auditLogId),
    index('idx_seat_operation_history_reservation_id').on(table.reservationId),
  ],
);
