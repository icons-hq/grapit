import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONSENT_DOCUMENT_VERSIONS, SUPPORTED_LOCALES } from '@grabit/shared';

const here = dirname(fileURLToPath(import.meta.url));
const migrationDir = join(here, '../../database/migrations');
const runbookPath = join(here, '../../../../../docs/runbooks/consent-document-versions.md');

/**
 * Replays every journal migration's writes to "consent_items" and tracks
 * `is_active` per (key, version, locale). It understands the statement shapes
 * the migrations use (seed INSERT with ON CONFLICT, UPDATE/DELETE filtered by
 * key/version/locale) and throws on anything else, so a new shape has to be
 * taught here instead of slipping past the guard.
 */
type ConsentItemRows = Map<string, boolean>;
type RowFilter = Partial<Record<'key' | 'version' | 'locale', Set<string>>>;

const SEED_COLUMNS = '("key", "version", "locale", "title", "body", "is_required", "is_active")';
const SEED_TUPLE = /\(\s*'([a-z_]+)',\s*'([^']+)',\s*'([A-Za-z-]+)',\s*'(?:[^']|'')*',\s*'(?:[^']|'')*',\s*(true|false),\s*(true|false)\s*\)/g;
/** Any mention of the table, quoted, unquoted or schema-qualified (not idx_consent_items_*). */
const CONSENT_ITEMS_IDENTIFIER = /\bconsent_items\b/i;

const rowId = (key: string, version: string, locale: string) => `${key}|${version}|${locale}`;

/**
 * Splits SQL on `;` outside string literals, dollar-quoted bodies and `--`
 * comments, so a DO block or function body stays one statement.
 */
function statements(source: string): string[] {
  const result: string[] = [];
  let current = '';
  const push = () => {
    const statement = current.trim();
    if (statement) result.push(statement);
    current = '';
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "'") {
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === "'" && source[end + 1] === "'") end += 2;
        else if (source[end] === "'") { end += 1; break; } else end += 1;
      }
      current += source.slice(index, end);
      index = end;
    } else if (char === '$' && /^\$[A-Za-z_]*\$/.test(source.slice(index))) {
      const tag = source.slice(index).match(/^\$[A-Za-z_]*\$/)![0];
      const close = source.indexOf(tag, index + tag.length);
      const end = close === -1 ? source.length : close + tag.length;
      current += source.slice(index, end);
      index = end;
    } else if (char === '-' && source[index + 1] === '-') {
      const newline = source.indexOf('\n', index);
      index = newline === -1 ? source.length : newline;
    } else if (char === ';') {
      push();
      index += 1;
    } else {
      current += char;
      index += 1;
    }
  }
  push();
  return result;
}

/**
 * Statements that mention consent_items without changing its rows: DDL the
 * migrations already use, a foreign key that references it, and writes to
 * another table that only read it. Everything else naming the table (DO
 * blocks, CTEs, TRUNCATE, schema-qualified writes, triggers) is refused.
 */
function leavesConsentItemRowsUnchanged(statement: string): boolean {
  if (/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"consent_items"\s*\(/i.test(statement)) return true;
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"[a-z_]+"\s+ON\s+"consent_items"\s+USING\s+btree\s*\([^)]*\)$/i.test(statement)) return true;
  const alterColumn = statement.match(/^ALTER\s+TABLE\s+"consent_items"\s+ALTER\s+COLUMN\s+"([a-z_]+)"\s+SET\s+(?:DEFAULT\s+'[^']*'(?:::[\w".]+)?|DATA\s+TYPE\s+[\w".]+(?:\s+USING\s+"([a-z_]+)"::[\w".]+)?)$/i);
  if (alterColumn) {
    const [, column, usingColumn] = alterColumn;
    return column !== 'is_active' && (!usingColumn || usingColumn === column);
  }
  if (/^ALTER\s+TABLE\s+"(?!consent_items")[a-z_]+"\s+ADD\s+CONSTRAINT\s+"[a-z_]+"\s+FOREIGN\s+KEY\s*\([^)]*\)\s+REFERENCES\s+"public"\."consent_items"/i.test(statement)) return true;
  const writeTarget = statement.match(/^(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:"?public"?\.)?"?([a-z_]+)"?/i)?.[1];
  return writeTarget !== undefined && writeTarget.toLowerCase() !== 'consent_items';
}

function unsupported(statement: string): never {
  throw new Error(`consent_items statement not understood by the seed guard; extend it:\n${statement}`);
}

