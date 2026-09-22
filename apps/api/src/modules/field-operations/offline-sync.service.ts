import { HttpException, Inject, Injectable } from '@nestjs/common';
import type {
  FieldCheckInConsumeResponse,
  FieldOfflineSyncAttempt,
  FieldOfflineSyncRequest,
  FieldOfflineSyncResponse,
  FieldOfflineSyncResult,
} from '@grabit/shared';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import { FieldCheckInService } from './field-check-in.service.js';

export interface OfflineSyncContext {
  scannerUserId: string;
  recoveredAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

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
    if (attempt.scannerUserId !== context.scannerUserId) {
      return { deviceAttemptId: attempt.deviceAttemptId, syncState: 'rejected', outcome: 'rejected',
        resolvedAt: context.recoveredAt, scanEventId: null, reason: '이 기록을 저장한 현장 계정으로 로그인해주세요.' };
    }
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
    } catch (error) {
      const denied = error instanceof HttpException && error.getStatus() < 500;
      return {
        deviceAttemptId: attempt.deviceAttemptId,
        syncState: denied ? 'rejected' : 'pending',
        outcome: denied ? 'rejected' : 'offline_pending',
        resolvedAt: context.recoveredAt,
        scanEventId: null,
        reason: denied ? '요청을 확인할 수 없습니다. 현장 책임자에게 확인해주세요.' : '서버 확인이 끝나지 않았습니다. 연결을 확인하고 다시 동기화해주세요.',
      };
    }
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
