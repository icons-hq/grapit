import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
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
} from '../../database/schema/index.js';

type FieldMonitorDb = Pick<DrizzleDB, 'select'>;

type FieldMonitorSummaryResponse = FieldMonitorSummary & {
  alerts: FieldMonitorAlert[];
  lastUpdatedAt: string;
};

type KpiRow = {
  totalReservations?: number | string | null;
  enteredCount?: number | string | null;
  duplicateScanCount?: number | string | null;
  rejectedScanCount?: number | string | null;
  offlinePendingCount?: number | string | null;
  offlineSyncedCount?: number | string | null;
};

type AlertDirectRow = {
  type: FieldMonitorAlert['type'];
  severity?: FieldMonitorAlert['severity'] | null;
  message?: string | null;
  count?: number | string | null;
  detectedAt?: Date | string | null;
};

type AlertAggregateRow = {
  duplicateSpikeCount?: number | string | null;
  rejectedTamperedCount?: number | string | null;
  refundedCancelledCount?: number | string | null;
  offlineBacklogCount?: number | string | null;
  syncFailureCount?: number | string | null;
  detectedAt?: Date | string | null;
};

type AlertSignalRow = AlertDirectRow | AlertAggregateRow;

type ScanLogDbRow = {
  id?: string | null;
  eventId?: string | null;
  showtimeId?: string | null;
  outcome?: string | null;
  result?: string | null;
  syncState?: string | null;
  scannerUserId?: string | null;
  deviceAttemptId?: string | null;
  redactedTokenRef?: string | null;
  metadata?: Record<string, unknown> | null;
  scannedAt?: Date | string | null;
  rejectionReason?: string | null;
};

const MONITOR_ALERT_THRESHOLDS = {
  // Test contract: duplicate count 5 warns, 12 is critical.
  duplicateWarning: 5,
  duplicateCritical: 10,
  rejectedWarning: 1,
  rejectedCritical: 5,
  refundedCancelledWarning: 1,
  offlineBacklogWarning: 10,
  offlineBacklogCritical: 25,
  syncFailureCritical: 1,
} as const;

