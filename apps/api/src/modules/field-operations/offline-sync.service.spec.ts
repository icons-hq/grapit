import { describe, expect, it, vi } from 'vitest';
import type {
  FieldOfflineSyncAttempt,
  FieldOfflineSyncResponse,
} from '@grabit/shared';

import { OfflineSyncService } from './offline-sync.service.js';

function createDependencies() {
  const fieldCheckInService = {
    consume: vi.fn(),
  };
  const db = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
      }),
    ),
  };
  const adminAuditService = {
    write: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  };

  const service = new OfflineSyncService(
    db as never,
    fieldCheckInService as never,
    adminAuditService as never,
  );

  return { service, fieldCheckInService, db, adminAuditService };
}

const VALID_SHOWTIME_ID = '00000000-0000-4000-8000-000000000001';
const RAW_QR_TOKEN = 'ey.offline.raw-token-with-jti';
const FULL_RAW_JTI = 'qr-jti-offline-full-raw-1234567890';

function pendingAttempt(overrides: Partial<FieldOfflineSyncAttempt> = {}): FieldOfflineSyncAttempt {
  return {
    deviceAttemptId: 'device-attempt-1',
    scannerUserId: 'scanner-user-1',
    showtimeId: VALID_SHOWTIME_ID,
    attemptedAt: '2026-07-04T09:00:00.000Z',
    redactedTokenRef: 'tok_abc...7890',
    syncState: 'pending',
    ...overrides,
  };
}

function expectNoRawOfflineLeak(result: unknown) {
  const serialized = JSON.stringify(result);

  expect(serialized).not.toContain(RAW_QR_TOKEN);
  expect(serialized).not.toContain(FULL_RAW_JTI);
  expect(serialized).not.toContain('rawToken');
  expect(serialized).not.toContain('rawJti');
  expect(serialized).not.toContain('payment key');
  expect(serialized).not.toContain('session=raw-cookie');
  expect(serialized).not.toContain('+821055501234');
  expect(serialized).not.toContain('buyer@example.com');
}

describe('OfflineSyncService RED contract', () => {
  it('syncs pending attempts as server-authoritative synced or rejected outcomes, never final local success', async () => {
    const { service, fieldCheckInService, adminAuditService } = createDependencies();
    fieldCheckInService.consume
      .mockResolvedValueOnce({
        outcome: 'entered',
        scanEventId: 'scan-event-1',
        consumedAt: '2026-07-04T09:10:00.000Z',
        ticket: {
          reservationNumber: 'R-20260704-001',
          performanceTitle: 'Girl Rules FAN MEETING IN SEOUL',
          showtimeId: VALID_SHOWTIME_ID,
          showtimeLabel: '2026-07-04 19:00',
          seatLabels: ['A-1'],
          ticketStatus: 'ACTIVE',
          redactedTokenRef: 'tok_abc...7890',
          maskedJti: 'qr-jti...7890',
        },
      })
      .mockResolvedValueOnce({
        outcome: 'duplicate',
        rejectionReason: 'already entered by prior scanner',
        priorScan: {
          scannedAt: '2026-07-04T09:03:00.000Z',
          scannerUserId: 'scanner-user-prior',
          deviceAttemptId: 'device-attempt-prior',
        },
        ticket: null,
      });

    const result = await service.syncPendingAttempts({
      attempts: [
        pendingAttempt({ deviceAttemptId: 'device-attempt-ok' }),
        pendingAttempt({ deviceAttemptId: 'device-attempt-duplicate' }),
      ],
    }, {
      scannerUserId: 'scanner-user-1',
      recoveredAt: '2026-07-04T09:10:00.000Z',
    });

    expect(result satisfies FieldOfflineSyncResponse).toEqual({
      results: [
        expect.objectContaining({
          deviceAttemptId: 'device-attempt-ok',
          syncState: 'synced',
          outcome: 'entered',
          scanEventId: 'scan-event-1',
        }),
        expect.objectContaining({
          deviceAttemptId: 'device-attempt-duplicate',
          syncState: 'rejected',
          outcome: 'duplicate',
          reason: expect.stringMatching(/prior|already/i),
        }),
      ],
    });
    expect(result.results.map((row) => row.syncState)).not.toContain('success');
    expect(fieldCheckInService.consume).toHaveBeenCalledTimes(2);
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'field.scan.sync',
        status: 'success',
        changedFields: ['offlineSync'],
      }),
      expect.anything(),
    );
    expectNoRawOfflineLeak(result);
  });

  it.each([
    ['duplicate', 'duplicate'],
    ['tampered', 'tampered'],
    ['refunded/cancelled', 'refunded_cancelled'],
    ['expired', 'expired'],
    ['wrong-showtime', 'wrong_showtime'],
  ])('server re-verifies stale recovered connectivity attempt and rejects %s conflicts', async (_label, outcome) => {
    const { service, fieldCheckInService } = createDependencies();
    fieldCheckInService.consume.mockResolvedValue({
      outcome,
      scanEventId: null,
      consumedAt: null,
      ticket: null,
      rejectionReason: 'server re-verification rejected recovered offline attempt',
    });

    const result = await service.syncPendingAttempts({
      attempts: [
        pendingAttempt({
          deviceAttemptId: `device-attempt-${outcome}`,
          attemptedAt: '2026-07-04T08:30:00.000Z',
          lastSyncAttemptAt: '2026-07-04T08:45:00.000Z',
        }),
      ],
    }, {
      scannerUserId: 'scanner-user-1',
      recoveredAt: '2026-07-04T09:30:00.000Z',
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        deviceAttemptId: `device-attempt-${outcome}`,
        syncState: 'rejected',
        outcome,
        reason: expect.stringMatching(/server re-verification/i),
      }),
    ]);
    expectNoRawOfflineLeak(result);
  });

  it('ignores already synced or rejected local rows and only sends pending attempts to the server', async () => {
    const { service, fieldCheckInService } = createDependencies();
    fieldCheckInService.consume.mockResolvedValue({
      outcome: 'entered',
      scanEventId: 'scan-event-1',
      consumedAt: '2026-07-04T09:10:00.000Z',
      ticket: null,
    });

    const result = await service.syncPendingAttempts({
      attempts: [
        pendingAttempt({ deviceAttemptId: 'device-attempt-pending', syncState: 'pending' }),
        pendingAttempt({ deviceAttemptId: 'device-attempt-synced', syncState: 'synced' }),
        pendingAttempt({ deviceAttemptId: 'device-attempt-rejected', syncState: 'rejected' }),
      ],
    }, {
      scannerUserId: 'scanner-user-1',
      recoveredAt: '2026-07-04T09:10:00.000Z',
    });

    expect(fieldCheckInService.consume).toHaveBeenCalledTimes(1);
    expect(fieldCheckInService.consume.mock.calls[0]?.[0]).toMatchObject({
      deviceAttemptId: 'device-attempt-pending',
      confirmed: true,
    });
    expect(result.results).toEqual([
      expect.objectContaining({
        deviceAttemptId: 'device-attempt-pending',
        syncState: 'synced',
      }),
    ]);
  });
});
