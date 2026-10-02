import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  FieldCheckInOutcome,
  FieldMonitorAlert,
  FieldMonitorLogFilter,
  FieldMonitorLogRow,
  FieldMonitorSummary,
} from '@grabit/shared';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  payments,
  performances,
  reservations,
  showtimes,
  ticketItems,
  ticketScanEvents,
  tickets,
  users,
} from '../../database/schema/index.js';

type FieldMonitorDb = Pick<DrizzleDB, 'select'>;

type FieldMonitorSummaryResponse = FieldMonitorSummary & {
  alerts: FieldMonitorAlert[];
  lastUpdatedAt: string;
};

type CountValue = number | string | null | undefined;
type TimestampValue = Date | string | null | undefined;

type AdmissionCountRow = {
  totalTicketItems?: CountValue;
  enteredCount?: CountValue;
};

/** Scan outcomes attributed to the gate showtime, shared by KPIs and alerts. */
type ScanSignalRow = {
  duplicateScanCount?: CountValue;
  rejectedScanCount?: CountValue;
  rejectedTamperedCount?: CountValue;
  refundedCancelledCount?: CountValue;
  offlineSyncedCount?: CountValue;
  duplicateDetectedAt?: TimestampValue;
  rejectedTamperedDetectedAt?: TimestampValue;
  refundedCancelledDetectedAt?: TimestampValue;
};

type ScanLogDbRow = {
  id?: string | null;
  eventId?: string | null;
  showtimeId?: string | null;
  outcome?: string | null;
  result?: string | null;
  syncState?: string | null;
  scannerUserId?: string | null;
  scannerName?: string | null;
  reservationNumber?: string | null;
  seatLabel?: string | null;
  source?: 'online' | 'offline_sync';
  deviceAttemptId?: string | null;
  redactedTokenRef?: string | null;
  metadata?: Record<string, unknown> | null;
  scannedAt?: Date | string | null;
  rejectionReason?: string | null;
};

// Offline backlog and sync-failure alerts are not produced: pending attempts
// stay on each field device until synced and a failed sync stays pending there,
// so the server has no record to count. Staff check each device's pending list.
const MONITOR_ALERT_THRESHOLDS = {
  // Test contract: duplicate count 5 warns, 12 is critical.
  duplicateWarning: 5,
  duplicateCritical: 10,
  rejectedWarning: 1,
  rejectedCritical: 5,
  refundedCancelledWarning: 1,
} as const;

const DUPLICATE_RESULTS = sql.raw(`('duplicate', 'already_used')`);
const REJECTED_RESULTS = sql.raw(
  `('tampered', 'refunded_cancelled', 'expired', 'wrong_showtime', 'offline_rejected', 'sync_failure')`,
);
const REJECTED_TAMPERED_RESULTS = sql.raw(
  `('tampered', 'expired', 'wrong_showtime', 'offline_rejected')`,
);

/**
 * The showtime whose gate saw the scan: the scanner-selected showtime, or the
 * ticket showtime for rows written before requested_showtime_id existed.
 */
const gateShowtimeId = sql<string>`coalesce(${ticketScanEvents.requestedShowtimeId}, ${ticketScanEvents.showtimeId})`;

/** Index-friendly form of `gateShowtimeId = showtimeId`. */
function scannedAtGateShowtime(showtimeId: string): SQL {
  return or(
    eq(ticketScanEvents.requestedShowtimeId, showtimeId),
    and(isNull(ticketScanEvents.requestedShowtimeId), eq(ticketScanEvents.showtimeId, showtimeId)),
  )!;
}

