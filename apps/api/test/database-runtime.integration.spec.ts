import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, or, sql } from 'drizzle-orm';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { drizzleProvider } from '../src/database/drizzle.provider.js';
import { seatInventories } from '../src/database/schema/seat-inventories.js';
import {
  buildPgBossOptions,
  initializePgBoss,
  loadPgBossConstructor,
  PG_BOSS_JOB_NAMES,
  PgBossInitializationError,
  stopPgBossForShutdown,
  type PgBossContract,
  type StartablePgBoss,
} from '../src/modules/jobs/pgboss.provider.js';

// Disposable database only; never DATABASE_URL.
describe('database runtime hardening (pool errors, pg-boss budget/startup/shutdown, lookup indexes)', () => {
  let container: StartedTestContainer;
  let admin: Pool;
  let closeAdmin: (() => Promise<void>) | undefined;
  let databaseUrl: string;
  const cleanups: Array<() => Promise<void>> = [];

  function config(values: Record<string, string | undefined>) {
    return { get: (key: string) => values[key] } as unknown as Parameters<
      typeof drizzleProvider.useFactory
    >[0];
  }

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'runtime_hardening_test' })
      .withExposedPorts(5432)
      .start();
    databaseUrl = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/runtime_hardening_test`;
    admin = new Pool({ connectionString: databaseUrl, max: 2 });
    closeAdmin = createPostgresPoolCleanup(admin);
    await migrate(drizzle(admin), { migrationsFolder: 'src/database/migrations' });
  }, 120000);

  afterAll(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => undefined);
    }
    await closeAdmin?.();
    await container?.stop();
  });

  it('survives a terminated idle application connection and reconnects (audit #57)', async () => {
    const db = drizzleProvider.useFactory(
      config({ DATABASE_URL: databaseUrl, DB_POOL_MAX: '2', DB_APPLICATION_NAME: 'grabit-it-app' }),
    );
    const appPool = (db as unknown as { $client: Pool }).$client;
    cleanups.push(createPostgresPoolCleanup(appPool));

    await db.execute(sql`select 1`);
    expect(appPool.idleCount).toBe(1);

    const terminated = await admin.query<{ terminated: boolean }>(
      `SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity
       WHERE application_name = 'grabit-it-app' AND pid <> pg_backend_pid()`,
    );
    expect(terminated.rows).toEqual([{ terminated: true }]);

    // Without an `error` listener pg-pool's idle-client error is an uncaught
    // exception that kills the process (and fails this run).
    await vi.waitFor(() => expect(appPool.totalCount).toBe(0), { timeout: 5000 });
    await expect(db.execute(sql`select 1 as ok`)).resolves.toEqual(
      expect.objectContaining({ rows: [{ ok: 1 }] }),
    );
  });

  async function terminateBackends(applicationName: string): Promise<void> {
    const terminated = await admin.query<{ terminated: boolean }>(
      `SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity
       WHERE application_name = $1 AND pid <> pg_backend_pid()`,
      [applicationName],
    );
    expect(terminated.rows).toEqual([{ terminated: true }]);
  }

  it('survives a session terminated while a transaction awaits outside the database (audit #57)', async () => {
    const db = drizzleProvider.useFactory(
      config({ DATABASE_URL: databaseUrl, DB_POOL_MAX: '2', DB_APPLICATION_NAME: 'grabit-it-tx-idle' }),
    );
    const appPool = (db as unknown as { $client: Pool }).$client;
    cleanups.push(createPostgresPoolCleanup(appPool));

    // The checked-out client has no pg-pool idle listener. Without a client
    // `error` listener the session loss is an uncaught exception, which kills
    // the API process (and fails this vitest run as an unhandled error).
    const transaction = db.transaction(async (tx) => {
      await tx.execute(sql`select 1`);
      // Like a confirm/cancel transaction awaiting a Toss call.
      await terminateBackends('grabit-it-tx-idle');
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.execute(sql`select 1`);
    });

    await expect(transaction).rejects.toThrow();
    await vi.waitFor(() => expect(appPool.totalCount).toBe(0), { timeout: 5000 });
    await expect(db.execute(sql`select 1 as ok`)).resolves.toEqual(
      expect.objectContaining({ rows: [{ ok: 1 }] }),
    );
  });

  it('survives a session terminated during an in-flight transaction query (audit #57)', async () => {
    const db = drizzleProvider.useFactory(
      config({ DATABASE_URL: databaseUrl, DB_POOL_MAX: '2', DB_APPLICATION_NAME: 'grabit-it-tx-busy' }),
    );
    const appPool = (db as unknown as { $client: Pool }).$client;
    cleanups.push(createPostgresPoolCleanup(appPool));

    const transaction = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_sleep(10)`);
    });
    await vi.waitFor(async () => {
      const { rows } = await admin.query<{ active: number }>(
        `SELECT count(*)::int AS active FROM pg_stat_activity
         WHERE application_name = 'grabit-it-tx-busy' AND state = 'active'`,
      );
      expect(rows[0]!.active).toBe(1);
    }, { timeout: 5000 });
    await terminateBackends('grabit-it-tx-busy');

    await expect(transaction).rejects.toThrow();
    await vi.waitFor(() => expect(appPool.totalCount).toBe(0), { timeout: 5000 });
    await expect(db.execute(sql`select 1 as ok`)).resolves.toEqual(
      expect.objectContaining({ rows: [{ ok: 1 }] }),
    );
  });

  it('serves reservation_seats and payments lookups from the new indexes (audit #59)', async () => {
    const userId = randomUUID();
    const performanceId = randomUUID();
    const showtimeId = randomUUID();
    await admin.query(
      `INSERT INTO users (id,email,name,phone,gender,birth_date,country,preferred_locale,marketing_consent,is_email_verified,is_phone_verified)
       VALUES ($1,'index-buyer@example.test','Index buyer','+821000000000','unspecified','1990-01-01','KR','ko',false,true,true)`,
      [userId],
    );
    await admin.query(
      `INSERT INTO performances (id,title,genre,start_date,end_date,age_rating,publish_state)
       VALUES ($1,'Index event','artist_celebrity','2099-12-01T10:00:00Z','2099-12-01T12:00:00Z','All ages','published')`,
      [performanceId],
    );
    await admin.query(
      `INSERT INTO showtimes (id,performance_id,date_time) VALUES ($1,$2,'2099-12-01T10:00:00Z')`,
      [showtimeId, performanceId],
    );
    await admin.query(
      `INSERT INTO reservations (user_id,showtime_id,reservation_number,toss_order_id,status,total_amount,cancel_deadline)
       SELECT $1, $2, 'IDX-' || g, 'idx-order-' || g, 'FAILED', 10000, '2099-11-30T00:00:00Z'
       FROM generate_series(1, 20000) AS g`,
      [userId, showtimeId],
    );
    await admin.query(
      `INSERT INTO reservation_seats (reservation_id,seat_id,tier_name,price,row,number)
       SELECT r.id, 'A-' || s, 'VIP', 5000, 'A', s::text
       FROM reservations r CROSS JOIN generate_series(1, 2) AS s`,
    );
    await admin.query(
      `INSERT INTO payments (reservation_id,payment_key,toss_order_id,method,amount,status)
       SELECT r.id, 'idx-key-' || r.reservation_number, r.toss_order_id, 'CARD', 10000, 'DONE'
       FROM reservations r`,
    );
    await admin.query('ANALYZE reservation_seats');
    await admin.query('ANALYZE payments');

    const [{ id: reservationId }] = (
      await admin.query<{ id: string }>(
        `SELECT id FROM reservations WHERE reservation_number = 'IDX-777'`,
      )
    ).rows as [{ id: string }];

    const seatPlan = await admin.query(
      'EXPLAIN (FORMAT JSON) SELECT * FROM reservation_seats WHERE reservation_id = $1',
      [reservationId],
    );
    const seatPlanText = JSON.stringify(seatPlan.rows);
    expect(seatPlanText).toContain('idx_reservation_seats_reservation_id');
    expect(seatPlanText).not.toContain('Seq Scan');

    const paymentPlan = await admin.query(
      'EXPLAIN (FORMAT JSON) SELECT * FROM payments WHERE toss_order_id = $1 OR payment_key = $2',
      ['idx-order-777', 'idx-key-IDX-777'],
    );
    const paymentPlanText = JSON.stringify(paymentPlan.rows);
    expect(paymentPlanText).toContain('idx_payments_toss_order_id');
    expect(paymentPlanText).not.toContain('Seq Scan');
  });

  it('serves the seat status lookup from the existing showtime-prefixed unique index (audit #8 index decision)', async () => {
    // seat_inventories rows exist only for sold/held_cancelled/disabled seats
    // (plus seats released back to available), so a (showtime_id, status)
    // partial index cannot filter much; the showtime_id prefix of the
    // migrated unique index already bounds the scan to one showtime.
    const performanceId = randomUUID();
    await admin.query(
      `INSERT INTO performances (id,title,genre,start_date,end_date,age_rating,publish_state)
       VALUES ($1,'Seat status event','artist_celebrity','2099-12-02T10:00:00Z','2099-12-02T12:00:00Z','All ages','published')`,
      [performanceId],
    );
    await admin.query(
      `INSERT INTO showtimes (performance_id,date_time)
       SELECT $1, '2099-12-02T10:00:00Z'::timestamptz + (g || ' minutes')::interval
       FROM generate_series(1, 100) AS g`,
      [performanceId],
    );
    await admin.query(
      `INSERT INTO seat_inventories (showtime_id,seat_id,floor_key,seat_key,status)
       SELECT s.id, 'A-' || g, '1F', '1F:A-' || g,
         (CASE WHEN g % 100 < 90 THEN 'sold'
               WHEN g % 100 < 93 THEN 'held_cancelled'
               WHEN g % 100 < 95 THEN 'disabled'
               ELSE 'available' END)::seat_status
       FROM generate_series(1, 1000) AS g
       CROSS JOIN (SELECT id FROM showtimes WHERE performance_id = $1) AS s`,
      [performanceId],
    );
    await admin.query('ANALYZE seat_inventories');

    const { rows: [target] } = await admin.query<{ id: string }>(
      'SELECT id FROM showtimes WHERE performance_id = $1 ORDER BY date_time OFFSET 50 LIMIT 1',
      [performanceId],
    );
    // Same predicate as BookingService.getSeatStatus.
    const query = drizzle(admin)
      .select({
        seatId: seatInventories.seatId,
        floorKey: seatInventories.floorKey,
        seatKey: seatInventories.seatKey,
        status: seatInventories.status,
      })
      .from(seatInventories)
      .where(
        and(
          eq(seatInventories.showtimeId, target!.id),
          or(
            eq(seatInventories.status, 'sold'),
            eq(seatInventories.status, 'held_cancelled'),
            eq(seatInventories.status, 'disabled'),
          ),
        ),
      )
      .toSQL();

    const plan = await admin.query(`EXPLAIN (FORMAT JSON) ${query.sql}`, query.params);
    const planText = JSON.stringify(plan.rows);
    expect(planText).toContain('idx_seat_inv_showtime_floor_seat_key');
    expect(planText).not.toContain('Seq Scan');
  });

  describe('pg-boss runtime', () => {
    let boss: PgBossContract | undefined;

    afterAll(async () => {
      if (boss) {
        await boss.stop({ graceful: false }).catch(() => undefined);
      }
    });

    it('retries startup with a fresh instance and closes the failed pool (audit #55)', async () => {
      const PgBoss = loadPgBossConstructor();
      const badUrl = databaseUrl.replace('postgres:test@', 'postgres:wrong@');
      const failed = new PgBoss(buildPgBossOptions(badUrl, true, { max: 3, applicationName: 'grabit-it-pgboss' }));
      const healthy = new PgBoss(buildPgBossOptions(databaseUrl, true, { max: 3, applicationName: 'grabit-it-pgboss' }));
      const created: StartablePgBoss[] = [failed, healthy];

      boss = await initializePgBoss({
        createBoss: () => created.shift()!,
        processesJobs: true,
        maxAttempts: 2,
        required: true,
        sleep: async () => undefined,
      });

      expect(boss).toBe(healthy);
      expect(boss.isAvailable).toBe(true);
      expect(failed.getDb?.()?.opened).toBe(false);
    });

    it('fails a required startup instead of returning a silent unavailable boss (audit #55)', async () => {
      const PgBoss = loadPgBossConstructor();
      const badUrl = databaseUrl.replace('postgres:test@', 'postgres:wrong@');
      const createBoss = vi.fn(
        () => new PgBoss(buildPgBossOptions(badUrl, false, { max: 1, applicationName: 'grabit-it-bad' })),
      );

      await expect(
        initializePgBoss({
          createBoss,
          processesJobs: false,
          maxAttempts: 2,
          required: true,
          sleep: async () => undefined,
        }),
      ).rejects.toBeInstanceOf(PgBossInitializationError);
      expect(createBoss).toHaveBeenCalledTimes(2);
    });

    it('keeps the pg-boss pool within PGBOSS_POOL_MAX under concurrent sends (audit #54)', async () => {
      expect(boss?.isAvailable).toBe(true);
      await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          boss!.send(PG_BOSS_JOB_NAMES.qrTicketEmailResend, { index }, { startAfter: new Date(Date.now() + 3_600_000) }),
        ),
      );

      const pool = (boss as unknown as {
        getDb(): { pool: Pool & { options: { max: number } } };
      }).getDb().pool;
      expect(pool.options.max).toBe(3);
      expect(pool.totalCount).toBeLessThanOrEqual(3);

      const { rows } = await admin.query<{ connections: number }>(
        `SELECT count(*)::int AS connections FROM pg_stat_activity WHERE application_name = 'grabit-it-pgboss'`,
      );
      expect(rows[0]!.connections).toBeGreaterThan(0);
      expect(rows[0]!.connections).toBeLessThanOrEqual(3);
    });

    it('runs a producer-only boss on the default single-connection pool (audit #54)', async () => {
      const PgBoss = loadPgBossConstructor();
      const producerOptions = buildPgBossOptions(databaseUrl, false, {
        applicationName: 'grabit-it-producer-pgboss',
      });
      expect(producerOptions.max).toBe(1);

      const producer = await initializePgBoss({
        createBoss: () => new PgBoss(producerOptions),
        processesJobs: false,
        maxAttempts: 1,
        required: true,
      });
      try {
        const jobIds = await Promise.all(
          Array.from({ length: 20 }, (_, index) =>
            producer.send(PG_BOSS_JOB_NAMES.qrTicketEmailResend, { index }, {
              startAfter: new Date(Date.now() + 3_600_000),
            }),
          ),
        );
        expect(jobIds.every(Boolean)).toBe(true);

        const { rows } = await admin.query<{ connections: number }>(
          `SELECT count(*)::int AS connections FROM pg_stat_activity WHERE application_name = 'grabit-it-producer-pgboss'`,
        );
        expect(rows[0]!.connections).toBe(1);
      } finally {
        await stopPgBossForShutdown(producer, 1_000);
      }
    });

    it('fails an in-flight job back to pg-boss on graceful shutdown instead of leaving it active (audit #153)', async () => {
      let release!: () => void;
      const blocker = new Promise<void>((resolve) => {
        release = resolve;
      });
      let markStarted!: () => void;
      const handlerStarted = new Promise<void>((resolve) => {
        markStarted = resolve;
      });

      await boss!.work(PG_BOSS_JOB_NAMES.refundCancelRetry, async () => {
        markStarted();
        await blocker;
      });
      const jobId = await boss!.send(
        PG_BOSS_JOB_NAMES.refundCancelRetry,
        { refundId: randomUUID(), attempt: 1 },
        { retryLimit: 3, retryDelay: 0 },
      );
      expect(jobId).toBeTruthy();
      await handlerStarted;

      const startedAt = Date.now();
      await stopPgBossForShutdown(boss!, 1_000);
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      expect(boss!.isAvailable).toBe(false);
      // stop(close:false) drained and failed the job; the pool is closed only
      // after the boss was marked unavailable.
      expect((boss as StartablePgBoss).getDb?.()?.opened).toBe(false);
      release();

      const { rows } = await admin.query<{ state: string }>(
        'SELECT state FROM pgboss.job WHERE id = $1',
        [jobId],
      );
      expect(rows[0]?.state).toBeDefined();
      expect(rows[0]!.state).not.toBe('active');
      expect(['retry', 'failed']).toContain(rows[0]!.state);
      boss = undefined;
    });
  });
});
