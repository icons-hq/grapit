import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import {
  resolveAdminCapabilitySnapshot,
  type AdminCapability,
  type AdminCapabilityBundle,
  type SettlementExportDataset,
  type SettlementExportRequest,
  type SettlementSummary,
} from '@grabit/shared';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  payments,
  performances,
  refunds,
  reservations,
  showtimes,
  ticketScanEvents,
  tickets,
  users,
} from '../../database/schema/index.js';
import { safeCsvRows } from './csv-export.util.js';
import { AdminAuditService } from './admin-audit.service.js';

const REQUIRED_SETTLEMENT_CAPABILITY = 'settlement.export' as const;
const CONTENT_TYPE = 'text/csv; charset=utf-8' as const;

const DATASET_LABELS = {
  entry_status: 'entry-status',
  no_show_reservations: 'no-show-reservations',
  reservation_payment_refund_summary: 'reservation-payment-refund-summary',
  settlement_accounting_input: '정산-입력-자료',
} as const satisfies Record<SettlementExportDataset, string>;

const DATASET_HEADERS = {
  entry_status: [
    'Reservation Number',
    'Performance Title',
    'Showtime',
    'Ticket Status',
    'Entry Status',
    'Scan Result',
    'Scanned At',
  ],
  no_show_reservations: [
    'Reservation Number',
    'Performance Title',
    'Showtime',
    'Payment Status',
    'Refund Status',
    'Entry Status',
    'Buyer Email Masked',
    'Buyer Phone Masked',
  ],
  reservation_payment_refund_summary: [
    'Reservation Number',
    'Reservation Status',
    'Payment Status',
    'Payment Method',
    'Currency',
    'Paid Amount',
    'Refund Status',
    'Refund Amount',
  ],
  settlement_accounting_input: [
    '정산 입력 자료',
    'Reservation Number',
    'Currency',
    'Gross Sales Amount',
    'Refund Amount',
    'Settlement Amount',
    'Entry Status',
    'No Show Reason',
    'Payment Status',
    'Refund Status',
    'Settlement Memo',
  ],
} as const satisfies Record<SettlementExportDataset, readonly string[]>;

type SettlementFilters = Pick<
  SettlementExportRequest,
  'eventId' | 'showtimeId' | 'dateFrom' | 'dateTo'
>;

export interface SettlementExportActor {
  actorUserId: string;
  role?: string | null;
  bundle?: AdminCapabilityBundle | null;
  capabilities?: readonly string[] | null;
  adminCapabilityBundle?: AdminCapabilityBundle | null;
  adminCapabilities?: readonly string[] | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface SettlementExportResult {
  dataset: SettlementExportDataset;
  filename: string;
  contentType: typeof CONTENT_TYPE;
  csv: string;
  rowCount: number;
  generatedAt: string;
}

type SettlementSourceRow = Record<string, unknown>;

@Injectable()
export class SettlementExportService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  async getSummary(filters: SettlementFilters): Promise<SettlementSummary> {
    validateFilters(filters);

    const rows = await this.selectSettlementRows(filters);
    const generatedAt = new Date().toISOString();
    const aggregate = aggregateSettlementRows(rows);

    return {
      eventId: aggregate.eventId ?? filters.eventId,
      showtimeId: aggregate.showtimeId ?? filters.showtimeId,
      currency: aggregate.currency,
      grossSalesAmount: aggregate.grossSalesAmount,
      paidReservationCount: aggregate.paidReservationCount,
      refundedAmount: aggregate.refundedAmount,
      refundCount: aggregate.refundCount,
      enteredCount: aggregate.enteredCount,
      noShowCount: aggregate.noShowCount,
      entryRate: aggregate.entryRate,
      generatedAt,
    };
  }

