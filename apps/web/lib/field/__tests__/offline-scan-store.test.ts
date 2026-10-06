import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPendingScanAttempt,
  addPendingScanAttemptUnlessTokenPending,
  clearPendingScanAttempts,
  findPendingScanAttemptByToken,
  listPendingScanAttempts,
  pruneResolvedScanAttempts,
  updatePendingScanAttempt,
  type PendingScanAttemptRecord,
} from '../offline-scan-store';

const TOKEN = 'raw-ticket-token-for-offline-dedupe';

function attempt(overrides: Partial<PendingScanAttemptRecord> = {}): PendingScanAttemptRecord {
  return {
    deviceAttemptId: 'attempt-1',
    scannerUserId: 'scanner-user-1',
    eventId: 'event-1',
    showtimeId: 'showtime-1',
    token: TOKEN,
    redactedTokenRef: 'tok_raw-ti...edupe',
    attemptedAt: '2026-10-03T09:00:00.000Z',
    syncState: 'pending',
    ...overrides,
  };
}

beforeEach(async () => {
  await clearPendingScanAttempts();
});

describe('offline pending scan dedupe', () => {
  it('refuses a second unsynced entry for the same QR token', async () => {
    expect((await addPendingScanAttemptUnlessTokenPending(attempt())).status).toBe('added');
    const second = await addPendingScanAttemptUnlessTokenPending(attempt({ deviceAttemptId: 'attempt-2' }));

    expect(second).toEqual({ status: 'duplicate', existing: expect.objectContaining({ deviceAttemptId: 'attempt-1' }) });
    expect(await listPendingScanAttempts()).toHaveLength(1);
  });

  it('keeps one record when two scans of the same QR race', async () => {
    const results = await Promise.all([
      addPendingScanAttemptUnlessTokenPending(attempt({ deviceAttemptId: 'attempt-a' })),
      addPendingScanAttemptUnlessTokenPending(attempt({ deviceAttemptId: 'attempt-b', showtimeId: 'showtime-2' })),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['added', 'duplicate']);
    expect(await listPendingScanAttempts()).toHaveLength(1);
  });

  it('allows the QR again once its earlier entry is resolved by sync', async () => {
    await addPendingScanAttemptUnlessTokenPending(attempt());
    await updatePendingScanAttempt('attempt-1', { syncState: 'rejected', resultLabel: '이미 입장 처리된 티켓입니다' });

    expect(await findPendingScanAttemptByToken(TOKEN)).toBeNull();
    expect((await addPendingScanAttemptUnlessTokenPending(attempt({ deviceAttemptId: 'attempt-2' }))).status).toBe('added');
  });

  it('finds an unsynced entry by token regardless of account or showtime', async () => {
    await addPendingScanAttempt(attempt({ scannerUserId: 'scanner-user-2', showtimeId: 'showtime-9' }));
    expect(await findPendingScanAttemptByToken(` ${TOKEN} `)).toEqual(expect.objectContaining({ deviceAttemptId: 'attempt-1' }));
    expect(await findPendingScanAttemptByToken('another-token')).toBeNull();
    expect(await findPendingScanAttemptByToken('')).toBeNull();
  });
});

describe('resolved receipt retention', () => {
  it('prunes old synced/rejected receipts and never unsynced entries', async () => {
    await addPendingScanAttempt(attempt({ deviceAttemptId: 'old-pending', token: 'pending-token', attemptedAt: '2026-09-01T00:00:00.000Z' }));
    await addPendingScanAttempt(attempt({ deviceAttemptId: 'old-synced', token: 'synced-token', syncState: 'synced', resolvedAt: '2026-09-01T00:00:00.000Z' }));
    await addPendingScanAttempt(attempt({ deviceAttemptId: 'old-rejected', token: 'rejected-token', syncState: 'rejected', lastSyncAttemptAt: '2026-09-02T00:00:00.000Z' }));
    await addPendingScanAttempt(attempt({ deviceAttemptId: 'recent-synced', token: 'recent-token', syncState: 'synced', resolvedAt: '2026-10-02T00:00:00.000Z' }));

    expect(await pruneResolvedScanAttempts(new Date('2026-09-26T00:00:00.000Z'))).toBe(2);
    expect((await listPendingScanAttempts()).map((record) => record.deviceAttemptId).sort())
      .toEqual(['old-pending', 'recent-synced']);
  });
});
