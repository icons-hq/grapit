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
    return sortAttempts(filterByShowtime(records, filter.showtimeId));
  }

  if (filter.showtimeId) {
    const records = await db.getAllFromIndex(
      STORE_NAME,
      SHOWTIME_INDEX,
      filter.showtimeId,
    );
    return sortAttempts(records);
  }

  return sortAttempts(await db.getAll(STORE_NAME));
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
    const updated = sanitizePendingAttempt({ ...existing, ...patch });
    memoryRecords.set(deviceAttemptId, updated);
    return updated;
  }

  const tx = db.transaction(STORE_NAME, 'readwrite');
  const existing = await tx.store.get(deviceAttemptId);
  if (!existing) {
    await tx.done;
    return null;
  }

  const updated = sanitizePendingAttempt({ ...existing, ...patch });
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
    Array.from(memoryRecords.values()).filter((record) =>
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