@Injectable()
export class FieldMonitorService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async getSummary(input: {
    eventId: string;
    showtimeId: string;
  }): Promise<FieldMonitorSummaryResponse> {
    const [kpiRow] = await this.loadKpis(input, this.db);
    const alertRows = await this.loadAlertSignals(input, this.db);
    const totalTicketItems = toCount(kpiRow?.totalReservations);
    const enteredCount = toCount(kpiRow?.enteredCount);
    const notEnteredCount = Math.max(totalTicketItems - enteredCount, 0);
    const updatedAt = new Date().toISOString();
    const alerts = buildAlerts(alertRows, updatedAt);

    return {
      eventId: input.eventId,
      showtimeId: input.showtimeId,
      enteredCount,
      notEnteredCount,
      entryRate: totalTicketItems > 0 ? roundRate(enteredCount / totalTicketItems) : 0,
      duplicateScanCount: toCount(kpiRow?.duplicateScanCount),
      rejectedScanCount: toCount(kpiRow?.rejectedScanCount),
      offlinePendingCount: toCount(kpiRow?.offlinePendingCount),
      offlineSyncedCount: toCount(kpiRow?.offlineSyncedCount),
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

  private async loadKpis(
    input: { eventId: string; showtimeId: string },
    db: FieldMonitorDb,
  ): Promise<KpiRow[]> {
    return db
      .select({
        totalReservations: sql<number>`count(distinct ${ticketItems.id})::int`,
        enteredCount: sql<number>`count(distinct case when ${ticketItems.admissionState} = 'entered' or ${tickets.usedAt} is not null then ${ticketItems.id} end)::int`,
        duplicateScanCount: sql<number>`count(distinct case when ${ticketScanEvents.result} in ('duplicate', 'already_used') then ${ticketScanEvents.id} end)::int`,
        rejectedScanCount: sql<number>`count(distinct case when ${ticketScanEvents.result} in ('tampered', 'refunded_cancelled', 'expired', 'wrong_showtime', 'offline_rejected', 'sync_failure') then ${ticketScanEvents.id} end)::int`,
        offlinePendingCount: sql<number>`count(distinct case when ${ticketScanEvents.result} = 'offline_pending' or ${ticketScanEvents.syncState} = 'pending' then ${ticketScanEvents.id} end)::int`,
        offlineSyncedCount: sql<number>`count(distinct case when ${ticketScanEvents.result} = 'offline_synced' or ${ticketScanEvents.syncState} = 'synced' then ${ticketScanEvents.id} end)::int`,
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
      .leftJoin(ticketScanEvents, eq(ticketScanEvents.reservationId, reservations.id))
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

  private async loadAlertSignals(
    input: { eventId: string; showtimeId: string },
    db: FieldMonitorDb,
  ): Promise<AlertSignalRow[]> {
    return db
      .select({
        duplicateSpikeCount: sql<number>`coalesce(sum(case when ${ticketScanEvents.result} in ('duplicate', 'already_used') then 1 else 0 end), 0)::int`,
        rejectedTamperedCount: sql<number>`coalesce(sum(case when ${ticketScanEvents.result} in ('tampered', 'expired', 'wrong_showtime', 'offline_rejected') then 1 else 0 end), 0)::int`,
        refundedCancelledCount: sql<number>`coalesce(sum(case when ${ticketScanEvents.result} = 'refunded_cancelled' then 1 else 0 end), 0)::int`,
        offlineBacklogCount: sql<number>`coalesce(sum(case when ${ticketScanEvents.result} = 'offline_pending' or ${ticketScanEvents.syncState} = 'pending' then 1 else 0 end), 0)::int`,
        syncFailureCount: sql<number>`coalesce(sum(case when ${ticketScanEvents.result} = 'sync_failure' or ${ticketScanEvents.syncState} = 'failed' then 1 else 0 end), 0)::int`,
        detectedAt: sql<Date>`coalesce(max(${ticketScanEvents.scannedAt}), now())`,
      })
      .from(ticketScanEvents)
      .innerJoin(showtimes, eq(ticketScanEvents.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .where(
        and(
          eq(performances.id, input.eventId),
          eq(ticketScanEvents.showtimeId, input.showtimeId),
        ),
      );
  }

  private async loadScanLogs(
    filter: FieldMonitorLogFilter,
    db: FieldMonitorDb,
  ): Promise<ScanLogDbRow[]> {
    const conditions = [];
    if (filter.eventId) {
      conditions.push(eq(performances.id, filter.eventId));
    }
    if (filter.showtimeId) {
      conditions.push(eq(ticketScanEvents.showtimeId, filter.showtimeId));
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
      conditions.push(gte(ticketScanEvents.scannedAt, new Date(`${filter.dateFrom}T00:00:00.000Z`)));
    }
    if (filter.dateTo) {
      conditions.push(lte(ticketScanEvents.scannedAt, new Date(`${filter.dateTo}T23:59:59.999Z`)));
    }

    return db
      .select({
        id: ticketScanEvents.id,
        eventId: performances.id,
        showtimeId: ticketScanEvents.showtimeId,
        result: ticketScanEvents.result,
        syncState: ticketScanEvents.syncState,
        scannerUserId: ticketScanEvents.scannerUserId,
        deviceAttemptId: ticketScanEvents.deviceAttemptId,
        metadata: ticketScanEvents.metadata,
        scannedAt: ticketScanEvents.scannedAt,
        rejectionReason: ticketScanEvents.rejectionReason,
      })
      .from(ticketScanEvents)
      .innerJoin(showtimes, eq(ticketScanEvents.showtimeId, showtimes.id))
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ticketScanEvents.scannedAt), desc(ticketScanEvents.id))
      .limit(100);
  }
}

function buildAlerts(
  rows: AlertSignalRow[],
  fallbackDetectedAt: string,
): FieldMonitorAlert[] {
  if (rows.length > 0 && 'type' in rows[0]) {
    return rows
      .filter((row): row is AlertDirectRow =>
        'type' in row && Boolean(row.type),
      )
      .map((row) => normalizeAlertRow(row, fallbackDetectedAt));
  }

  const signal = (rows[0] ?? {}) as AlertAggregateRow;
  return [
    alertFromCount(
      'duplicate_spike',
      toCount(signal.duplicateSpikeCount),
      fallbackDetectedAt,
      'Duplicate scans exceeded baseline',
      MONITOR_ALERT_THRESHOLDS.duplicateWarning,
      MONITOR_ALERT_THRESHOLDS.duplicateCritical,
    ),
    alertFromCount(
      'rejected_tampered_scan',
      toCount(signal.rejectedTamperedCount),
      fallbackDetectedAt,
      'Rejected or tampered scan attempts detected',
      MONITOR_ALERT_THRESHOLDS.rejectedWarning,
      MONITOR_ALERT_THRESHOLDS.rejectedCritical,
    ),
    alertFromCount(
      'refunded_cancelled_attempt',
      toCount(signal.refundedCancelledCount),
      fallbackDetectedAt,
      'Refunded or cancelled ticket scan attempts detected',
      MONITOR_ALERT_THRESHOLDS.refundedCancelledWarning,
      Number.POSITIVE_INFINITY,
    ),
    alertFromCount(
      'offline_backlog',
      toCount(signal.offlineBacklogCount),
      fallbackDetectedAt,
      'Offline pending scan backlog requires sync',
      MONITOR_ALERT_THRESHOLDS.offlineBacklogWarning,
      MONITOR_ALERT_THRESHOLDS.offlineBacklogCritical,
    ),
    alertFromCount(
      'sync_failure',
      toCount(signal.syncFailureCount),
      fallbackDetectedAt,
      'Offline sync failures require operator review',
      MONITOR_ALERT_THRESHOLDS.syncFailureCritical,
      MONITOR_ALERT_THRESHOLDS.syncFailureCritical,
    ),
  ].filter((alert): alert is FieldMonitorAlert => alert !== null);
}

function normalizeAlertRow(
  row: AlertDirectRow,
  fallbackDetectedAt: string,
): FieldMonitorAlert {
  const count = toCount(row.count);
  return {
    type: row.type,
    severity: row.severity ?? severityFor(row.type, count),
    message: row.message?.trim() || messageFor(row.type),
    count,
    detectedAt: toIso(row.detectedAt ?? fallbackDetectedAt),
  };
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

function severityFor(
  type: FieldMonitorAlert['type'],
  count: number,
): FieldMonitorAlert['severity'] {
  switch (type) {
    case 'duplicate_spike':
      return count >= MONITOR_ALERT_THRESHOLDS.duplicateCritical ? 'critical' : 'warning';
    case 'rejected_tampered_scan':
      return count >= MONITOR_ALERT_THRESHOLDS.rejectedCritical ? 'critical' : 'warning';
    case 'offline_backlog':
      return count >= MONITOR_ALERT_THRESHOLDS.offlineBacklogCritical ? 'critical' : 'warning';
    case 'sync_failure':
      return 'critical';
    case 'refunded_cancelled_attempt':
      return 'warning';
  }
}

function messageFor(type: FieldMonitorAlert['type']): string {
  switch (type) {
    case 'duplicate_spike':
      return 'Duplicate scans exceeded baseline';
    case 'rejected_tampered_scan':
      return 'Rejected or tampered scan attempts detected';
    case 'refunded_cancelled_attempt':
      return 'Refunded or cancelled ticket scan attempts detected';
    case 'offline_backlog':
      return 'Offline pending scan backlog requires sync';
    case 'sync_failure':
      return 'Offline sync failures require operator review';
  }
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

function toCount(value: number | string | null | undefined): number {
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