@Injectable()
export class FieldMonitorService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async getSummary(input: {
    eventId: string;
    showtimeId: string;
  }): Promise<FieldMonitorSummaryResponse> {
    const [admission] = await this.loadAdmissionCounts(input, this.db);
    const [signals] = await this.loadScanSignals(input, this.db);
    const totalTicketItems = toCount(admission?.totalTicketItems);
    const enteredCount = toCount(admission?.enteredCount);
    const notEnteredCount = Math.max(totalTicketItems - enteredCount, 0);
    const updatedAt = new Date().toISOString();
    const alerts = buildAlerts(signals, updatedAt);

    return {
      eventId: input.eventId,
      showtimeId: input.showtimeId,
      enteredCount,
      notEnteredCount,
      entryRate: totalTicketItems > 0 ? roundRate(enteredCount / totalTicketItems) : 0,
      duplicateScanCount: toCount(signals?.duplicateScanCount),
      rejectedScanCount: toCount(signals?.rejectedScanCount),
      // Device-local pending attempts are not visible to the server (see thresholds).
      offlinePendingCount: 0,
      offlineSyncedCount: toCount(signals?.offlineSyncedCount),
      latestAbnormalAlerts: alerts,
      alerts,
      updatedAt,
      lastUpdatedAt: updatedAt,
    };
  }

  async listScanLogs(filter: FieldMonitorLogFilter): Promise<FieldMonitorLogRow[]> {
    const rows = await this.loadScanLogs(filter, this.db);
    return rows.map((row) => toMonitorLogRow(row, filter.eventId));
  }

  /** Admission progress of the showtime's valid Ticket Items. */
  private async loadAdmissionCounts(
    input: { eventId: string; showtimeId: string },
    db: FieldMonitorDb,
  ): Promise<AdmissionCountRow[]> {
    return db
      .select({
        totalTicketItems: sql<number>`count(distinct ${ticketItems.id})::int`,
        enteredCount: sql<number>`count(distinct case when ${ticketItems.admissionState} = 'entered' or ${tickets.usedAt} is not null then ${ticketItems.id} end)::int`,
      })
      .from(reservations)
      .innerJoin(showtimes, eq(reservations.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .innerJoin(payments, eq(payments.reservationId, reservations.id))
      .innerJoin(
        ticketItems,
        and(
          eq(ticketItems.reservationId, reservations.id),
          eq(ticketItems.showtimeId, showtimes.id),
        ),
      )
      .innerJoin(
        tickets,
        and(
          eq(tickets.ticketItemId, ticketItems.id),
          eq(tickets.showtimeId, showtimes.id),
        ),
      )
      .where(
        and(
          eq(performances.id, input.eventId),
          eq(showtimes.id, input.showtimeId),
          eq(reservations.status, 'CONFIRMED'),
          eq(payments.status, 'DONE'),
          eq(ticketItems.status, 'active'),
          eq(tickets.status, 'active'),
        ),
      );
  }

  /**
   * Scan outcomes seen at this showtime's gate, read from the scan ledger alone.
   * Rejections of cancelled tickets, unverifiable QRs and other showtimes' tickets
   * have no valid booking at this showtime, so they must not depend on the
   * admission join above. KPIs and alerts share these counts.
   */
  private async loadScanSignals(
    input: { eventId: string; showtimeId: string },
    db: FieldMonitorDb,
  ): Promise<ScanSignalRow[]> {
    const result = ticketScanEvents.result;
    return db
      .select({
        duplicateScanCount: sql<number>`count(*) filter (where ${result} in ${DUPLICATE_RESULTS})::int`,
        rejectedScanCount: sql<number>`count(*) filter (where ${result} in ${REJECTED_RESULTS})::int`,
        rejectedTamperedCount: sql<number>`count(*) filter (where ${result} in ${REJECTED_TAMPERED_RESULTS})::int`,
        refundedCancelledCount: sql<number>`count(*) filter (where ${result} = 'refunded_cancelled')::int`,
        offlineSyncedCount: sql<number>`count(*) filter (where ${result} = 'offline_synced' or ${ticketScanEvents.syncState} = 'synced')::int`,
        duplicateDetectedAt: sql<Date | null>`max(${ticketScanEvents.scannedAt}) filter (where ${result} in ${DUPLICATE_RESULTS})`.mapWith(ticketScanEvents.scannedAt),
        rejectedTamperedDetectedAt: sql<Date | null>`max(${ticketScanEvents.scannedAt}) filter (where ${result} in ${REJECTED_TAMPERED_RESULTS})`.mapWith(ticketScanEvents.scannedAt),
        refundedCancelledDetectedAt: sql<Date | null>`max(${ticketScanEvents.scannedAt}) filter (where ${result} = 'refunded_cancelled')`.mapWith(ticketScanEvents.scannedAt),
      })
      .from(ticketScanEvents)
      .innerJoin(showtimes, eq(showtimes.id, input.showtimeId))
      .where(
        and(
          eq(showtimes.performanceId, input.eventId),
          scannedAtGateShowtime(input.showtimeId),
        ),
      );
  }

  private async loadScanLogs(
    filter: FieldMonitorLogFilter,
    db: FieldMonitorDb,
  ): Promise<ScanLogDbRow[]> {
    const gateShowtimes = alias(showtimes, 'gate_showtimes');
    const conditions = [];
    if (filter.eventId) {
      conditions.push(eq(gateShowtimes.performanceId, filter.eventId));
    }
    if (filter.showtimeId) {
      conditions.push(scannedAtGateShowtime(filter.showtimeId));
    }
    if (filter.outcome) {
      conditions.push(sql`${ticketScanEvents.result} = any(${resultValuesForOutcome(filter.outcome)})`);
    }
    if (filter.syncState) {
      conditions.push(eq(ticketScanEvents.syncState, syncStateForFilter(filter.syncState)));
    }
    if (filter.scannerUserId) {
      conditions.push(eq(ticketScanEvents.scannerUserId, filter.scannerUserId));
    }
    if (filter.dateFrom) {
      conditions.push(gte(ticketScanEvents.scannedAt, new Date(`${filter.dateFrom}T00:00:00.000+09:00`)));
    }
    if (filter.dateTo) {
      conditions.push(lte(ticketScanEvents.scannedAt, new Date(`${filter.dateTo}T23:59:59.999+09:00`)));
    }

    return db
      .select({
        id: ticketScanEvents.id,
        eventId: gateShowtimes.performanceId,
        showtimeId: gateShowtimeId,
        result: ticketScanEvents.result,
        syncState: ticketScanEvents.syncState,
        scannerUserId: ticketScanEvents.scannerUserId,
        scannerName: users.name,
        reservationNumber: reservations.reservationNumber,
        seatLabel: sql<string | null>`case when ${ticketItems.id} is null then null else concat(${ticketItems.floorLabel}, ' · ', ${ticketItems.tierName}, ' · ', ${ticketItems.row}, '-', ${ticketItems.number}) end`,
        source: ticketScanEvents.source,
        deviceAttemptId: ticketScanEvents.deviceAttemptId,
        metadata: ticketScanEvents.metadata,
        scannedAt: ticketScanEvents.scannedAt,
        rejectionReason: ticketScanEvents.rejectionReason,
      })
      .from(ticketScanEvents)
      .leftJoin(gateShowtimes, eq(gateShowtimes.id, gateShowtimeId))
      // Unverifiable QR scans have no booking; keep them in the log.
      .leftJoin(reservations, eq(ticketScanEvents.reservationId, reservations.id))
      .innerJoin(users, eq(ticketScanEvents.scannerUserId, users.id))
      .leftJoin(ticketItems, eq(ticketScanEvents.ticketItemId, ticketItems.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ticketScanEvents.scannedAt), desc(ticketScanEvents.id))
      .limit(100);
  }
}

function buildAlerts(
  signal: ScanSignalRow | undefined,
  fallbackDetectedAt: string,
): FieldMonitorAlert[] {
  const detectedAt = (value: TimestampValue) =>
    value ? toIso(value) : fallbackDetectedAt;

  return [
    alertFromCount(
      'duplicate_spike',
      toCount(signal?.duplicateScanCount),
      detectedAt(signal?.duplicateDetectedAt),
      'Duplicate scans exceeded baseline',
      MONITOR_ALERT_THRESHOLDS.duplicateWarning,
      MONITOR_ALERT_THRESHOLDS.duplicateCritical,
    ),
    alertFromCount(
      'rejected_tampered_scan',
      toCount(signal?.rejectedTamperedCount),
      detectedAt(signal?.rejectedTamperedDetectedAt),
      'Rejected or tampered scan attempts detected',
      MONITOR_ALERT_THRESHOLDS.rejectedWarning,
      MONITOR_ALERT_THRESHOLDS.rejectedCritical,
    ),
    alertFromCount(
      'refunded_cancelled_attempt',
      toCount(signal?.refundedCancelledCount),
      detectedAt(signal?.refundedCancelledDetectedAt),
      'Refunded or cancelled ticket scan attempts detected',
      MONITOR_ALERT_THRESHOLDS.refundedCancelledWarning,
      Number.POSITIVE_INFINITY,
    ),
  ].filter((alert): alert is FieldMonitorAlert => alert !== null);
}

function alertFromCount(
  type: FieldMonitorAlert['type'],
  count: number,
  detectedAt: string,
  message: string,
  warningThreshold: number,
  criticalThreshold: number,
): FieldMonitorAlert | null {
  if (count < warningThreshold) {
    return null;
  }

  return {
    type,
    severity: count >= criticalThreshold ? 'critical' : 'warning',
    message,
    count,
    detectedAt,
  };
}

function toMonitorLogRow(
  row: ScanLogDbRow,
  fallbackEventId?: string,
): FieldMonitorLogRow {
  const metadata = row.metadata ?? {};
  const redactedTokenRef = row.redactedTokenRef
    ?? (typeof metadata.redactedTokenRef === 'string' ? metadata.redactedTokenRef : null)
    ?? 'redacted';

  return {
    id: row.id ?? 'unknown-scan-event',
    eventId: row.eventId ?? fallbackEventId ?? 'unknown-event',
    showtimeId: row.showtimeId ?? '00000000-0000-4000-8000-000000000000',
    outcome: outcomeForResult(row.outcome ?? row.result),
    syncState: syncStateForLog(row.syncState),
    scannerUserId: row.scannerUserId ?? 'unknown-scanner',
    scannerName: row.scannerName ?? null,
    reservationNumber: row.reservationNumber ?? null,
    seatLabel: row.seatLabel ?? null,
    ...(row.source ? { source: row.source } : {}),
    deviceAttemptId: row.deviceAttemptId ?? null,
    redactedTokenRef,
    scannedAt: toIso(row.scannedAt ?? new Date()),
    rejectionReason: sanitizeReason(row.rejectionReason),
  };
}

function outcomeForResult(result: string | null | undefined): FieldCheckInOutcome {
  switch (result) {
    case 'success':
    case 'offline_synced':
      return 'entered';
    case 'offline_rejected':
    case 'sync_failure':
      return 'rejected';
    case 'offline_pending':
      return 'offline_pending';
    case 'refunded_cancelled':
    case 'duplicate':
    case 'tampered':
    case 'expired':
    case 'wrong_showtime':
    case 'already_used':
    case 'processable':
    case 'entered':
    case 'synced':
    case 'rejected':
      return result;
    default:
      return 'rejected';
  }
}

function syncStateForLog(
  syncState: string | null | undefined,
): FieldMonitorLogRow['syncState'] {
  switch (syncState) {
    case 'pending':
    case 'synced':
    case 'rejected':
      return syncState;
    case 'failed':
      return 'rejected';
    default:
      return null;
  }
}

function syncStateForFilter(syncState: 'pending' | 'synced' | 'rejected') {
  return syncState;
}

function resultValuesForOutcome(outcome: FieldCheckInOutcome): string[] {
  switch (outcome) {
    case 'entered':
      return ['success', 'offline_synced'];
    case 'synced':
      return ['offline_synced'];
    case 'rejected':
      return ['offline_rejected', 'sync_failure'];
    case 'offline_pending':
      return ['offline_pending'];
    case 'processable':
      return ['success'];
    default:
      return [outcome];
  }
}

function sanitizeReason(reason: string | null | undefined): string | null {
  return reason?.trim() ? reason.trim().slice(0, 200) : null;
}

function toCount(value: CountValue): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function roundRate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
