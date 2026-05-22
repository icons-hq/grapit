import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettlementExportDataset } from '@grabit/shared';

import * as csvExport from './csv-export.util.js';
import { SettlementExportService } from './settlement-export.service.js';

function chainResult<T>(rows: T[]) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: T[]) => void) => resolve(rows);
      }

      return () => new Proxy({}, handler);
    },
  };

  return new Proxy({}, handler);
}

function createDependencies() {
  const db = {
    select: vi.fn(),
  };
  const adminAuditService = {
    write: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  };
  const service = new SettlementExportService(
    db as never,
    adminAuditService as never,
  );

  return { service, db, adminAuditService };
}

const DATASETS: SettlementExportDataset[] = [
  'entry_status',
  'no_show_reservations',
  'reservation_payment_refund_summary',
  'settlement_accounting_input',
];

const FORMULA_VALUES = [
  '=SUM(1,1)',
  '+821055501234',
  '-1000',
  '@evil',
  '\t=cmd',
  '\r=cmd',
];

const FINANCE_ACTOR = {
  actorUserId: 'finance-admin-1',
  capabilities: ['settlement.export'],
  ipAddress: '203.0.113.10',
  userAgent: 'Vitest Settlement Console',
};

const SCANNER_ONLY_ACTOR = {
  actorUserId: 'scanner-user-1',
  bundle: 'scanner',
  capabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync'],
  ipAddress: '203.0.113.11',
  userAgent: 'Scanner Mobile Browser',
};

function expectNoRawExportLeak(result: unknown) {
  const serialized = JSON.stringify(result);

  expect(serialized).not.toContain('raw-customer@example.com');
  expect(serialized).not.toContain('+821055501234');
  expect(serialized).not.toContain('payment_key_live_sensitive');
  expect(serialized).not.toContain('session=raw-cookie');
  expect(serialized).not.toContain('ey.raw.qr-ticket-token');
  expect(serialized).not.toContain('qr-jti-full-raw');
  expect(serialized).not.toContain('rawCsvRows');
}

describe('SettlementExportService RED contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each(DATASETS)('exports %s dataset with safeCsvRows and audited metadata only', async (dataset) => {
    const { service, db, adminAuditService } = createDependencies();
    const safeCsvRowsSpy = vi.spyOn(csvExport, 'safeCsvRows');
    db.select.mockReturnValueOnce(chainResult([
      {
        dataset,
        reservationNumber: 'R-20260704-001',
        entryStatus: 'entered',
        noShow: false,
        paymentStatus: 'DONE',
        refundStatus: 'NONE',
        settlementAmount: 99000,
        customerEmail: 'raw-customer@example.com',
        customerPhone: '+821055501234',
        paymentKey: 'payment_key_live_sensitive',
        qrToken: 'ey.raw.qr-ticket-token',
        qrTokenJti: 'qr-jti-full-raw',
      },
    ]));

    const result = await service.exportDataset({
      eventId: 'event-girl-rules-20260704',
      showtimeId: '00000000-0000-4000-8000-000000000001',
      dataset,
      reason: 'post-event settlement reconciliation',
      dateFrom: '2026-07-04',
      dateTo: '2026-07-05',
    }, FINANCE_ACTOR);

    expect(result).toMatchObject({
      dataset,
      filename: expect.stringContaining(dataset),
      rowCount: 1,
      csv: expect.any(String),
    });
    expect(safeCsvRowsSpy).toHaveBeenCalled();
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'finance-admin-1',
        action: 'settlement.export',
        resourceType: 'settlement_export',
        resourceId: dataset,
        status: 'success',
        reason: 'post-event settlement reconciliation',
        changedFields: ['dataset', 'filters', 'rowCount'],
        after: {
          dataset,
          filters: {
            eventId: 'event-girl-rules-20260704',
            showtimeId: '00000000-0000-4000-8000-000000000001',
            dateFrom: '2026-07-04',
            dateTo: '2026-07-05',
          },
          rowCount: 1,
        },
      }),
      expect.anything(),
    );
    expectNoRawExportLeak(adminAuditService.write.mock.calls[0]?.[0]);
  });

  it('neutralizes formula-leading CSV values through safeCsvRows instead of manual join', async () => {
    const { service, db } = createDependencies();
    db.select.mockReturnValueOnce(chainResult([
      {
        reservationNumber: FORMULA_VALUES[0],
        entryStatus: FORMULA_VALUES[1],
        noShowReason: FORMULA_VALUES[2],
        paymentStatus: FORMULA_VALUES[3],
        refundStatus: FORMULA_VALUES[4],
        settlementMemo: FORMULA_VALUES[5],
      },
    ]));

    const result = await service.exportDataset({
      eventId: 'event-girl-rules-20260704',
      dataset: 'settlement_accounting_input',
      reason: 'formula injection regression coverage',
    }, FINANCE_ACTOR);

    for (const value of FORMULA_VALUES) {
      expect(result.csv).toContain(`"'${value.replace(/"/g, '""')}"`);
    }
    expect(result.csv).not.toContain(FORMULA_VALUES.join(','));
  });

  it('denies scanner-only users because settlement.export is finance/full-admin scope', async () => {
    const { service, db, adminAuditService } = createDependencies();

    await expect(
      service.exportDataset({
        eventId: 'event-girl-rules-20260704',
        dataset: 'entry_status',
        reason: 'scanner-only privilege escalation attempt',
      }, SCANNER_ONLY_ACTOR),
    ).rejects.toThrow(/settlement\.export|권한|denied/i);

    expect(db.select).not.toHaveBeenCalled();
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'scanner-user-1',
        action: 'settlement.export',
        resourceType: 'settlement_export',
        resourceId: 'entry_status',
        status: 'denied',
        reason: 'scanner-only privilege escalation attempt',
        after: expect.objectContaining({
          requiredCapability: 'settlement.export',
          actorBundle: 'scanner',
        }),
      }),
      expect.anything(),
    );
  });

  it('keeps audit metadata to actor, reason, filters, dataset, and row count without raw CSV rows', async () => {
    const { service, db, adminAuditService } = createDependencies();
    db.select.mockReturnValueOnce(chainResult([
      {
        reservationNumber: 'R-20260704-001',
        customerEmail: 'raw-customer@example.com',
        customerPhone: '+821055501234',
        settlementAmount: 99000,
      },
    ]));

    await service.exportDataset({
      eventId: 'event-girl-rules-20260704',
      dataset: 'reservation_payment_refund_summary',
      reason: 'operator reviewed settlement export',
      dateFrom: '2026-07-04',
      dateTo: '2026-07-05',
    }, FINANCE_ACTOR);

    const [auditInput] = adminAuditService.write.mock.calls[0]!;

    expect(auditInput).toMatchObject({
      actorUserId: 'finance-admin-1',
      reason: 'operator reviewed settlement export',
      after: {
        dataset: 'reservation_payment_refund_summary',
        filters: {
          eventId: 'event-girl-rules-20260704',
          dateFrom: '2026-07-04',
          dateTo: '2026-07-05',
        },
        rowCount: 1,
      },
    });
    expect(JSON.stringify(auditInput)).not.toContain('csv');
    expect(JSON.stringify(auditInput)).not.toContain('R-20260704-001');
    expectNoRawExportLeak(auditInput);
  });
});
