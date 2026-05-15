import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { performances } from './performances.js';
import { performanceSeatTiers } from './performance-seat-tiers.js';
import { venueLayoutSeats } from './venue-layout-seats.js';

export const performanceSeatSaleStatusEnum = pgEnum('performance_seat_sale_status', [
  'available',
  'blocked',
]);

export const performanceSeatAssignments = pgTable(
  'performance_seat_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    performanceId: uuid('performance_id')
      .notNull()
      .references(() => performances.id, { onDelete: 'cascade' }),
    layoutSeatId: uuid('layout_seat_id')
      .notNull()
      .references(() => venueLayoutSeats.id, { onDelete: 'cascade' }),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => performanceSeatTiers.id, { onDelete: 'restrict' }),
    saleStatus: performanceSeatSaleStatusEnum('sale_status')
      .notNull()
      .default('available'),
    blockReason: text('block_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_performance_seat_assignments_performance_seat').on(
      table.performanceId,
      table.layoutSeatId,
    ),
    index('idx_performance_seat_assignments_tier').on(table.tierId),
    index('idx_performance_seat_assignments_sale_status').on(table.saleStatus),
  ],
);
