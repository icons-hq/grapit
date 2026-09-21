import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

describe('Revamp read-only release evidence', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let work: string;
  let connection: string;
  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'grapit' }).withExposedPorts(5432).start();
    connection = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/grapit`;
    pool = new Pool({ connectionString: connection });
    await migrate(drizzle(pool), { migrationsFolder: 'src/database/migrations' });
    work = await mkdtemp(join(tmpdir(), 'grabit-preflight-test-'));
  }, 120000);
  afterAll(async () => { await pool?.end(); await container?.stop(); if (work) await rm(work, { recursive: true, force: true }); });

  async function capture(name: string, baseline?: string) {
    const output = join(work, `${name}.json`);
    // The script's explicit production identity guard is exercised against only
    // this disposable container. No Cloud SQL proxy, secret or network is used.
    const original = new URL(connection);
    original.searchParams.set('host', '/cloudsql/grapit-491806:asia-northeast3:grabit-db-managed-demo');
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [resolve('../../scripts/revamp/production-preflight.mjs'), '--read-only',
        `--proxy-port=${container.getMappedPort(5432)}`, `--output=${output}`, ...(baseline ? [`--baseline=${baseline}`] : [])], {
        env: { ...process.env, REVAMP_PROD_DATABASE_URL: original.toString() }, stdio: 'pipe',
      });
    } catch (error) { exitCode = (error as { status: number }).status; }
    const raw = await readFile(output, 'utf8');
    return { output, raw, data: JSON.parse(raw), exitCode };
  }

  it('keeps evidence private, allows new records, and fails on removed identities or changed original amounts', async () => {
    const buyer = randomUUID(); const event = randomUUID(); const show = randomUUID();
    const reservation = randomUUID(); const payment = randomUUID(); const removable = randomUUID();
    await pool.query(`INSERT INTO users (id,email,name,phone,gender,birth_date)
      VALUES ($1,'preflight-private@example.test','Private buyer','+82100000000','unspecified','1990-01-01')`, [buyer]);
    await pool.query(`INSERT INTO performances (id,title,genre,start_date,end_date,age_rating)
      VALUES ($1,'Preflight event','artist_celebrity','2099-12-01','2099-12-02','All')`, [event]);
    await pool.query(`INSERT INTO showtimes (id,performance_id,date_time) VALUES ($1,$2,'2099-12-01')`, [show, event]);
    await pool.query(`INSERT INTO reservations (id,user_id,showtime_id,reservation_number,toss_order_id,status,total_amount,cancel_deadline)
      VALUES ($1,$2,$3,'PREFLIGHT-ORDER','preflight-order','CONFIRMED',104000,'2099-11-30')`, [reservation, buyer, show]);
    await pool.query(`INSERT INTO payments (id,reservation_id,payment_key,toss_order_id,method,provider,currency,amount,status)
      VALUES ($1,$2,'private-provider-key','preflight-order','CARD','CARD','KRW',104000,'DONE')`, [payment, reservation]);
    await pool.query(`INSERT INTO consent_items (id,key,version,locale,title,body,is_required)
      VALUES ($1,'preflight-consent','v1','en','Original consent','Original wording',false)`, [removable]);

    const before = await capture('before');
    expect(before.exitCode).toBe(0);
    expect(before.data.readOnly).toBe(true);
    for (const privateValue of [buyer, reservation, payment, 'preflight-private@example.test', 'Private buyer', 'private-provider-key']) {
      expect(before.raw).not.toContain(privateValue);
    }
    await pool.query(`UPDATE users SET preferred_locale='th' WHERE id=$1`, [buyer]);
    await pool.query(`INSERT INTO consent_items (key,version,locale,title,body,is_required)
      VALUES ('new-consent','v1','en','New consent','New wording',false)`);
    const changed = await capture('changed', before.output);
    expect(changed.exitCode).toBe(0);
    expect(changed.data.preservationPassed).toBe(true);
    expect(changed.data.comparison.users.originalChanged).toBe(1);
    expect(changed.data.comparison.consent_items.added).toBe(1);

    await pool.query('UPDATE payments SET amount=103999 WHERE id=$1', [payment]);
    await pool.query('DELETE FROM consent_items WHERE id=$1', [removable]);
    const broken = await capture('broken', before.output);
    expect(broken.exitCode).toBe(2);
    expect(broken.data.preservationPassed).toBe(false);
    expect(broken.data.comparison.payments.immutableChanged).toBe(1);
    expect(broken.data.comparison.consent_items.missing).toBe(1);
  }, 30000);
});