function parseFilter(where: string | undefined, statement: string): RowFilter {
  const filter: RowFilter = {};
  if (!where) return filter;
  for (const condition of where.trim().split(/\s+AND\s+/i)) {
    const equals = condition.trim().match(/^"(key|version|locale)"\s*=\s*'([^']*)'$/);
    const within = condition.trim().match(/^"(key|version|locale)"\s+IN\s*\(([^)]*)\)$/is);
    if (equals) {
      filter[equals[1] as keyof RowFilter] = new Set([equals[2]!]);
    } else if (within) {
      const values = [...within[2]!.matchAll(/'([^']*)'/g)].map((match) => match[1]!);
      filter[within[1] as keyof RowFilter] = new Set(values);
    } else {
      unsupported(statement);
    }
  }
  return filter;
}

function matches(id: string, filter: RowFilter): boolean {
  const [key, version, locale] = id.split('|');
  return (!filter.key || filter.key.has(key!))
    && (!filter.version || filter.version.has(version!))
    && (!filter.locale || filter.locale.has(locale!));
}

function applyInsert(rows: ConsentItemRows, statement: string): void {
  if (!statement.replace(/\s+/g, ' ').includes(SEED_COLUMNS)) unsupported(statement);
  const conflictAt = statement.search(/\bON\s+CONFLICT\b/i);
  const values = statement.slice(statement.search(/\bVALUES\b/i), conflictAt === -1 ? undefined : conflictAt);
  const tuples = [...values.matchAll(SEED_TUPLE)];
  if (tuples.length === 0 || tuples.length !== (values.match(/\(\s*'/g) ?? []).length) unsupported(statement);

  const conflict = statement.match(/\bON\s+CONFLICT\b[\s\S]*$/i)?.[0] ?? '';
  const constantActive = conflict.match(/"is_active"\s*=\s*(true|false)\b/i)?.[1];
  const excludedActive = /"is_active"\s*=\s*EXCLUDED\."is_active"/i.test(conflict);
  if (/"is_active"\s*=/i.test(conflict) && !constantActive && !excludedActive) unsupported(statement);

  for (const [, key, version, locale, , isActive] of tuples) {
    const id = rowId(key!, version!, locale!);
    const inserted = isActive === 'true';
    if (!rows.has(id)) {
      rows.set(id, inserted);
    } else if (excludedActive) {
      rows.set(id, inserted);
    } else if (constantActive) {
      rows.set(id, constantActive.toLowerCase() === 'true');
    } else if (!/DO\s+(?:NOTHING|UPDATE)/i.test(conflict)) {
      throw new Error(`duplicate consent_items row ${id} without ON CONFLICT`);
    }
  }
}

function applyUpdate(rows: ConsentItemRows, statement: string): void {
  const parsed = statement.match(/^UPDATE\s+"consent_items"\s+SET\s+([\s\S]*?)(?:\s+WHERE\s+([\s\S]*))?$/i);
  if (!parsed) unsupported(statement);
  const [, assignments = '', where] = parsed;
  const filter = parseFilter(where, statement);

  const activeAssignment = assignments.match(/"is_active"\s*=\s*([^,\s]+)/i)?.[1];
  if (activeAssignment && !/^(true|false)$/i.test(activeAssignment)) unsupported(statement);
  const renames: Partial<Record<'key' | 'version' | 'locale', string>> = {};
  for (const [, column, value] of assignments.matchAll(/(?:^|,)\s*"(key|version|locale)"\s*=\s*([^,]+)/g)) {
    const literal = value!.trim().match(/^'([^']*)'$/);
    if (!literal) unsupported(statement);
    renames[column as keyof typeof renames] = literal[1];
  }

  for (const [id, isActive] of [...rows]) {
    if (!matches(id, filter)) continue;
    const [key, version, locale] = id.split('|');
    const nextId = rowId(renames.key ?? key!, renames.version ?? version!, renames.locale ?? locale!);
    rows.delete(id);
    rows.set(nextId, activeAssignment ? activeAssignment.toLowerCase() === 'true' : isActive);
  }
}

function applyDelete(rows: ConsentItemRows, statement: string): void {
  const parsed = statement.match(/^DELETE\s+FROM\s+"consent_items"(?:\s+WHERE\s+([\s\S]*))?$/i);
  if (!parsed) unsupported(statement);
  const filter = parseFilter(parsed[1], statement);
  for (const id of [...rows.keys()]) {
    if (matches(id, filter)) rows.delete(id);
  }
}

function replayConsentItems(sources: readonly string[]): ConsentItemRows {
  const rows: ConsentItemRows = new Map();
  for (const source of sources) {
    for (const statement of statements(source)) {
      if (/^INSERT\s+INTO\s+"consent_items"/i.test(statement)) applyInsert(rows, statement);
      else if (/^UPDATE\s+"consent_items"/i.test(statement)) applyUpdate(rows, statement);
      else if (/^DELETE\s+FROM\s+"consent_items"/i.test(statement)) applyDelete(rows, statement);
      else if (CONSENT_ITEMS_IDENTIFIER.test(statement) && !leavesConsentItemRowsUnchanged(statement)) {
        unsupported(statement);
      }
    }
  }
  return rows;
}

function journalMigrationSources(): string[] {
  const journal = JSON.parse(readFileSync(join(migrationDir, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  return journal.entries.map(({ tag }) => readFileSync(join(migrationDir, `${tag}.sql`), 'utf8'));
}

/** Document versions the current web submits that would have no active row. */
function inactiveCurrentVersions(rows: ConsentItemRows): string[] {
  return Object.entries(CONSENT_DOCUMENT_VERSIONS).flatMap(([key, version]) => SUPPORTED_LOCALES
    .map((locale) => rowId(key, version, locale))
    .filter((id) => rows.get(id) !== true));
}

function runbookRetireSql(): string {
  const runbook = readFileSync(runbookPath, 'utf8');
  const block = runbook.match(/```sql\n(-- consent-version-retire[\s\S]*?)```/)?.[1];
  if (!block) throw new Error('consent-version-retire SQL block missing from the runbook');
  return block;
}

describe('consent document seed contract', () => {
  it('keeps an active consent item for every document version the web submits, after all migrations', () => {
    // The web sends CONSENT_DOCUMENT_VERSIONS; without a matching active
    // consent_items row every signup and reservation prepare fails with 400.
    expect(inactiveCurrentVersions(replayConsentItems(journalMigrationSources()))).toEqual([]);
  });

  it('flags a retirement filtered by version alone, which also retires terms and marketing', () => {
    // Versions are per key: '2026-04-28' is still the current terms and marketing
    // version, so this statement would break every signup and booking.
    const rows = replayConsentItems([
      ...journalMigrationSources(),
      `UPDATE "consent_items" SET "is_active" = false, "updated_at" = now() WHERE "version" = '2026-04-28';`,
    ]);

    expect(inactiveCurrentVersions(rows)).toEqual(expect.arrayContaining([
      rowId('terms', '2026-04-28', 'ko'),
      rowId('marketing', '2026-04-28', 'en'),
    ]));
  });

  it('runbook retirement SQL retires only the superseded privacy rows', () => {
    const rows = replayConsentItems([...journalMigrationSources(), runbookRetireSql()]);

    expect(inactiveCurrentVersions(rows)).toEqual([]);
    for (const locale of SUPPORTED_LOCALES) {
      expect(rows.get(rowId('privacy', '2026-04-28', locale)), locale).toBe(false);
      expect(rows.get(rowId('pipa_required', '2026-04-28', locale)), locale).toBe(false);
      expect(rows.get(rowId('terms', '2026-04-28', locale)), locale).toBe(true);
    }
  });

  it('refuses statement shapes it cannot evaluate instead of passing them', () => {
    expect(() => replayConsentItems([
      `UPDATE "consent_items" SET "is_active" = false WHERE "version" = '2026-04-28' OR "key" = 'privacy';`,
    ])).toThrow(/not understood/);
  });

  it('refuses a version-only retirement hidden in a DO block', () => {
    // Statements that do not start with UPDATE/INSERT/DELETE used to pass
    // unread, so this would have retired terms and marketing silently.
    expect(() => replayConsentItems([
      ...journalMigrationSources(),
      `DO $$
BEGIN
  UPDATE consent_items SET is_active = false WHERE version = '2026-04-28';
END $$;`,
    ])).toThrow(/not understood/);
  });

  it.each([
    ['a CTE', `WITH retired AS (UPDATE "consent_items" SET "is_active" = false WHERE "version" = '2026-04-28' RETURNING 1) SELECT count(*) FROM retired;`],
    ['a schema-qualified write', `UPDATE "public"."consent_items" SET "is_active" = false WHERE "version" = '2026-04-28';`],
    ['TRUNCATE', 'TRUNCATE "consent_items" CASCADE;'],
    ['an is_active column rewrite', `ALTER TABLE "consent_items" ALTER COLUMN "is_active" SET DATA TYPE boolean USING false;`],
  ])('refuses %s that touches consent_items', (_label, statement) => {
    expect(() => replayConsentItems([statement])).toThrow(/not understood/);
  });

  it('adds privacy policy v1.2 rows without retiring the version open pages still submit', () => {
    const source = readFileSync(join(migrationDir, '0045_privacy_policy_v1_2_consent_items.sql'), 'utf8');

    expect(source).toContain('ON CONFLICT ("key", "version", "locale") DO NOTHING');
    expect(source).not.toMatch(/UPDATE\s+"consent_items"/i);
    expect(source).not.toMatch(/"is_active"\s*=\s*false/i);
    expect(source).not.toMatch(/DELETE\s+FROM/i);
  });
});
