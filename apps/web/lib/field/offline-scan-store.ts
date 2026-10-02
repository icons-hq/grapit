import { openDB, type IDBPDatabase } from 'idb';
import type { FieldOfflineSyncState } from '@grabit/shared';

const DB_NAME = 'grabit-field-scans';
const DB_VERSION = 1;
const STORE_NAME = 'pendingScanAttempts';
const SHOWTIME_INDEX = 'showtimeId';
const SYNC_STATE_INDEX = 'syncState';

export interface PendingScanAttemptRecord {
  deviceAttemptId: string;
  scannerUserId: string;
  eventId: string;
  showtimeId: string;
  token: string;
  redactedTokenRef: string;
  attemptedAt: string;
  syncState: FieldOfflineSyncState;
  lastSyncAttemptAt?: string | null;
  rejectionReason?: string | null;
  result?: string | null;
  resultLabel?: string | null;
  scanEventId?: string | null;
  resolvedAt?: string | null;
}

interface PendingScanDbSchema {
  [STORE_NAME]: {
    key: string;
    value: PendingScanAttemptRecord;
    indexes: {
      [SHOWTIME_INDEX]: string;
      [SYNC_STATE_INDEX]: FieldOfflineSyncState;
    };
  };
}

type PendingScanDb = IDBPDatabase<PendingScanDbSchema>;

interface PendingScanListFilter {
  scannerUserId?: string;
  showtimeId?: string;
  syncState?: FieldOfflineSyncState;
}

let dbPromise: Promise<PendingScanDb> | null = null;
const memoryRecords = new Map<string, PendingScanAttemptRecord>();

export async function addPendingScanAttempt(
  attempt: PendingScanAttemptRecord,
): Promise<PendingScanAttemptRecord> {
  const record = sanitizePendingAttempt(attempt);
  const db = await getDb();

  if (!db) {
    memoryRecords.set(record.deviceAttemptId, record);
    return record;
  }

  const tx = db.transaction(STORE_NAME, 'readwrite');
  await Promise.all([tx.store.put(record), tx.done]);
  return record;
}

export type AddPendingScanAttemptResult =
  | { status: 'added'; record: PendingScanAttemptRecord }
  | { status: 'duplicate'; existing: PendingScanAttemptRecord };

/**
 * Stores an offline entry only when this device has no unsynced entry for the
 * same QR token. The lookup and write share one IndexedDB readwrite
 * transaction, so tabs racing on the same QR cannot both add a record.
 */
export async function addPendingScanAttemptUnlessTokenPending(
  attempt: PendingScanAttemptRecord,
): Promise<AddPendingScanAttemptResult> {
  const record = sanitizePendingAttempt(attempt);
  const db = await getDb();

  if (!db) {
    const existing = findPendingWithToken(memoryRecords.values(), record.token);
    if (existing) return { status: 'duplicate', existing };
    memoryRecords.set(record.deviceAttemptId, record);
    return { status: 'added', record };
  }

  const tx = db.transaction(STORE_NAME, 'readwrite');
  const pending = await tx.store.index(SYNC_STATE_INDEX).getAll('pending');
  const existing = findPendingWithToken(pending, record.token);
  if (existing) {
    await tx.done;
    return { status: 'duplicate', existing };
  }
  await Promise.all([tx.store.put(record), tx.done]);
  return { status: 'added', record };
}

export async function findPendingScanAttemptByToken(
  token: string,
): Promise<PendingScanAttemptRecord | null> {
  return findPendingWithToken(await listPendingScanAttempts({ syncState: 'pending' }), token);
}

/**
 * Deletes synced/rejected receipts (which no longer hold a QR token) once
 * they are older than the retention window. Unsynced records are kept.
 */
export async function pruneResolvedScanAttempts(
  olderThan: Date,
): Promise<number> {
  const cutoff = olderThan.getTime();
  const isExpired = (record: PendingScanAttemptRecord) => {
    if (record.syncState === 'pending') return false;
    const resolvedAt = Date.parse(record.resolvedAt ?? record.lastSyncAttemptAt ?? record.attemptedAt);
    return Number.isFinite(resolvedAt) && resolvedAt < cutoff;
  };
  const db = await getDb();

  if (!db) {
    let removed = 0;
    for (const record of [...memoryRecords.values()]) {
      if (isExpired(record)) {
        memoryRecords.delete(record.deviceAttemptId);
        removed += 1;
      }
    }
    return removed;
  }

  const tx = db.transaction(STORE_NAME, 'readwrite');
  const expired = (await tx.store.getAll()).filter(isExpired);
  await Promise.all([
    ...expired.map((record) => tx.store.delete(record.deviceAttemptId)),
    tx.done,
  ]);
  return expired.length;
}

export async function listPendingScanAttempts(
  filter: PendingScanListFilter = {},
): Promise<PendingScanAttemptRecord[]> {
  const db = await getDb();

  if (!db) {
    return sortAttempts(filterMemoryRecords(filter));
  }

  if (filter.syncState) {
    const records = await db.getAllFromIndex(
      STORE_NAME,
      SYNC_STATE_INDEX,
      filter.syncState,
    );
    return sortAttempts(filterByScanner(filterByShowtime(records, filter.showtimeId), filter.scannerUserId));
  }

  if (filter.showtimeId) {
    const records = await db.getAllFromIndex(
      STORE_NAME,
      SHOWTIME_INDEX,
      filter.showtimeId,
    );
    return sortAttempts(filterByScanner(records, filter.scannerUserId));
  }

  return sortAttempts(filterByScanner(await db.getAll(STORE_NAME), filter.scannerUserId));
}

