import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  CONSENT_DOCUMENT_VERSIONS,
  SUPPORTED_LOCALES,
} from '@grabit/shared';
import * as schema from '../src/database/schema/index.js';
import { ConsentService } from '../src/modules/consent/consent.service.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';

// Real Postgres: keyset pagination must not skip or repeat rows across equal or
// microsecond-precision timestamps, and the consent seed must match the web.
describe('Consent audit query and document versions on Postgres', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let service: ConsentService;
  const buyer = randomUUID();
  const other = randomUUID();
  const now = new Date('2026-10-01T00:00:00.000Z');

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'consent_audit_test' })
      .withExposedPorts(5432)
      .start();
    pool = new Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      user: 'postgres',
      password: 'test',
      database: 'consent_audit_test',
    });
    closePool = createPostgresPoolCleanup(pool);
    await migrate(drizzle(pool), { migrationsFolder: 'src/database/migrations' });
    service = new ConsentService(drizzle(pool, { schema }));

    await pool.query(
      `INSERT INTO users (id,email,name,phone,gender,birth_date,country)
       VALUES ($1,'audit-buyer@example.test','Buyer','+821012345678','unspecified','1990-01-01','KR'),
              ($2,'audit-other@example.test','Other','+66812345678','unspecified','1990-01-01','TH')`,
      [buyer, other],
    );
  }, 120000);

  afterAll(async () => {
    await closePool?.();
    await container?.stop();
  });

  it('keeps the previous version active next to every version the web presents', async () => {
    const { rows } = await pool.query<{ key: string; version: string; locale: string }>(
      'SELECT key, version, locale::text AS locale FROM consent_items WHERE is_active = true',
    );
    const active = new Set(rows.map((row) => `${row.key}|${row.version}|${row.locale}`));

    for (const [key, version] of Object.entries(CONSENT_DOCUMENT_VERSIONS)) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(active.has(`${key}|${version}|${locale}`), `${key} ${version} ${locale}`).toBe(true);
      }
    }
    for (const key of ['privacy', 'pipa_required']) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(active.has(`${key}|2026-04-28|${locale}`), `${key} 2026-04-28 ${locale}`).toBe(true);
      }
    }
  });

  it('records booking consent on the presented document version and never the unseen PIPA row', async () => {
    const items = (['terms', 'privacy', 'pipa_required'] as const).map((key) => ({
      key,
      version: CONSENT_DOCUMENT_VERSIONS[key],
      language: 'en' as const,
      accepted: true,
      sourceFlow: 'booking' as const,
    }));

    await service.assertRequiredConsents({ items });
    await service.captureConsent(
      buyer,
      { birthDate: '1990-01-01', items, sourceFlow: 'booking' },
      { ipAddress: '198.51.100.7' },
    );

    const { rows } = await pool.query<{ item_key: string; item_version: string; language: string; item_version_seed: string }>(
      `SELECT logs.item_key, logs.item_version, logs.language::text AS language, items.version AS item_version_seed
         FROM consent_audit_logs logs JOIN consent_items items ON items.id = logs.consent_item_id
        WHERE logs.user_id = $1 ORDER BY logs.item_key`,
      [buyer],
    );
    expect(rows).toEqual([
      { item_key: 'privacy', item_version: '2026-05-11', language: 'en', item_version_seed: '2026-05-11' },
      { item_key: 'terms', item_version: '2026-04-28', language: 'en', item_version_seed: '2026-04-28' },
    ]);
    await pool.query('DELETE FROM consent_audit_logs');
  });

  it('pages through every row exactly once, newest first, and bounds unfiltered reads', async () => {
    const [{ id: privacyItem }] = (await pool.query<{ id: string }>(
      "SELECT id FROM consent_items WHERE key='privacy' AND version='2026-05-11' AND locale='ko'",
    )).rows as [{ id: string }];
    const stamps = [
      '2026-09-30T12:00:00.000001Z',
      '2026-09-30T12:00:00.000001Z', // tie: ordered by id
      '2026-09-30T12:00:00.000001Z',
      '2026-09-30T12:00:00.0009Z', // sub-millisecond: a millisecond cursor would skip it
      '2026-09-30T11:59:59Z',
      '2026-09-28T00:00:00Z',
      '2026-09-01T00:00:00Z', // outside the 7-day default window
    ];
    for (const [index, stamp] of stamps.entries()) {
      await pool.query(
        `INSERT INTO consent_audit_logs (user_id,consent_item_id,item_key,item_version,language,agreed,agreed_at,ip_address,source_flow)
         VALUES ($1,$2,'privacy','2026-05-11','ko',true,$3,'203.0.113.10','signup')`,
        [index % 2 === 0 ? buyer : other, privacyItem, stamp],
      );
    }
    const expected = (await pool.query<{ id: string }>(
      "SELECT id FROM consent_audit_logs WHERE agreed_at >= '2026-09-24T00:00:00Z' ORDER BY agreed_at DESC, id DESC",
    )).rows.map((row) => row.id);
    expect(expected).toHaveLength(6);

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await service.queryConsentAudit({ limit: 2, cursor }, now);
      expect(page.items.length).toBeLessThanOrEqual(2);
      expect(page.defaultWindowFrom).toBe('2026-09-24T00:00:00.000Z');
      seen.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);

    expect(seen).toEqual(expected);

    const buyerHistory = await service.queryConsentAudit({ userId: buyer, limit: 500 }, now);
    expect(buyerHistory.defaultWindowFrom).toBeNull();
    expect(buyerHistory.items.map((row) => row.timestamp)).toContain('2026-09-01T00:00:00.000Z');
    expect(JSON.stringify(buyerHistory)).not.toContain('audit-buyer@example.test');
  });
});
