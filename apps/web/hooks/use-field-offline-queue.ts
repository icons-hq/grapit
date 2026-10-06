'use client';

import { useCallback, useEffect, useState, useRef, useSyncExternalStore } from 'react';
import { useFieldOfflineSync, type ScannerOfflineQueueItem } from '@/hooks/use-field-operations';
import {
  addPendingScanAttemptUnlessTokenPending,
  listPendingScanAttempts,
  pruneResolvedScanAttempts,
  updatePendingScanAttempt,
  type PendingScanAttemptRecord,
} from '@/lib/field/offline-scan-store';

const SYNC_BATCH_SIZE = 100;
const SYNC_LOCK_NAME = 'grabit-field-offline-sync';
export const RESOLVED_SCAN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const SYNC_BUSY_MESSAGE = '다른 탭에서 동기화 중입니다. 잠시 뒤 다시 시도하세요.';

function subscribeNetwork(update: () => void) {
  window.addEventListener('online', update); window.addEventListener('offline', update);
  return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
}
export function useFieldOnlineStatus() {
  return useSyncExternalStore(subscribeNetwork, () => navigator.onLine, () => true);
}

/** Unsynced entries on this device, grouped by the account and showtime that saved them. */
export interface FieldDevicePendingGroup {
  scannerUserId: string;
  showtimeId: string;
  eventId: string;
  count: number;
  oldestAttemptedAt: string;
}

export type FieldPendingRecordOutcome = 'added' | 'duplicate';

interface UseFieldOfflineQueueOptions {
  /** Sync this scanner's unsynced entries automatically when the device is online. */
  autoSync?: boolean;
}

