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

  it('summarizes event-level sales, payment, refund, entry, and no-show totals', async () => {
    const { service, db } = createDependencies();
    db.select.mockReturnValueOnce(chainResult([
      {
        eventId: 'event-girl-rules-20260704',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        currency: 'KRW',
        grossSalesAmount: 198000,
        paidReservationCount: 2,
        refundedAmount: 99000,
        refundCount: 1,
        enteredCount: 1,
        noShowCount: 1,
      },
    ]));

    await expect(
      service.getSummary({
        eventId: 'event-girl-rules-20260704',
        showtimeId: '00000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toEqual({
      eventId: 'event-girl-rules-20260704',
      showtimeId: '00000000-0000-4000-8000-000000000001',
      currency: 'KRW',
      grossSalesAmount: 198000,
      paidReservationCount: 2,
      refundedAmount: 99000,
      refundCount: 1,
      enteredCount: 1,
      noShowCount: 1,
      entryRate: 0.5,
      generatedAt: expect.any(String),
    });
  });

  it('falls back to paid amount when summarizing full-reservation refunds without item refundable amount', async () => {
    const { service, db } = createDependencies();
    db.select.mockReturnValueOnce(chainResult([
      {
        eventId: 'event-girl-rules-20260704',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        currency: 'KRW',
        reservationId: 'reservation-full-refund-1',
        reservationNumber: 'R-20260704-REFUND',
        reservationStatus: 'CANCELLED',
        paymentStatus: 'DONE',
        refundStatus: 'completed',
        ticketItemId: 'ticket-item-full-refund-1',
        ticketItemStatus: 'active',
        admissionState: 'not_entered',
        paidAmount: 99000,
        totalAmount: 99000,
        ticketPrice: 0,
        serviceFee: 0,
        refundableAmount: 0,
      },
    ]));

    await expect(
      service.getSummary({
        eventId: 'event-girl-rules-20260704',
        showtimeId: '00000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toMatchObject({
      grossSalesAmount: 99000,
      refundedAmount: 99000,
      refundCount: 1,
    });
  });

  it('falls back to total amount in refund CSV when full-reservation refund has no item refundable amount', async () => {
    const { service, db } = createDependencies();
    db.select.mockReturnValueOnce(chainResult([
      {
        reservationId: 'reservation-full-refund-2',
        reservationNumber: 'R-20260704-TOTAL-FALLBACK',
        reservationStatus: 'CANCELLED',
        paymentStatus: 'DONE',
        refundStatus: 'completed',
        paymentMethod: 'CARD',
        currency: 'KRW',
        ticketItemId: 'ticket-item-full-refund-2',
        ticketItemStatus: 'active',
        admissionState: 'not_entered',
        seatKey: '1F:B-1',
        totalAmount: 88000,
        ticketPrice: 0,
        serviceFee: 0,
        refundableAmount: 0,
      },
    ]));

    const result = await service.exportDataset({
      eventId: 'event-girl-rules-20260704',
      dataset: 'reservation_payment_refund_summary',
      reason: 'post-event full refund reconciliation',
    }, FINANCE_ACTOR);

    expect(result.csv).toContain('"R-20260704-TOTAL-FALLBACK"');
    expect(result.csv).toContain('"completed"');
    expect(result.csv).toContain('"88000"');
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

  it('exports one row per ticket item with item-level cancellation and entry state', async () => {
    const { service, db } = createDependencies();
    db.select.mockReturnValueOnce(chainResult([
      {
        eventId: 'event-girl-rules-20260704',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        performanceTitle: 'Girl Rules Fanmeeting',
        showtimeAt: new Date('2026-07-04T10:00:00.000Z'),
        reservationId: 'reservation-1',
        reservationNumber: 'R-20260704-001',
        reservationStatus: 'CONFIRMED',
        paymentStatus: 'DONE',
        ticketItemId: 'ticket-item-a1',
        seatKey: '1F:A-1',
        ticketItemStatus: 'active',
        admissionState: 'entered',
        enteredAt: new Date('2026-07-04T10:05:00.000Z'),
        ticketPrice: 77000,
        serviceFee: 2000,
        cancellationFee: 0,
        serviceFeeRefund: 0,
        refundableAmount: 0,
        scanResult: 'success',
        scannedAt: new Date('2026-07-04T10:05:00.000Z'),
      },
      {
        eventId: 'event-girl-rules-20260704',
        showtimeId: '00000000-0000-4000-8000-000000000001',
        performanceTitle: 'Girl Rules Fanmeeting',
        showtimeAt: new Date('2026-07-04T10:00:00.000Z'),
        reservationId: 'reservation-1',
        reservationNumber: 'R-20260704-001',
        reservationStatus: 'CONFIRMED',
        paymentStatus: 'DONE',
        ticketItemId: 'ticket-item-a2',
        seatKey: '1F:A-2',
        ticketItemStatus: 'cancelled',
        admissionState: 'not_entered',
        ticketPrice: 77000,
        serviceFee: 2000,
        cancellationFee: 0,
        serviceFeeRefund: 2000,
        refundableAmount: 79000,
        reopenState: 'available',
      },
    ]));

    const result = await service.exportDataset({
      eventId: 'event-girl-rules-20260704',
      showtimeId: '00000000-0000-4000-8000-000000000001',
      dataset: 'entry_status',
      reason: 'post-event settlement reconciliation',
    }, FINANCE_ACTOR);

    expect(result.rowCount).toBe(2);
    expect(result.csv).toContain('"Ticket Item ID"');
    expect(result.csv).toContain('"ticket-item-a1"');
    expect(result.csv).toContain('"ticket-item-a2"');
    expect(result.csv).toContain('"1F:A-1"');
    expect(result.csv).toContain('"1F:A-2"');
    expect(result.csv).toContain('"ACTIVE"');
    expect(result.csv).toContain('"CANCELLED"');
    expect(result.csv).toContain('"ENTERED"');
    expect(result.csv).toContain('"refunded_or_cancelled"');
    expect(result.csv).toContain('"79000"');
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
