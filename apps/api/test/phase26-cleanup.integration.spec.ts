import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { StartedTestContainer } from 'testcontainers';
import { startPostgresContainer } from './helpers/postgres-container.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

// Runs the legacy Phase 26 cleanup SQL with the real psql client inside a
// disposable PostgreSQL container. No shared or production database is used.
const SQL_DIR = resolve('../../scripts/phase26');
const CONFIRMATIONS = {
  backupConfirmation: 'PHASE26_BACKUP_RESTORE_POINT_CONFIRMED',
  dryRunReviewed: 'PHASE26_DRY_RUN_REVIEWED',
  ownerApproval: 'PHASE26_OWNER_APPROVED_TEST_EVENT_CLEANUP',
};

describe('Phase 26 test-event cleanup guard', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let buyer: string;

  beforeAll(async () => {
    const postgres = await startPostgresContainer({
      database: 'grapit',
      copyFilesToContainer: [
        { source: `${SQL_DIR}/cleanup-dry-run.sql`, target: '/sql/cleanup-dry-run.sql' },
        { source: `${SQL_DIR}/cleanup-test-event.sql`, target: '/sql/cleanup-test-event.sql' },
      ],
    });
    container = postgres.container;
    pool = new Pool({ connectionString: postgres.connectionString });
    await migrate(drizzle(pool), { migrationsFolder: 'src/database/migrations' });
    buyer = randomUUID();
    await pool.query(`INSERT INTO users (id,email,name,phone,gender,birth_date)
      VALUES ($1,'cleanup-buyer@example.test','Cleanup buyer','+82100000000','unspecified','1990-01-01')`, [buyer]);
  }, 120000);
  afterAll(async () => { await pool?.end(); await container?.stop(); });

  async function event(input: { title: string; description?: string; publishState?: string; bookingStartsAt?: string | null }) {
    const performanceId = randomUUID(); const showtimeId = randomUUID();
    await pool.query(`INSERT INTO performances (id,title,description,genre,start_date,end_date,age_rating,publish_state)
      VALUES ($1,$2,$3,'artist_celebrity','2099-12-01','2099-12-02','All',$4)`,
    [performanceId, input.title, input.description ?? null, input.publishState ?? 'review']);
    await pool.query('INSERT INTO showtimes (id,performance_id,date_time) VALUES ($1,$2,$3)', [showtimeId, performanceId, '2099-12-01T11:00:00Z']);
    if (input.bookingStartsAt !== undefined) {
      await pool.query('INSERT INTO booking_policies (performance_id,booking_starts_at) VALUES ($1,$2)', [performanceId, input.bookingStartsAt]);
    }
    return { performanceId, showtimeId };
  }

  async function reservation(showtimeId: string, orderId: string) {
    await pool.query(`INSERT INTO reservations (id,user_id,showtime_id,reservation_number,toss_order_id,status,total_amount,cancel_deadline)
      VALUES ($1,$2,$3,$4,$5,'CANCELLED',52000,'2099-11-30')`, [randomUUID(), buyer, showtimeId, orderId.slice(0, 28), orderId]);
  }

  async function psql(file: string, variables: Record<string, string | number>) {
    const vars = Object.entries(variables).flatMap(([key, value]) => ['-v', `${key}=${value}`]);
    const result = await container.exec(['psql', '-U', 'postgres', '-d', 'grapit', '-X', ...vars, '-f', `/sql/${file}`]);
    return { exitCode: result.exitCode, output: `${result.stdout}\n${result.stderr}` };
  }

  function execution(target: { performanceId: string; showtimeId: string }, marker: string, expectedReservations: number) {
    return psql('cleanup-test-event.sql', {
      performanceId: target.performanceId, showtimeId: target.showtimeId, orderPrefix: 'PHASE26_ORD-', testMarker: marker,
      ...CONFIRMATIONS, expectedReservations, expectedPayments: 0, expectedTickets: 0, expectedRefunds: 0,
      expectedWebhookEvents: 0, expectedSeatInventories: 0,
    });
  }

  async function showtimeExists(showtimeId: string) {
    return (await pool.query('SELECT 1 FROM showtimes WHERE id=$1', [showtimeId])).rowCount === 1;
  }

  it('refuses a pre-sale real performance identified only by a substring marker', async () => {
    const real = await event({ title: 'Greatest Hits Live', description: 'The greatest hits contest night', bookingStartsAt: null });
    for (const marker of ['greatest', 'contest']) {
      const dryRun = await psql('cleanup-dry-run.sql', { ...real, orderPrefix: 'PHASE26_ORD-', testMarker: marker });
      expect(dryRun.exitCode).not.toBe(0);
      expect(dryRun.output).toContain('test marker must match');
      const run = await execution(real, marker, 0);
      expect(run.exitCode).not.toBe(0);
      expect(run.output).toContain('test marker must match');
    }
    // A well-formed marker that is only mentioned in the real description is still refused.
    const mentioned = await event({ title: 'Greatest Hits Live', description: 'see PHASE26_TEST-20261002 notes' });
    const run = await execution(mentioned, 'PHASE26_TEST-20261002', 0);
    expect(run.output).toContain('performance title must start with the dedicated test marker');
    expect(await showtimeExists(real.showtimeId)).toBe(true);
    expect(await showtimeExists(mentioned.showtimeId)).toBe(true);
  });

  it('refuses a marker-titled performance that is published or has a future booking opening', async () => {
    const marker = 'PHASE26_TEST-PUBLISHED';
    const published = await event({ title: `${marker} event`, publishState: 'published' });
    expect((await execution(published, marker, 0)).output).toContain('performance is published');
    const scheduled = await event({ title: `${marker} event`, bookingStartsAt: '2099-01-01T00:00:00Z' });
    const dryRun = await psql('cleanup-dry-run.sql', { ...scheduled, orderPrefix: 'PHASE26_ORD-', testMarker: marker });
    expect(dryRun.output).toContain('scheduled future booking opening');
    expect((await execution(scheduled, marker, 0)).output).toContain('scheduled future booking opening');
    expect(await showtimeExists(published.showtimeId)).toBe(true);
    expect(await showtimeExists(scheduled.showtimeId)).toBe(true);
  });

  it('matches order prefixes literally and cleans only a positively identified, unpublished test event', async () => {
    const marker = 'PHASE26_TEST-20261002';
    const target = await event({ title: `${marker} load rehearsal`, bookingStartsAt: '2020-01-01T00:00:00Z' });
    await reservation(target.showtimeId, `PHASE26_ORD-${randomUUID()}`);
    // `_` is a LIKE wildcard: this real-looking order would have matched `PHASE26_ORD-%`.
    await reservation(target.showtimeId, `PHASE26XORD-${randomUUID()}`);
    const trapped = await execution(target, marker, 2);
    expect(trapped.exitCode).not.toBe(0);
    expect(trapped.output).toContain('unexpected production rows are in scope');
    expect(await showtimeExists(target.showtimeId)).toBe(true);

    await pool.query(`DELETE FROM reservations WHERE showtime_id=$1 AND toss_order_id LIKE 'PHASE26XORD-%'`, [target.showtimeId]);
    const cleaned = await execution(target, marker, 1);
    expect(cleaned.output).toContain('PHASE26 cleanup execution committed');
    expect(cleaned.exitCode).toBe(0);
    expect(await showtimeExists(target.showtimeId)).toBe(false);
    expect((await pool.query('SELECT 1 FROM performances WHERE id=$1', [target.performanceId])).rowCount).toBe(1);
  });
});