  async exportDataset(
    request: SettlementExportRequest,
    actor: SettlementExportActor,
  ): Promise<SettlementExportResult> {
    const reason = request.reason.trim();
    validateFilters(request);

    if (!reason) {
      throw new BadRequestException('정산 내보내기 사유가 필요합니다');
    }

    const filters = settlementFiltersForAudit(request);
    const actorSnapshot = resolveAdminCapabilitySnapshot({
      id: actor.actorUserId,
      role: actor.role ?? null,
      adminCapabilityBundle: actor.adminCapabilityBundle ?? actor.bundle ?? null,
      adminCapabilities: normalizeActorCapabilities(
        actor.adminCapabilities ?? actor.capabilities ?? [],
      ),
    });

    if (
      !actorSnapshot.superuser
      && !actorSnapshot.capabilities.includes(REQUIRED_SETTLEMENT_CAPABILITY)
    ) {
      await this.adminAuditService.write(
        {
          actorUserId: actor.actorUserId,
          action: 'settlement.export',
          resourceType: 'settlement_export',
          resourceId: request.dataset,
          status: 'denied',
          reason,
          changedFields: ['dataset', 'filters', 'requiredCapability', 'actorBundle'],
          before: {},
          after: {
            dataset: request.dataset,
            filters,
            requiredCapability: REQUIRED_SETTLEMENT_CAPABILITY,
            actorBundle: actorSnapshot.bundle,
          },
          ipAddress: actor.ipAddress ?? null,
          userAgent: actor.userAgent ?? null,
          requestId: actor.requestId ?? null,
        },
        this.db,
      );

      throw new ForbiddenException('settlement.export 권한이 필요합니다');
    }

    const rows = await this.selectSettlementRows(request);
    const csvRows = [
      DATASET_HEADERS[request.dataset],
      ...rows.map((row) => datasetRowToCsvValues(request.dataset, row)),
    ];
    const csv = safeCsvRows(csvRows);
    const generatedAt = new Date().toISOString();

    await this.adminAuditService.write(
      {
        actorUserId: actor.actorUserId,
        action: 'settlement.export',
        resourceType: 'settlement_export',
        resourceId: request.dataset,
        status: 'success',
        reason,
        changedFields: ['dataset', 'filters', 'rowCount'],
        before: {},
        after: {
          dataset: request.dataset,
          filters,
          rowCount: rows.length,
        },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      this.db,
    );

    return {
      dataset: request.dataset,
      filename: settlementFilename(request.dataset, request, generatedAt),
      contentType: CONTENT_TYPE,
      csv,
      rowCount: rows.length,
      generatedAt,
    };
  }

  private async selectSettlementRows(
    filters: SettlementFilters,
  ): Promise<SettlementSourceRow[]> {
    const predicates: SQL[] = [eq(performances.id, filters.eventId)];

    if (filters.showtimeId) {
      predicates.push(eq(showtimes.id, filters.showtimeId));
    }
    if (filters.dateFrom) {
      predicates.push(gte(reservations.createdAt, dateOnlyStart(filters.dateFrom)));
    }
    if (filters.dateTo) {
      predicates.push(lte(reservations.createdAt, dateOnlyEnd(filters.dateTo)));
    }

    return this.db
      .select({
        eventId: performances.id,
        performanceTitle: performances.title,
        showtimeId: showtimes.id,
        showtimeAt: showtimes.dateTime,
        reservationId: reservations.id,
        reservationNumber: reservations.reservationNumber,
        reservationStatus: reservations.status,
        totalAmount: reservations.totalAmount,
        reservationCreatedAt: reservations.createdAt,
        buyerEmail: users.email,
        buyerPhone: users.phone,
        paymentId: payments.id,
        paymentStatus: payments.status,
        paymentMethod: payments.method,
        currency: payments.currency,
        paidAmount: payments.amount,
        paidAt: payments.paidAt,
        refundId: refunds.id,
        refundStatus: refunds.status,
        refundCompletedAt: refunds.completedAt,
        ticketId: tickets.id,
        ticketStatus: tickets.status,
        ticketUsedAt: tickets.usedAt,
        scanResult: ticketScanEvents.result,
        syncState: ticketScanEvents.syncState,
        scannedAt: ticketScanEvents.scannedAt,
        rejectionReason: ticketScanEvents.rejectionReason,
      })
      .from(reservations)
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .innerJoin(users, eq(reservations.userId, users.id))
      .leftJoin(payments, eq(payments.reservationId, reservations.id))
      .leftJoin(refunds, eq(refunds.reservationId, reservations.id))
      .leftJoin(tickets, eq(tickets.reservationId, reservations.id))
      .leftJoin(ticketScanEvents, eq(ticketScanEvents.ticketId, tickets.id))
      .where(and(...predicates))
      .orderBy(desc(reservations.createdAt));
  }
}

function validateFilters(filters: SettlementFilters): void {
  if (!filters.eventId?.trim()) {
    throw new BadRequestException('이벤트 ID가 필요합니다');
  }

  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    throw new BadRequestException('조회 종료일은 시작일 이후여야 합니다');
  }
}

