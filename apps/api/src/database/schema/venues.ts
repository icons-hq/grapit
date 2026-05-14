import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';

export const venues = pgTable('venues', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  address: varchar('address', { length: 500 }),
  accessNotes: text('access_notes'),
  transportSummary: text('transport_summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
