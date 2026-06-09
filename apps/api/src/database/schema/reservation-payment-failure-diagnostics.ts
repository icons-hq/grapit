import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { payments } from './payments.js';
import { reservations } from './reservations.js';

export const reservationPaymentFailureDiagnostics = pgTable(
  'reservation_payment_failure_diagnostics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    paymentId: uuid('payment_id').references(() => payments.id, {
      onDelete: 'set null',
    }),
    tossOrderId: varchar('toss_order_id', { length: 200 }),
    diagnosticKind: varchar('diagnostic_kind', { length: 80 }).notNull(),
    diagnosticCode: varchar('diagnostic_code', { length: 100 }).notNull(),
    diagnosticMessage: varchar('diagnostic_message', {
      length: 500,
    }).notNull(),
    diagnosticSource: varchar('diagnostic_source', { length: 80 }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    providerCheckStatus: varchar('provider_check_status', { length: 50 })
      .notNull()
      .default('not_checked'),
    providerCheckedAt: timestamp('provider_checked_at', { withTimezone: true }),
    providerCheckMessage: varchar('provider_check_message', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_rpfd_reservation_id').on(table.reservationId),
    index('idx_rpfd_payment_id').on(table.paymentId),
    index('idx_rpfd_toss_order_id').on(table.tossOrderId),
    index('idx_rpfd_recorded_at').on(table.recordedAt),
    index('idx_rpfd_provider_check_status').on(table.providerCheckStatus),
  ],
);