export async function updatePendingScanAttempt(
  deviceAttemptId: string,
  patch: Partial<
    Pick<
      PendingScanAttemptRecord,
      | 'syncState'
      | 'lastSyncAttemptAt'
      | 'rejectionReason'
      | 'result'
      | 'resultLabel'
      | 'scanEventId'
      | 'resolvedAt'
    >
  >,
): Promise<PendingScanAttemptRecord | null> {
  const db = await getDb();

  if (!db) {
    const existing = memoryRecords.get(deviceAttemptId);
    if (!existing) {
      return null;
    }
    const updated = mergePendingAttempt(existing, patch);
    memoryRecords.set(deviceAttemptId, updated);
    return updated;
  }

  const tx = db.transaction(STORE_NAME, 'readwrite');
  const existing = await tx.store.get(deviceAttemptId);
  if (!existing) {
    await tx.done;
    return null;
  }

  const updated = mergePendingAttempt(existing, patch);
  await Promise.all([tx.store.put(updated), tx.done]);
  return updated;
}

export async function removePendingScanAttempt(
  deviceAttemptId: string,
): Promise<void> {
  const db = await getDb();

  if (!db) {
    memoryRecords.delete(deviceAttemptId);
    return;
  }

  const tx = db.transaction(STORE_NAME, 'readwrite');
  await Promise.all([tx.store.delete(deviceAttemptId), tx.done]);
}

export async function clearPendingScanAttempts(): Promise<void> {
  const db = await getDb();
  memoryRecords.clear();

  if (!db) {
    return;
  }

  const tx = db.transaction(STORE_NAME, 'readwrite');
  await Promise.all([tx.store.clear(), tx.done]);
}

export function resetOfflineScanStoreForTests(): void {
  dbPromise = null;
  memoryRecords.clear();
}

async function getDb(): Promise<PendingScanDb | null> {
  if (typeof indexedDB === 'undefined') {
    return null;
  }

  dbPromise ??= openDB<PendingScanDbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'deviceAttemptId',
        });
        store.createIndex(SHOWTIME_INDEX, SHOWTIME_INDEX);
        store.createIndex(SYNC_STATE_INDEX, SYNC_STATE_INDEX);
      }
    },
  });

  return dbPromise;
}

function sanitizePendingAttempt(
  attempt: PendingScanAttemptRecord,
): PendingScanAttemptRecord {
  return stripUndefined({
    deviceAttemptId: attempt.deviceAttemptId,
    scannerUserId: attempt.scannerUserId,
    eventId: attempt.eventId,
    showtimeId: attempt.showtimeId,
    token: attempt.syncState === 'pending' ? attempt.token : '',
    redactedTokenRef: attempt.redactedTokenRef,
    attemptedAt: attempt.attemptedAt,
    syncState: attempt.syncState,
    lastSyncAttemptAt: attempt.lastSyncAttemptAt,
    rejectionReason: attempt.rejectionReason,
    result: attempt.result,
    resultLabel: attempt.resultLabel,
    scanEventId: attempt.scanEventId,
    resolvedAt: attempt.resolvedAt,
  });
}

function stripUndefined(
  record: PendingScanAttemptRecord,
): PendingScanAttemptRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as PendingScanAttemptRecord;
}

function filterMemoryRecords(
  filter: PendingScanListFilter,
): PendingScanAttemptRecord[] {
  return filterByShowtime(
    filterByScanner(Array.from(memoryRecords.values()), filter.scannerUserId).filter((record) =>
      filter.syncState ? record.syncState === filter.syncState : true,
    ),
    filter.showtimeId,
  );
}

function filterByShowtime(
  records: PendingScanAttemptRecord[],
  showtimeId?: string,
): PendingScanAttemptRecord[] {
  if (!showtimeId) {
    return records;
  }
  return records.filter((record) => record.showtimeId === showtimeId);
}

function sortAttempts(
  records: PendingScanAttemptRecord[],
): PendingScanAttemptRecord[] {
  return [...records].sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt));
}

function findPendingWithToken(
  records: Iterable<PendingScanAttemptRecord>,
  token: string,
): PendingScanAttemptRecord | null {
  const target = token.trim();
  if (!target) return null;
  for (const record of records) {
    if (record.syncState === 'pending' && record.token.trim() === target) return record;
  }
  return null;
}

function filterByScanner(records: PendingScanAttemptRecord[], scannerUserId?: string): PendingScanAttemptRecord[] {
  return scannerUserId ? records.filter((record) => record.scannerUserId === scannerUserId) : records;
}

function mergePendingAttempt(existing: PendingScanAttemptRecord, patch: Partial<PendingScanAttemptRecord>): PendingScanAttemptRecord {
  // Multiple tabs share IndexedDB. A delayed retry result must not erase a
  // terminal receipt after its credential has already been removed.
  if (existing.syncState !== 'pending' && patch.syncState && patch.syncState !== existing.syncState) return existing;
  return sanitizePendingAttempt({ ...existing, ...patch });
}
