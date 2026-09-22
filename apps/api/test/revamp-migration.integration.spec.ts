import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';

const protectedTables = ['users', 'social_accounts', 'consent_items', 'consent_audit_logs', 'performances', 'showtimes',
  'reservations', 'payments', 'ticket_items', 'tickets', 'ticket_benefit_entitlements', 'ticket_benefit_redemption_records', 'ticket_scan_events'] as const;

// Rehearses 9a6ca20a's migration boundary on a disposable database, never DATABASE_URL.
// SQL fixtures deliberately use only columns that existed before the revamp.
describe('Full revamp migration — existing account, payment and entitlement preservation', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let previousMigrations: string;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'revamp_preservation_test' }).withExposedPorts(5432).start();
    pool = new Pool({ host: container.getHost(), port: container.getMappedPort(5432), user: 'postgres', password: 'test', database: 'revamp_preservation_test' });
    closePool = createPostgresPoolCleanup(pool);
    previousMigrations = await mkdtemp(join(tmpdir(), 'grabit-before-revamp-'));
    const journal = JSON.parse(await readFile('src/database/migrations/meta/_journal.json', 'utf8')) as {
      entries: Array<{ tag: string; idx: number; when: number }>; [key: string]: unknown;
    };
    const boundary = journal.entries.findIndex((entry) => entry.tag === '0033_active_seat_and_benefit_uniqueness');
    expect(boundary).toBe(34);
    const entries = journal.entries.slice(0, boundary + 1);
    await mkdir(join(previousMigrations, 'meta'));
    await writeFile(join(previousMigrations, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    await Promise.all(entries.map((entry) => copyFile(`src/database/migrations/${entry.tag}.sql`, join(previousMigrations, `${entry.tag}.sql`))));
    await migrate(drizzle(pool), { migrationsFolder: previousMigrations });
  }, 120000);
  afterAll(async () => { await closePool?.(); await container?.stop(); if (previousMigrations) await rm(previousMigrations, { recursive: true, force: true }); });

  async function snapshot() {
    const result: Record<string, Array<Record<string, unknown>>> = {};
    for (const table of protectedTables) {
      result[table] = (await pool.query<{ row: Record<string, unknown> }>(`SELECT row_to_json(t) AS row FROM ${table} t ORDER BY id`)).rows.map(({ row }) => row);
    }
    return result;
  }

  it('preserves every original column, identity, amount, consent, QR and benefit through upgrade and repeat migration', async () => {
    const buyer = randomUUID(); const operator = randomUUID(); const consent = randomUUID();
    const event = randomUUID(); const show = randomUUID(); const order = randomUUID(); const payment = randomUUID();
    const enteredItem = randomUUID(); const cancelledItem = randomUUID(); const activeQr = randomUUID(); const revokedQr = randomUUID();
    const redeemedBenefit = randomUUID(); const activeBenefit = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO users (id,email,name,phone,gender,birth_date,country,preferred_locale,marketing_consent,is_email_verified,is_phone_verified)
        VALUES ($1,'migration-buyer@example.test','Existing buyer','+66800000000','unspecified','1990-01-01','TH','th',false,true,true),
        ($2,'migration-operator@example.test','Existing staff','+821000000000','unspecified','1990-01-01','KR','ko',false,true,true)`, [buyer, operator]);
      await client.query(`INSERT INTO social_accounts (user_id,provider,provider_id,provider_email) VALUES ($1,'google','existing-google-link','old-social@example.test')`, [buyer]);
      await client.query(`INSERT INTO consent_items (id,key,version,locale,title,body,is_required) VALUES ($1,'preservation-marketing','v1','en','Marketing','Optional original wording',false)`, [consent]);
      await client.query(`INSERT INTO consent_audit_logs (user_id,consent_item_id,item_key,item_version,language,agreed,ip_address,source_flow)
        VALUES ($1,$2,'preservation-marketing','v1','en',false,'127.0.0.1','signup')`, [buyer, consent]);
      await client.query(`INSERT INTO performances (id,title,genre,start_date,end_date,age_rating,publish_state)
        VALUES ($1,'Existing fan meeting','artist_celebrity','2099-12-01T10:00:00Z','2099-12-01T12:00:00Z','All ages','published')`, [event]);
      await client.query(`INSERT INTO showtimes (id,performance_id,date_time) VALUES ($1,$2,'2099-12-01T10:00:00Z')`, [show, event]);
      await client.query(`INSERT INTO reservations (id,user_id,showtime_id,reservation_number,toss_order_id,status,total_amount,cancel_deadline)
        VALUES ($1,$2,$3,'PRESERVE-ORDER','preserve-order-id','CONFIRMED',104000,'2099-11-30T00:00:00Z')`, [order, buyer, show]);
      await client.query(`INSERT INTO payments (id,reservation_id,payment_key,toss_order_id,method,provider,currency,amount,provider_charge_currency,
        provider_charge_amount_minor,provider_charge_rate,provider_charge_quoted_at,status,paid_at)
        VALUES ($1,$2,'synthetic-preserved-provider-key','preserve-order-id','FOREIGN_EASY_PAY','PAYPAL','KRW',104000,'USD',8000,'1300','2026-09-01T00:00:00Z','DONE','2026-09-01T00:01:00Z')`, [payment, order]);
      await client.query(`INSERT INTO ticket_items (id,reservation_id,payment_id,showtime_id,seat_id,seat_key,floor_key,floor_label,tier_name,row,number,price,service_fee,status,admission_state,entered_at,cancelled_at,cancellation_fee,refundable_amount)
        VALUES ($1,$3,$4,$5,'A-1','1F:A-1','1F','1층','VIP','A','1',50000,2000,'active','entered','2026-09-02T00:00:00Z',null,0,0),
        ($2,$3,$4,$5,'A-2','1F:A-2','1F','1층','VIP','A','2',50000,2000,'cancelled','not_entered',null,'2026-09-02T01:00:00Z',5000,45000)`, [enteredItem, cancelledItem, order, payment, show]);
      await client.query(`INSERT INTO tickets (id,reservation_id,payment_id,showtime_id,ticket_item_id,qr_token_jti,secret_version,status,used_at,revoked_at)
        VALUES ($1,$3,$4,$5,$6,'existing-active-jti','existing-v1','active','2026-09-02T00:00:00Z',null),
        ($2,$3,$4,$5,$7,'existing-revoked-jti','existing-v1','revoked',null,'2026-09-02T01:00:00Z')`, [activeQr, revokedQr, order, payment, show, enteredItem, cancelledItem]);
      const copy = JSON.stringify(Object.fromEntries(['ko','en','th','zh-CN'].map((locale) => [locale, { name: 'Original poster', description: 'Original benefit rights' }])));
      await client.query(`INSERT INTO ticket_benefit_entitlements (id,showtime_id,ticket_item_id,benefit_identity,benefit_kind,display_copy_snapshot,source,state,redeemed_at,redeemed_by_user_id)
        VALUES ($1,$3,$4,'poster','included',$5::jsonb,'configuration','redeemed','2026-09-02T00:10:00Z',$6),
        ($2,$3,$4,'photo','included',$5::jsonb,'configuration','active',null,null)`, [redeemedBenefit, activeBenefit, show, enteredItem, copy, operator]);
      await client.query(`INSERT INTO ticket_benefit_redemption_records (showtime_id,ticket_item_id,benefit_entitlement_id,scanner_user_id,device_attempt_id,redacted_token_ref,result)
        VALUES ($1,$2,$3,$4,'preserved-device-attempt','qr:preserved-redacted-reference','redeemed')`, [show, enteredItem, redeemedBenefit, operator]);
      await client.query(`INSERT INTO ticket_scan_events (ticket_id,ticket_item_id,reservation_id,showtime_id,scanner_user_id,result,source,sync_state,device_attempt_id)
        VALUES ($1,$2,$3,$4,$5,'success','online','not_required','preserved-scan-attempt')`, [activeQr, enteredItem, order, show, operator]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }

    const before = await snapshot();
    await migrate(drizzle(pool), { migrationsFolder: 'src/database/migrations' });
    const after = await snapshot();
    for (const table of protectedTables) {
      const originalRows = before[table]!;
      expect(after[table], table).toHaveLength(originalRows.length);
      originalRows.forEach((row, index) => {
        const retained = Object.fromEntries(Object.keys(row).map((key) => [key, after[table]![index]![key]]));
        expect(retained, `${table}: existing record`).toEqual(row);
      });
    }
    expect((await pool.query('SELECT sum(amount)::int AS amount, sum(provider_charge_amount_minor)::int AS minor FROM payments')).rows[0])
      .toEqual({ amount: 104000, minor: 8000 });
    expect((await pool.query("SELECT count(*)::int AS n FROM tickets WHERE status='active'")).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM ticket_benefit_entitlements WHERE state='redeemed'")).rows[0].n).toBe(1);
    expect((await pool.query('SELECT cancellation_command FROM ticket_items')).rows.every((row) => row.cancellation_command === null)).toBe(true);
    expect((await pool.query('SELECT requested_showtime_id FROM ticket_benefit_redemption_records')).rows[0].requested_showtime_id).toBeNull();
    await migrate(drizzle(pool), { migrationsFolder: 'src/database/migrations' });
    expect(await snapshot()).toEqual(after);
  });
});
