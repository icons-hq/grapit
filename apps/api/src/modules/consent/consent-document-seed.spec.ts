import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONSENT_DOCUMENT_VERSIONS, SUPPORTED_LOCALES } from '@grabit/shared';

const migrationDir = join(dirname(fileURLToPath(import.meta.url)), '../../database/migrations');

function seededConsentRows(): Set<string> {
  const journal = JSON.parse(readFileSync(join(migrationDir, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  const rows = new Set<string>();
  for (const { tag } of journal.entries) {
    const source = readFileSync(join(migrationDir, `${tag}.sql`), 'utf8');
    if (!source.includes('INSERT INTO "consent_items"')) continue;
    for (const match of source.matchAll(/\('([a-z_]+)', '(\d{4}-\d{2}-\d{2})', '([A-Za-z-]+)'/g)) {
      rows.add(`${match[1]}|${match[2]}|${match[3]}`);
    }
  }
  return rows;
}

describe('consent document seed contract', () => {
  it('seeds an active consent item for every document version the web submits', () => {
    // The web sends CONSENT_DOCUMENT_VERSIONS; without a matching consent_items row
    // every signup and reservation prepare would fail with 400.
    const rows = seededConsentRows();
    for (const [key, version] of Object.entries(CONSENT_DOCUMENT_VERSIONS)) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(rows.has(`${key}|${version}|${locale}`), `${key} ${version} ${locale}`).toBe(true);
      }
    }
  });

  it('adds privacy policy v1.2 rows without retiring the version open pages still submit', () => {
    const source = readFileSync(join(migrationDir, '0046_privacy_policy_v1_2_consent_items.sql'), 'utf8');

    expect(source).toContain('ON CONFLICT ("key", "version", "locale") DO NOTHING');
    expect(source).not.toMatch(/UPDATE\s+"consent_items"/i);
    expect(source).not.toMatch(/"is_active"\s*=\s*false/i);
    expect(source).not.toMatch(/DELETE\s+FROM/i);
  });
});
