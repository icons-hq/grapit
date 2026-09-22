'use client';

import { useCallback, useEffect, useState, useRef, useSyncExternalStore } from 'react';
import { useFieldOfflineSync, type ScannerOfflineQueueItem } from '@/hooks/use-field-operations';
import { addPendingScanAttempt, listPendingScanAttempts, updatePendingScanAttempt, type PendingScanAttemptRecord } from '@/lib/field/offline-scan-store';

function subscribeNetwork(update: () => void) {
  window.addEventListener('online', update); window.addEventListener('offline', update);
  return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
}
export function useFieldOnlineStatus() {
  return useSyncExternalStore(subscribeNetwork, () => navigator.onLine, () => true);
}

export function useFieldOfflineQueue(scannerUserId: string | undefined, showtimeId: string) {
  const scope = `${scannerUserId ?? ''}:${showtimeId}`;
  const [snapshot, setSnapshot] = useState<{ scope: string; items: ScannerOfflineQueueItem[] }>({ scope, items: [] });
  const items = snapshot.scope === scope ? snapshot.items : [];
  const [error, setError] = useState<string | null>(null);
  const mutation = useFieldOfflineSync();
  const syncing = useRef(false);
  const refresh = useCallback(async () => {
    if (!scannerUserId || !showtimeId) { setSnapshot({ scope, items: [] }); return; }
    const records = await listPendingScanAttempts({ scannerUserId, showtimeId });
    setSnapshot({ scope, items: records.map((record) => ({ deviceAttemptId: record.deviceAttemptId, state: record.syncState,
      attemptedAt: record.attemptedAt, reason: record.resultLabel ?? record.rejectionReason ?? null })) });
  }, [scannerUserId, showtimeId, scope]);
  useEffect(() => { void refresh().catch(() => setError('이 기기의 대기 기록을 불러오지 못했습니다. 현장 책임자에게 확인해주세요.')); }, [refresh]);
  const record = async (attempt: PendingScanAttemptRecord) => {
    if (attempt.scannerUserId !== scannerUserId || attempt.showtimeId !== showtimeId) throw new Error('Scanner context changed');
    await addPendingScanAttempt(attempt); await refresh();
  };
  const sync = async () => {
    if (!scannerUserId || !showtimeId || syncing.current) return;
    syncing.current = true;
    setError(null);
    try {
      const pending = (await listPendingScanAttempts({ scannerUserId, showtimeId, syncState: 'pending' })).slice(0, 100);
      if (!pending.length) return;
      const results = await mutation.mutateAsync({ attempts: pending.map((attempt) => ({ deviceAttemptId: attempt.deviceAttemptId,
        scannerUserId, showtimeId, attemptedAt: attempt.attemptedAt, token: attempt.token, redactedTokenRef: attempt.redactedTokenRef,
        syncState: 'pending' as const, lastSyncAttemptAt: new Date().toISOString() })) });
      const expected = new Set(pending.map((attempt) => attempt.deviceAttemptId));
      for (const result of results) {
        if (!expected.has(result.deviceAttemptId)) continue;
        await updatePendingScanAttempt(result.deviceAttemptId, { syncState: result.state, lastSyncAttemptAt: new Date().toISOString(),
          rejectionReason: result.reason ?? null, result: result.result, resultLabel: result.resultLabel,
          scanEventId: result.scanEventId ?? null, resolvedAt: result.resolvedAt ?? null });
      }
      await refresh();
    } catch { setError('동기화를 완료하지 못했습니다. 대기 기록은 유지되며 다시 시도할 수 있습니다.'); }
    finally { syncing.current = false; }
  };
  return { items, error, record, sync, isSyncing: mutation.isPending };
}
