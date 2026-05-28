import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ticketItems,
  ticketItemStatusEnum,
  ticketItemAdmissionStateEnum,
} from './ticket-items';

describe('ticket_items schema', () => {
  it('defines validity and admission state as separate enums', () => {
    expect(ticketItemStatusEnum.enumValues).toEqual([
      'active',
      'cancellation_pending',
      'cancelled',
      'expired',
    ]);
    expect(ticketItemAdmissionStateEnum.enumValues).toEqual([
      'not_entered',
      'entered',
    ]);
  });

  it('commits the 0024 migration journal entry and snapshot metadata', () => {
    const migrationsDir = resolve(__dirname, '../migrations');
    const journal = JSON.parse(
      readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };

    expect(journal.entries).toContainEqual(
      expect.objectContaining({
        idx: 25,
        tag: '0024_ticket_items',
      }),
    );
    expect(existsSync(resolve(migrationsDir, 'meta/0024_snapshot.json'))).toBe(
      true,
    );
  });

  it('keeps the ticket item migration free of hidden destructive DML', () => {
    const migration = readFileSync(
      resolve(__dirname, '../migrations/0024_ticket_items.sql'),
      'utf8',
    );

    const destructiveStatements = migration
      .split('--> statement-breakpoint')
      .map((statement) =>
        statement
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('--'))
          .join('\n')
          .trim(),
      )
      .filter((statement) => /^(update|delete|truncate)\b/i.test(statement));

    expect(destructiveStatements).toEqual([]);
  });

  it('stores seat identity, service fee, cancellation, and controlled reopen fields', () => {
    const columns = getTableColumns(ticketItems);
    expect(columns.reservationId).toBeDefined();
    expect(columns.paymentId).toBeDefined();
    expect(columns.showtimeId).toBeDefined();
    expect(columns.seatKey).toBeDefined();
    expect(columns.floorKey).toBeDefined();
    expect(columns.price).toBeDefined();
    expect(columns.serviceFee).toBeDefined();
    expect(columns.status).toBeDefined();
    expect(columns.admissionState).toBeDefined();
    expect(columns.cancellationFee).toBeDefined();
    expect(columns.serviceFeeRefund).toBeDefined();
    expect(columns.refundableAmount).toBeDefined();
    expect(columns.reopenState).toBeDefined();
  });

  it('keeps only one active ticket credential per ticket item while allowing history rows', () => {
    const ticketsSchema = readFileSync(
      resolve(__dirname, 'tickets.ts'),
      'utf8',
    );
    const migration = readFileSync(
      resolve(__dirname, '../migrations/0024_ticket_items.sql'),
      'utf8',
    );

    expect(ticketsSchema).toContain("import { sql } from 'drizzle-orm';");
    expect(ticketsSchema).toMatch(
      /uniqueIndex\('idx_tickets_ticket_item_active'\)\s*\.on\(table\.ticketItemId\)/,
    );
    expect(ticketsSchema).toContain(
      "where(sql`${table.ticketItemId} IS NOT NULL AND ${table.status} = 'active'`)",
    );

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "idx_tickets_ticket_item_active" ON "tickets" USING btree ("ticket_item_id") WHERE "tickets"."ticket_item_id" IS NOT NULL AND "tickets"."status" = \'active\';',
    );
    expect(migration).not.toContain(
      'CREATE UNIQUE INDEX "idx_tickets_ticket_item_active" ON "tickets" USING btree ("ticket_item_id","status")',
    );
  });

  it('keeps transitional active uniqueness for legacy null-ticket-item credentials', () => {
    const ticketsSchema = readFileSync(
      resolve(__dirname, 'tickets.ts'),
      'utf8',
    );
    const migration = readFileSync(
      resolve(__dirname, '../migrations/0024_ticket_items.sql'),
      'utf8',
    );

    expect(ticketsSchema).toMatch(
      /uniqueIndex\('idx_tickets_legacy_reservation_active'\)\s*\.on\(table\.reservationId\)\s*\.where\(sql`\$\{table\.ticketItemId\} IS NULL AND \$\{table\.status\} = 'active'`\)/,
    );
    expect(ticketsSchema).toMatch(
      /uniqueIndex\('idx_tickets_legacy_payment_active'\)\s*\.on\(table\.paymentId\)\s*\.where\(sql`\$\{table\.ticketItemId\} IS NULL AND \$\{table\.status\} = 'active'`\)/,
    );

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "idx_tickets_legacy_reservation_active" ON "tickets" USING btree ("reservation_id") WHERE "tickets"."ticket_item_id" IS NULL AND "tickets"."status" = \'active\';',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "idx_tickets_legacy_payment_active" ON "tickets" USING btree ("payment_id") WHERE "tickets"."ticket_item_id" IS NULL AND "tickets"."status" = \'active\';',
    );
  });

  it('backfills only confirmed or cancelled ticket items and documents legacy null attribution', () => {
    const migration = readFileSync(
      resolve(__dirname, '../migrations/0024_ticket_items.sql'),
      'utf8',
    );

    expect(migration).toContain('WHERE r."status" IN (\'CONFIRMED\', \'CANCELLED\')');
    expect(migration).not.toContain('PENDING_PAYMENT');
    expect(migration).not.toContain('FAILED');
    expect(migration).toContain(
      'WHEN legacy_entry."has_entered" THEN \'entered\'::"ticket_item_admission_state"',
    );
    expect(migration).toContain('legacy_ticket."status" = \'used\'');
    expect(migration).toContain(
      'legacy_scan."result" IN (\'success\', \'offline_synced\', \'already_used\')',
    );
    expect(migration).toContain(
      '-- Existing tickets.ticket_item_id rows intentionally remain NULL because legacy reservation-level QR payloads cannot be safely attributed to one seat.',
    );
    expect(migration).toContain(
      '-- Existing ticket_scan_events.ticket_item_id rows intentionally remain NULL for the same reason; integrated scanner rollout rejects legacy payloads without ticketItemId.',
    );
  });
});