function aggregateSettlementRows(rows: SettlementSourceRow[]) {
  const first = rows[0] ?? {};

  if (
    hasNumber(first, 'grossSalesAmount')
    && hasNumber(first, 'paidReservationCount')
    && hasNumber(first, 'refundedAmount')
    && hasNumber(first, 'refundCount')
    && hasNumber(first, 'enteredCount')
    && hasNumber(first, 'noShowCount')
  ) {
    const enteredCount = numberValue(first, 'enteredCount');
    const noShowCount = numberValue(first, 'noShowCount');

    return {
      eventId: stringValue(first, 'eventId') ?? undefined,
      showtimeId: stringValue(first, 'showtimeId') ?? undefined,
      currency: stringValue(first, 'currency') ?? 'KRW',
      grossSalesAmount: numberValue(first, 'grossSalesAmount'),
      paidReservationCount: numberValue(first, 'paidReservationCount'),
      refundedAmount: numberValue(first, 'refundedAmount'),
      refundCount: numberValue(first, 'refundCount'),
      enteredCount,
      noShowCount,
      entryRate: calculateEntryRate(enteredCount, noShowCount),
    };
  }

  const paidReservations = new Set<string>();
  const refundedReservations = new Set<string>();
  const enteredReservations = new Set<string>();
  const countedGrossReservations = new Set<string>();
  let grossSalesAmount = 0;
  let refundedAmount = 0;
  let currency = 'KRW';

  for (const row of rows) {
    const reservationKey = rowKey(row);
    const paymentStatus = stringValue(row, 'paymentStatus');
    const reservationStatus = stringValue(row, 'reservationStatus');
    const refundStatus = stringValue(row, 'refundStatus');
    const rowCurrency = stringValue(row, 'currency');

    if (rowCurrency) {
      currency = rowCurrency;
    }

    if (paymentStatus === 'DONE' || reservationStatus === 'CONFIRMED') {
      paidReservations.add(reservationKey);
    }

    if (!countedGrossReservations.has(reservationKey)) {
      grossSalesAmount += numberValue(row, 'paidAmount')
        || numberValue(row, 'totalAmount');
      countedGrossReservations.add(reservationKey);
    }

    if (refundStatus) {
      refundedReservations.add(reservationKey);
      refundedAmount += numberValue(row, 'refundAmount')
        || numberValue(row, 'paidAmount')
        || numberValue(row, 'totalAmount');
    }

    if (isEnteredRow(row)) {
      enteredReservations.add(reservationKey);
    }
  }

  const enteredCount = enteredReservations.size;
  const refundCount = refundedReservations.size;
  const noShowCount = Math.max(
    paidReservations.size - enteredCount - refundCount,
    0,
  );

  return {
    eventId: stringValue(first, 'eventId') ?? undefined,
    showtimeId: stringValue(first, 'showtimeId') ?? undefined,
    currency,
    grossSalesAmount,
    paidReservationCount: paidReservations.size,
    refundedAmount,
    refundCount,
    enteredCount,
    noShowCount,
    entryRate: calculateEntryRate(enteredCount, noShowCount),
  };
}

function datasetRowToCsvValues(
  dataset: SettlementExportDataset,
  row: SettlementSourceRow,
): readonly unknown[] {
  switch (dataset) {
    case 'entry_status':
      return [
        stringValue(row, 'reservationNumber'),
        stringValue(row, 'performanceTitle'),
        formatDateValue(rowValue(row, 'showtimeAt')),
        stringValue(row, 'ticketStatus'),
        entryStatus(row),
        stringValue(row, 'scanResult'),
        formatDateValue(rowValue(row, 'scannedAt')),
      ];
    case 'no_show_reservations':
      return [
        stringValue(row, 'reservationNumber'),
        stringValue(row, 'performanceTitle'),
        formatDateValue(rowValue(row, 'showtimeAt')),
        stringValue(row, 'paymentStatus'),
        stringValue(row, 'refundStatus') ?? 'NONE',
        entryStatus(row),
        maskEmail(stringValue(row, 'buyerEmail') ?? stringValue(row, 'customerEmail')),
        maskPhone(stringValue(row, 'buyerPhone') ?? stringValue(row, 'customerPhone')),
      ];
    case 'reservation_payment_refund_summary':
      return [
        stringValue(row, 'reservationNumber'),
        stringValue(row, 'reservationStatus'),
        stringValue(row, 'paymentStatus'),
        stringValue(row, 'paymentMethod'),
        stringValue(row, 'currency') ?? 'KRW',
        numberValue(row, 'paidAmount') || numberValue(row, 'totalAmount'),
        stringValue(row, 'refundStatus') ?? 'NONE',
        numberValue(row, 'refundAmount'),
      ];
    case 'settlement_accounting_input':
      return [
        '정산 입력 자료',
        stringValue(row, 'reservationNumber'),
        stringValue(row, 'currency') ?? 'KRW',
        numberValue(row, 'grossSalesAmount')
          || numberValue(row, 'paidAmount')
          || numberValue(row, 'totalAmount'),
        numberValue(row, 'refundAmount'),
        numberValue(row, 'settlementAmount')
          || Math.max(
            (numberValue(row, 'paidAmount') || numberValue(row, 'totalAmount'))
              - numberValue(row, 'refundAmount'),
            0,
          ),
        stringValue(row, 'entryStatus') ?? entryStatus(row),
        stringValue(row, 'noShowReason') ?? '',
        stringValue(row, 'paymentStatus'),
        stringValue(row, 'refundStatus') ?? 'NONE',
        stringValue(row, 'settlementMemo') ?? '',
      ];
  }
}