export function useFieldOfflineQueue(
  scannerUserId: string | undefined,
  showtimeId: string,
  { autoSync = false }: UseFieldOfflineQueueOptions = {},
) {
  const scope = `${scannerUserId ?? ''}:${showtimeId}`;
  const [snapshot, setSnapshot] = useState<{ scope: string; items: ScannerOfflineQueueItem[] }>({ scope, items: [] });
  const items = snapshot.scope === scope ? snapshot.items : [];
  const [devicePending, setDevicePending] = useState<FieldDevicePendingGroup[]>([]);
  // Bumped on every reload of the device queue, including changes written by
  // other tabs, so a screen can re-check its QR against the queue.
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync, isPending: isSyncing } = useFieldOfflineSync();
  const syncing = useRef(false);
  // A sync started before the showtime was restored or changed finishes with a
  // refresh. It must reload the showtime on screen now, not the one it started for.
  const latestScope = useRef({ scannerUserId, showtimeId });
  useEffect(() => { latestScope.current = { scannerUserId, showtimeId }; }, [scannerUserId, showtimeId]);

  const refresh = useCallback(async () => {
    const target = latestScope.current;
    // Every unsynced record on this device stays visible, whichever account or
    // showtime saved it, so switching showtime or account cannot hide it.
    const devicePendingRecords = await listPendingScanAttempts({ syncState: 'pending' });
    const records = target.scannerUserId && target.showtimeId
      ? await listPendingScanAttempts({ scannerUserId: target.scannerUserId, showtimeId: target.showtimeId })
      : [];
    // The showtime or account changed meanwhile; the refresh started for it wins.
    if (latestScope.current !== target) return;
    setDevicePending(groupDevicePending(devicePendingRecords));
    setSnapshot({ scope: `${target.scannerUserId ?? ''}:${target.showtimeId}`, items: records.map(toQueueItem) });
    setRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    void pruneResolvedScanAttempts(new Date(Date.now() - RESOLVED_SCAN_RETENTION_MS)).catch(() => undefined);
  }, []);
  useEffect(() => {
    void refresh().catch(() => setError('이 기기의 대기 기록을 불러오지 못했습니다. 현장 책임자에게 확인해주세요.'));
  }, [refresh, scope]);
  useEffect(() => {
    // Other tabs (each OS camera scan opens one) write to the same IndexedDB.
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh().catch(() => undefined); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const record = async (attempt: PendingScanAttemptRecord): Promise<FieldPendingRecordOutcome> => {
    if (attempt.scannerUserId !== scannerUserId || attempt.showtimeId !== showtimeId) throw new Error('Scanner context changed');
    const result = await addPendingScanAttemptUnlessTokenPending(attempt);
    await refresh();
    return result.status;
  };

  const sync = useCallback(async ({ reportBusy = true }: { reportBusy?: boolean } = {}) => {
    if (!scannerUserId || syncing.current) return;
    syncing.current = true;
    setError(null);
    try {
      const ran = await withDeviceSyncLock(async () => {
        // The server rejects another account's records permanently, so only
        // this scanner's records are sent; every showtime is included.
        const pending = await listPendingScanAttempts({ scannerUserId, syncState: 'pending' });
        let failed = false;
        for (let start = 0; start < pending.length; start += SYNC_BATCH_SIZE) {
          const batch = pending.slice(start, start + SYNC_BATCH_SIZE);
          try {
            const results = await mutateAsync({ attempts: batch.map((attempt) => ({ deviceAttemptId: attempt.deviceAttemptId,
              scannerUserId, showtimeId: attempt.showtimeId, attemptedAt: attempt.attemptedAt, token: attempt.token,
              redactedTokenRef: attempt.redactedTokenRef, syncState: 'pending' as const, lastSyncAttemptAt: new Date().toISOString() })) });
            const expected = new Set(batch.map((attempt) => attempt.deviceAttemptId));
            for (const result of results) {
              if (!expected.has(result.deviceAttemptId)) continue;
              await updatePendingScanAttempt(result.deviceAttemptId, { syncState: result.state, lastSyncAttemptAt: new Date().toISOString(),
                rejectionReason: result.reason ?? null, result: result.result, resultLabel: result.resultLabel,
                scanEventId: result.scanEventId ?? null, resolvedAt: result.resolvedAt ?? null });
            }
          } catch {
            failed = true;
          }
        }
        if (failed) setError('동기화를 완료하지 못했습니다. 대기 기록은 유지되며 다시 시도할 수 있습니다.');
      });
      // A staff-initiated sync must not end silently while another tab, possibly
      // a frozen background tab, holds the device lock.
      if (!ran && reportBusy) setError(SYNC_BUSY_MESSAGE);
    } catch {
      setError('동기화를 완료하지 못했습니다. 대기 기록은 유지되며 다시 시도할 수 있습니다.');
    } finally {
      syncing.current = false;
      await refresh().catch(() => undefined);
    }
  }, [mutateAsync, refresh, scannerUserId]);

  useEffect(() => {
    if (!autoSync || !scannerUserId) return;
    const syncWhenOnline = () => {
      if (navigator.onLine) void sync({ reportBusy: false });
    };
    // Covers a page opened after recovery as well as recovery while open.
    syncWhenOnline();
    window.addEventListener('online', syncWhenOnline);
    return () => window.removeEventListener('online', syncWhenOnline);
  }, [autoSync, scannerUserId, sync]);

  return { items, devicePending, revision, error, record, sync, refresh, isSyncing };
}

function toQueueItem(record: PendingScanAttemptRecord): ScannerOfflineQueueItem {
  return {
    deviceAttemptId: record.deviceAttemptId,
    state: record.syncState,
    attemptedAt: record.attemptedAt,
    seatLabel: record.seatLabel ?? null,
    reason: record.resultLabel ?? record.rejectionReason ?? null,
    result: record.result ?? null,
    resultLabel: record.resultLabel ?? null,
    rejectionReason: record.rejectionReason ?? null,
  };
}

function groupDevicePending(records: readonly PendingScanAttemptRecord[]): FieldDevicePendingGroup[] {
  const groups = new Map<string, FieldDevicePendingGroup>();
  for (const record of records) {
    if (record.syncState !== 'pending') continue;
    const key = `${record.scannerUserId}:${record.showtimeId}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      if (record.attemptedAt < group.oldestAttemptedAt) group.oldestAttemptedAt = record.attemptedAt;
    } else {
      groups.set(key, { scannerUserId: record.scannerUserId, showtimeId: record.showtimeId, eventId: record.eventId,
        count: 1, oldestAttemptedAt: record.attemptedAt });
    }
  }
  return [...groups.values()].sort((a, b) => a.oldestAttemptedAt.localeCompare(b.oldestAttemptedAt));
}

/**
 * Runs the task under the device-wide sync lock and reports whether it ran.
 * Tabs on one device share the queue. When another tab already holds the lock
 * it is syncing the same records, so this tab skips instead of waiting.
 */
async function withDeviceSyncLock(task: () => Promise<void>): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) {
    await task();
    return true;
  }
  let ran = false;
  await locks.request(SYNC_LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    ran = true;
    await task();
  });
  return ran;
}
