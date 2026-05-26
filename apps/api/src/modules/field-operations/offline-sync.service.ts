import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  FieldCheckInConsumeResponse,
  FieldCheckInOutcome,
  FieldOfflineSyncAttempt,
  FieldOfflineSyncRequest,
  FieldOfflineSyncResponse,
  FieldOfflineSyncResult,
} from '@grabit/shared';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { ticketScanEvents } from '../../database/schema/index.js';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import { FieldCheckInService } from './field-check-in.service.js';

export interface OfflineSyncContext {
  scannerUserId: string;
  recoveredAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

type OfflineSyncDb = Pick<DrizzleDB, 'select' | 'insert' | 'update'>;
type ExistingOfflineResult = {
  id: string;
  result: string;
  syncState: string;
  rejectionReason: string | null;
  scannedAt: Date | string;
};

@Injectable()
export class OfflineSyncService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly fieldCheckInService: FieldCheckInService,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  async syncPendingAttempts(
    request: FieldOfflineSyncRequest,
    context: OfflineSyncContext,
  ): Promise<FieldOfflineSyncResponse> {
    const attempts = dedupePendingAttempts(request.attempts);
    const results: FieldOfflineSyncResult[] = [];

    for (const attempt of attempts) {
      const existingResult = await this.findExistingOfflineResult(attempt.deviceAttemptId);
      if (existingResult) {
        results.push(existingOfflineResultToSyncResult(
          attempt.deviceAttemptId,
          existingResult,
        ));
        continue;
      }

      results.push(await this.resolveAttempt(attempt, context));
    }

    await this.adminAuditService.write(
      {
        actorUserId: context.scannerUserId,
        action: 'field.scan.offline_sync',
        resourceType: 'ticket_scan_events',
        resourceId: context.scannerUserId,
        status: 'success',
        changedFields: ['offlineSync'],
        after: {
          attemptedCount: request.attempts.length,
          pendingCount: attempts.length,
          syncedCount: results.filter((result) => result.syncState === 'synced').length,
          rejectedCount: results.filter((result) => result.syncState === 'rejected').length,
          recoveredAt: context.recoveredAt,
        },
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        requestId: context.requestId ?? null,
      },
      this.db,
    );

    return { results };
  }

  private async resolveAttempt(
    attempt: FieldOfflineSyncAttempt,
    context: OfflineSyncContext,
  ): Promise<FieldOfflineSyncResult> {
    try {
      const consumed = await this.fieldCheckInService.consume(
        {
          token: attempt.token,
          showtimeId: attempt.showtimeId,
          deviceAttemptId: attempt.deviceAttemptId,
          confirmed: true,
        },
        {
          scannerUserId: context.scannerUserId,
          deviceAttemptId: attempt.deviceAttemptId,
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
          requestId: context.requestId ?? null,
          scanSource: 'offline_sync',
        },
      );

      return consumeResponseToSyncResult(
        attempt.deviceAttemptId,
        consumed,
        context.recoveredAt,
      );
    } catch {
      return {
        deviceAttemptId: attempt.deviceAttemptId,
        syncState: 'rejected',
        outcome: 'tampered',
        resolvedAt: context.recoveredAt,
        scanEventId: null,
        reason: 'server re-verification rejected recovered offline attempt',
      };
    }
  }

  private async findExistingOfflineResult(
    deviceAttemptId: string,
    db: OfflineSyncDb = this.db,
  ): Promise<ExistingOfflineResult | null> {
    const selectBuilder = db.select?.({
      id: ticketScanEvents.id,
      result: ticketScanEvents.result,
      syncState: ticketScanEvents.syncState,
      rejectionReason: ticketScanEvents.rejectionReason,
      scannedAt: ticketScanEvents.scannedAt,
    });

    if (!selectBuilder || typeof selectBuilder.from !== 'function') {
      return null;
    }

    const rows = await selectBuilder
      .from(ticketScanEvents)
      .where(
        and(
          eq(ticketScanEvents.deviceAttemptId, deviceAttemptId),
          eq(ticketScanEvents.source, 'offline_sync'),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }
}

function dedupePendingAttempts(
  attempts: readonly FieldOfflineSyncAttempt[],
): FieldOfflineSyncAttempt[] {
  const deduped = new Map<string, FieldOfflineSyncAttempt>();

  for (const attempt of attempts) {
    if (attempt.syncState !== 'pending') {
      continue;
    }

    if (!deduped.has(attempt.deviceAttemptId)) {
      deduped.set(attempt.deviceAttemptId, attempt);
    }
  }

  return [...deduped.values()];
}

function consumeResponseToSyncResult(
  deviceAttemptId: string,
  consumed: FieldCheckInConsumeResponse,
  resolvedAt: string,
): FieldOfflineSyncResult {
  const syncState = consumed.outcome === 'entered' ? 'synced' : 'rejected';

  return {
    deviceAttemptId,
    syncState,
    outcome: consumed.outcome,
    resolvedAt,
    scanEventId: consumed.scanEventId ?? null,
    reason: syncState === 'rejected'
      ? sanitizeReason(consumed.rejectionReason)
      : null,
  };
}

function existingOfflineResultToSyncResult(
  deviceAttemptId: string,
  row: ExistingOfflineResult,
): FieldOfflineSyncResult {
  const syncState = row.syncState === 'synced' || row.result === 'success'
    ? 'synced'
    : 'rejected';

  return {
    deviceAttemptId,
    syncState,
    outcome: scanResultToOutcome(row.result),
    resolvedAt: toIso(row.scannedAt),
    scanEventId: row.id,
    reason: syncState === 'rejected' ? sanitizeReason(row.rejectionReason) : null,
  };
}

function scanResultToOutcome(result: string): FieldCheckInOutcome {
  switch (result) {
    case 'success':
    case 'offline_synced':
      return 'entered';
    case 'duplicate':
    case 'tampered':
    case 'refunded_cancelled':
    case 'expired':
    case 'wrong_showtime':
    case 'already_used':
      return result;
    case 'offline_pending':
      return 'offline_pending';
    default:
      return 'rejected';
  }
}

function sanitizeReason(reason: string | null | undefined): string {
  if (!reason?.trim()) {
    return 'server re-verification rejected recovered offline attempt';
  }

  return reason
    .replace(/eyJ[\w.-]+/g, '[redacted-token]')
    .replace(/\bqr-jti-[\w.-]+/gi, '[redacted-jti]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d -]{8,}\d/g, '[redacted-phone]')
    .slice(0, 500);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
