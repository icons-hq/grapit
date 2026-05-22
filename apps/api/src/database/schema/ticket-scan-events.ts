import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { reservations } from './reservations.js';
import { showtimes } from './showtimes.js';
import { tickets } from './tickets.js';
import { users } from './users.js';

export const ticketScanResultEnum = pgEnum('ticket_scan_result', [
  'success',
  'duplicate',
  'tampered',
  'refunded_cancelled',
  'expired',
  'wrong_showtime',
  'already_used',
  'offline_pending',
  'offline_synced',
  'offline_rejected',
  'sync_failure',
]);

export const ticketScanSourceEnum = pgEnum('ticket_scan_source', [
  'online',
  'offline_sync',
]);

export const ticketScanSyncStateEnum = pgEnum('ticket_scan_sync_state', [
  'not_required',
  'pending',
  'synced',
  'rejected',
  'failed',
]);

export const ticketScanEvents = pgTable(
  'ticket_scan_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'restrict' }),
    showtimeId: uuid('showtime_id')
      .notNull()
      .references(() => showtimes.id, { onDelete: 'restrict' }),
    scannerUserId: uuid('scanner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    result: ticketScanResultEnum('result').notNull(),
    source: ticketScanSourceEnum('source').notNull().default('online'),
    syncState: ticketScanSyncStateEnum('sync_state')
      .notNull()
      .default('not_required'),
    priorScanEventId: uuid('prior_scan_event_id'),
    deviceAttemptId: varchar('device_attempt_id', { length: 120 }),
    maskedJti: varchar('masked_jti', { length: 120 }),
    rejectionReason: text('rejection_reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    scannedAt: timestamp('scanned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_ticket_scan_events_showtime_id').on(table.showtimeId),
    index('idx_ticket_scan_events_result').on(table.result),
    index('idx_ticket_scan_events_scanner_user_id').on(table.scannerUserId),
    index('idx_ticket_scan_events_device_attempt_id').on(table.deviceAttemptId),
    index('idx_ticket_scan_events_created_at').on(table.createdAt),
    uniqueIndex('idx_ticket_scan_events_device_attempt_unique')
      .on(table.deviceAttemptId)
      .where(sql`${table.deviceAttemptId} IS NOT NULL`),
  ],
);
