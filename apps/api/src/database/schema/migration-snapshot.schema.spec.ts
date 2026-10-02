import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { describe, expect, it } from 'vitest';
import * as schema from './index.js';

// Audit #161: drizzle-kit generate diffs the schema against the latest meta snapshot.
// A hand-written migration that changes the schema without refreshing that snapshot
// makes the next generate re-create objects that already exist.
const migrationsDir = resolve(__dirname, '../migrations');

interface Snapshot {
  id: string;
  prevId: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function migrationNumber(name: string): string {
  return name.slice(0, 4);
}

describe('drizzle migration snapshot', () => {
  const journal = readJson<{ entries: Array<{ idx: number; tag: string; when: number }> }>(
    resolve(migrationsDir, 'meta/_journal.json'),
  );
  const snapshotFiles = readdirSync(resolve(migrationsDir, 'meta'))
    .filter((file) => file.endsWith('_snapshot.json'))
    .sort();
  const snapshots = snapshotFiles.map((file) => readJson<Snapshot>(resolve(migrationsDir, 'meta', file)));

  it('keeps journal entries contiguous and ordered', () => {
    journal.entries.forEach((entry, index) => {
      expect(entry.idx).toBe(index);
    });
    const tags = journal.entries.map((entry) => entry.tag);
    expect(new Set(tags).size).toBe(tags.length);
    for (const tag of tags) {
      expect(readdirSync(migrationsDir)).toContain(`${tag}.sql`);
    }
    // drizzle-orm applies a pending migration only when its `when` is newer than the
    // last applied one, so later entries must keep strictly increasing timestamps.
    const recentEntries = journal.entries.slice(
      journal.entries.findIndex((entry) => entry.tag === '0037_field_attempt_context'),
    );
    recentEntries.slice(1).forEach((entry, index) => {
      const previous = recentEntries[index]!;
      expect(entry.when).toBeGreaterThan(previous.when);
      expect(Number(migrationNumber(entry.tag))).toBeGreaterThan(Number(migrationNumber(previous.tag)));
    });
  });

  it('chains every snapshot to the previous one and ends at the latest migration', () => {
    snapshots.forEach((snapshot, index) => {
      const previousId = index === 0 ? '00000000-0000-0000-0000-000000000000' : snapshots[index - 1]!.id;
      expect(snapshot.prevId).toBe(previousId);
    });
    expect(migrationNumber(snapshotFiles.at(-1)!)).toBe(migrationNumber(journal.entries.at(-1)!.tag));
  });

  it('matches the TypeScript schema so drizzle-kit generate has nothing to add', async () => {
    const latest = snapshots.at(-1)!;
    const current = generateDrizzleJson({ ...schema }, latest.id);
    const statements = await generateMigration(
      latest as unknown as Parameters<typeof generateMigration>[0],
      current,
    );
    expect(statements).toEqual([]);
  });
});
