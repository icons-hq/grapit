import { pgTable, uuid, varchar, integer } from 'drizzle-orm/pg-core';
import { reservations } from './reservations.js';

export const reservationSeats = pgTable('reservation_seats', {
  id: uuid('id').defaultRandom().primaryKey(),
  reservationId: uuid('reservation_id').notNull().references(() => reservations.id, { onDelete: 'cascade' }),
  seatId: varchar('seat_id', { length: 120 }).notNull(),
  tierName: varchar('tier_name', { length: 50 }).notNull(),
  price: integer('price').notNull(),
  row: varchar('row', { length: 50 }).notNull(),
  number: varchar('number', { length: 50 }).notNull(),
});
