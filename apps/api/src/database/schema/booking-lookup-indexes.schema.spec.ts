import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { payments } from './payments';
import { reservationSeats } from './reservation-seats';

function indexColumns(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((index) => ({
    name: index.config.name,
    unique: index.config.unique,
    columns: index.config.columns.map((column) =>
      'name' in column ? column.name : String(column),
    ),
  }));
}

describe('booking lookup indexes', () => {
  const migrationsDir = resolve(__dirname, '../migrations');
  const migration = readFileSync(
    resolve(migrationsDir, '0038_booking_lookup_indexes.sql'),
    'utf8',
  );

  it('indexes reservation_seats.reservation_id for prepare/confirm/webhook/my-page lookups', () => {
    expect(indexColumns(reservationSeats)).toContainEqual({
      name: 'idx_reservation_seats_reservation_id',
      unique: false,
      columns: ['reservation_id'],
    });
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_reservation_seats_reservation_id" ON "reservation_seats" USING btree ("reservation_id")',
    );
  });

  it('indexes payments.toss_order_id for confirm entry and webhook matching', () => {
    expect(indexColumns(payments)).toContainEqual({
      name: 'idx_payments_toss_order_id',
      unique: false,
      columns: ['toss_order_id'],
    });
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_payments_toss_order_id" ON "payments" USING btree ("toss_order_id")',
    );
  });

  it('keeps the migration additive and registered in the journal', () => {
    const statements = migration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|TRUNCATE)\b/i);
    // drizzle runs pending migrations in one transaction; CONCURRENTLY would fail there.
    expect(statements).not.toMatch(/CONCURRENTLY/i);

    const journal = JSON.parse(
      readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries).toContainEqual(
      expect.objectContaining({ idx: 39, tag: '0038_booking_lookup_indexes' }),
    );
  });
});