function entryStatus(row: SettlementSourceRow): string {
  if (isEnteredRow(row)) {
    return 'entered';
  }

  const refundStatus = stringValue(row, 'refundStatus');
  if (refundStatus) {
    return 'refunded_or_cancelled';
  }

  return 'no_show';
}

function isEnteredRow(row: SettlementSourceRow): boolean {
  return (
    stringValue(row, 'entryStatus') === 'entered'
    || stringValue(row, 'scanResult') === 'success'
    || stringValue(row, 'ticketStatus') === 'used'
    || rowValue(row, 'ticketUsedAt') != null
  );
}

function settlementFiltersForAudit(
  request: SettlementExportRequest,
): SettlementFilters {
  return {
    eventId: request.eventId,
    ...(request.showtimeId ? { showtimeId: request.showtimeId } : {}),
    ...(request.dateFrom ? { dateFrom: request.dateFrom } : {}),
    ...(request.dateTo ? { dateTo: request.dateTo } : {}),
  };
}

function settlementFilename(
  dataset: SettlementExportDataset,
  request: SettlementExportRequest,
  generatedAt: string,
): string {
  const date = generatedAt.slice(0, 10);
  const eventPart = sanitizeFilenamePart(request.eventId);
  const showtimePart = request.showtimeId
    ? `-${sanitizeFilenamePart(request.showtimeId)}`
    : '';

  return `${DATASET_LABELS[dataset]}-${dataset}-${eventPart}${showtimePart}-${date}.csv`;
}

function normalizeActorCapabilities(
  capabilities: readonly string[],
): readonly AdminCapability[] {
  return capabilities.filter((capability): capability is AdminCapability =>
    capability === 'event.write'
    || capability === 'event.publish'
    || capability === 'support.manage'
    || capability === 'support.escalate'
    || capability === 'reservations.export_raw'
    || capability === 'seat.disable'
    || capability === 'seat.reactivate'
    || capability === 'seat.manual_open'
    || capability === 'banner.manage'
    || capability === 'audit.read'
    || capability === 'security.manage'
    || capability === 'field.scan.verify'
    || capability === 'field.scan.consume'
    || capability === 'field.scan.sync'
    || capability === 'settlement.export',
  );
}

function dateOnlyStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function dateOnlyEnd(date: string): Date {
  return new Date(`${date}T23:59:59.999Z`);
}

function rowKey(row: SettlementSourceRow): string {
  return (
    stringValue(row, 'reservationId')
    ?? stringValue(row, 'reservationNumber')
    ?? JSON.stringify(row)
  );
}

function rowValue(row: SettlementSourceRow, key: string): unknown {
  return row[key];
}

function stringValue(row: SettlementSourceRow, key: string): string | null {
  const value = rowValue(row, key);
  if (value == null) {
    return null;
  }
  return String(value);
}

function numberValue(row: SettlementSourceRow, key: string): number {
  const value = rowValue(row, key);
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function hasNumber(row: SettlementSourceRow, key: string): boolean {
  return typeof rowValue(row, key) === 'number';
}

function calculateEntryRate(enteredCount: number, noShowCount: number): number {
  const denominator = enteredCount + noShowCount;
  if (denominator === 0) {
    return 0;
  }
  return enteredCount / denominator;
}

function formatDateValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

function maskEmail(email: string | null): string {
  if (!email) {
    return '';
  }

  const [local, domain] = email.split('@');
  if (!local || !domain) {
    return '[masked-email]';
  }

  return `${local.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone: string | null): string {
  if (!phone) {
    return '';
  }

  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) {
    return '****';
  }

  return `${phone.slice(0, 4)}***${digits.slice(-4)}`;
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 80);
}
