import { getTableColumns } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { reservationPaymentFailureDiagnostics } from './reservation-payment-failure-diagnostics';

describe('reservation_payment_failure_diagnostics schema', () => {
  it('defines one sanitized diagnostic row per reservation', () => {
    const columns = getTableColumns(reservationPaymentFailureDiagnostics);
    const schemaSource = readFileSync(
      resolve(__dirname, 'reservation-payment-failure-diagnostics.ts'),
      'utf8',
    );

    expect(columns.id).toBeDefined();
    expect(columns.reservationId).toBeDefined();
    expect(columns.paymentId).toBeDefined();
    expect(columns.tossOrderId).toBeDefined();
    expect(columns.diagnosticKind).toBeDefined();
    expect(columns.diagnosticCode).toBeDefined();
    expect(columns.diagnosticMessage).toBeDefined();
    expect(columns.diagnosticSource).toBeDefined();
    expect(columns.recordedAt).toBeDefined();
    expect(columns.providerCheckStatus).toBeDefined();
    expect(columns.providerCheckedAt).toBeDefined();
    expect(columns.providerCheckMessage).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();

    expect(columns).not.toHaveProperty('paymentKey');
    expect(columns).not.toHaveProperty('rawPayload');
    expect(columns).not.toHaveProperty('rawWebhookPayload');
    expect(columns).not.toHaveProperty('rawProviderResponse');
    expect(columns).not.toHaveProperty('providerResponse');
    expect(columns).not.toHaveProperty('secret');
    expect(columns).not.toHaveProperty('cookie');
    expect(columns).not.toHaveProperty('authHeader');
    expect(schemaSource).toContain('foreignKey({');
    expect(schemaSource).toContain("name: 'rpfd_reservation_id_fk'");
    expect(schemaSource).toContain("name: 'rpfd_payment_id_fk'");
    expect(schemaSource).not.toContain('.references(() => reservations.id');
    expect(schemaSource).not.toContain('.references(() => payments.id');
  });

  it('commits the 0028 migration journal entry without broad snapshot churn', () => {
    const migrationsDir = resolve(__dirname, '../migrations');
    const journal = JSON.parse(
      readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };

    expect(journal.entries).toContainEqual(
      expect.objectContaining({
        idx: 29,
        tag: '0028_reservation_payment_failure_diagnostics',
      }),
    );
    expect(existsSync(resolve(migrationsDir, 'meta/0028_snapshot.json'))).toBe(
      false,
    );
  });

  it('creates required foreign keys and indexes in the migration', () => {
    const migration = readFileSync(
      resolve(
        __dirname,
        '../migrations/0028_reservation_payment_failure_diagnostics.sql',
      ),
      'utf8',
    );

    expect(migration).toContain(
      'CREATE TABLE "reservation_payment_failure_diagnostics"',
    );
    expect(migration).toContain('"reservation_id" uuid NOT NULL');
    expect(migration).toContain('"payment_id" uuid');
    expect(migration).toContain(
      'FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null',
    );
    expect(migration).toContain('CONSTRAINT "rpfd_reservation_id_fk"');
    expect(migration).toContain('CONSTRAINT "rpfd_payment_id_fk"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "idx_rpfd_reservation_id"',
    );
    expect(migration).toContain(
      'CREATE INDEX "idx_rpfd_payment_id"',
    );
    expect(migration).toContain(
      'CREATE INDEX "idx_rpfd_toss_order_id"',
    );
    expect(migration).toContain(
      'CREATE INDEX "idx_rpfd_recorded_at"',
    );
    expect(migration).toContain(
      'CREATE INDEX "idx_rpfd_provider_check_status"',
    );
  });

  it('does not create raw payment provider storage in the migration', () => {
    const migration = readFileSync(
      resolve(
        __dirname,
        '../migrations/0028_reservation_payment_failure_diagnostics.sql',
      ),
      'utf8',
    ).toLowerCase();

    expect(migration).not.toContain('payment_key');
    expect(migration).not.toContain('raw_payload');
    expect(migration).not.toContain('raw_webhook');
    expect(migration).not.toContain('raw_provider');
    expect(migration).not.toContain('provider_response');
    expect(migration).not.toContain('secret');
    expect(migration).not.toContain('cookie');
    expect(migration).not.toContain('auth_header');
  });
});
