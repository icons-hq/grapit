import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { StartedTestContainer } from 'testcontainers';
import { startPostgresContainer } from './helpers/postgres-container.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { UserRepository } from '../src/modules/user/user.repository.js';
import { QueueService } from '../src/modules/queue/queue.service.js';

// Runs scripts/phase26/provision-load-buyers.mjs against a disposable
// PostgreSQL 16 with the real migrations, then checks the pool with the API's
// own token and browser-identity code. No shared or production database is used.
const SCRIPT = resolve('../../scripts/phase26/provision-load-buyers.mjs');
const SECRET = 'phase26-integration-jwt-secret-5c1e';
const APPROVAL = 'PHASE26_DEDICATED_TEST_EVENT_APPROVED';

type PoolUser = { accessToken: string; refreshToken: string };

describe('Phase 26 synthetic load buyers', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: DrizzleDB;
  let databaseUrl: string;
  let dir: string;
  let strategy: JwtStrategy;
  let queue: QueueService;
  const realUserId = randomUUID();
  const realRefreshToken = 'real-buyer-refresh-token';

  beforeAll(async () => {
    const postgres = await startPostgresContainer({ database: 'grapit' });
    container = postgres.container;
    databaseUrl = postgres.connectionString;
    pool = new Pool({ connectionString: databaseUrl });
    await migrate(drizzle(pool), { migrationsFolder: 'src/database/migrations' });
    db = drizzle(pool, { schema }) as unknown as DrizzleDB;
    strategy = new JwtStrategy(new ConfigService({ auth: { jwtSecret: SECRET } }), new UserRepository(db));
    // resolveBrowserIdentity reads PostgreSQL only.
    queue = new QueueService(null as never, db, null as never);
    dir = await mkdtemp(join(tmpdir(), 'phase26-load-buyers-'));

    await pool.query(`INSERT INTO users (id,email,password_hash,name,phone,gender,birth_date,is_phone_verified,is_email_verified)
      VALUES ($1,'real-buyer@example.test','argon-hash','Real buyer','+821012345678','female','1990-01-01',true,true)`, [realUserId]);
    await pool.query(`INSERT INTO refresh_tokens (user_id,token_hash,family,expires_at)
      VALUES ($1,$2,'real-family',now() + interval '7 days')`,
    [realUserId, createHash('sha256').update(realRefreshToken).digest('hex')]);
  }, 120000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  function run(args: string[], env: Record<string, string> = {}) {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      env: {
        PATH: process.env.PATH ?? '',
        PHASE26_LOAD_APPROVED: APPROVAL,
        PHASE26_TARGET_DATABASE_URL: databaseUrl,
        PHASE26_TARGET_JWT_SECRET: SECRET,
        ...env,
      },
      encoding: 'utf8',
      timeout: 60000,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).not.toContain(SECRET);
    expect(output).not.toContain(databaseUrl);
    return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  async function provision(name: string, count: number, validFor = '2h') {
    const out = join(dir, name);
    const result = run(['provision', '--count', String(count), '--out', out, '--valid-for', validFor]);
    return { ...result, out };
  }

  async function readPool(out: string): Promise<PoolUser[]> {
    return JSON.parse(await readFile(out, 'utf8')) as PoolUser[];
  }

  // The same path passport-jwt takes for every Bearer request: extract,
  // verify signature and exp with JWT_SECRET, then JwtStrategy.validate().
  function authenticate(accessToken: string) {
    return new Promise<Record<string, unknown>>((resolveUser, reject) => {
      const passport = strategy as unknown as {
        success: (user: Record<string, unknown>) => void;
        fail: (info: unknown) => void;
        error: (error: unknown) => void;
        authenticate: (req: unknown) => void;
      };
      passport.success = resolveUser;
      passport.fail = (info) => reject(new Error(`rejected: ${String((info as Error)?.message ?? info)}`));
      passport.error = reject;
      passport.authenticate({ headers: { authorization: `Bearer ${accessToken}` } });
    });
  }

  function subjectOf(accessToken: string): string {
    return JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()).sub as string;
  }

  it('provisions buyers the API authenticates as verified users with a queue browser identity', async () => {
    const result = await provision('first.json', 3);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ command: 'provision', buyers: 3, created: 3, reused: 0, revokedRefreshTokens: 0 });
    expect((await stat(result.out)).mode & 0o777).toBe(0o600);
    const users = await readPool(result.out);
    expect(users).toHaveLength(3);

    for (const user of users) {
      const authenticated = await authenticate(user.accessToken);
      expect(authenticated).toMatchObject({ role: 'user', isEmailVerified: true, isPhoneVerified: true, adminCapabilities: [] });
      expect(authenticated.id).toBe(subjectOf(user.accessToken));
      const identity = await queue.resolveBrowserIdentity(authenticated.id as string, user.refreshToken);
      expect(identity.refreshTokenFamilyId).toBe(identity.deviceSlotId);
    }
    const { rows } = await pool.query(`SELECT u.email, u.password_hash, u.phone, r.token_hash, r.expires_at
      FROM users u JOIN refresh_tokens r ON r.user_id = u.id WHERE u.email LIKE 'phase26-buyer-%' ORDER BY u.email`);
    expect(rows.map((row) => row.email)).toEqual([1, 2, 3].map((n) => `phase26-buyer-00000${n}@phase26-load.invalid`));
    expect(rows.every((row) => row.password_hash === null)).toBe(true);
    expect(rows.map((row) => row.token_hash)).toEqual(users.map((user) => createHash('sha256').update(user.refreshToken).digest('hex')));
    const exp = JSON.parse(Buffer.from(users[0].accessToken.split('.')[1], 'base64url').toString()).exp as number;
    // The refresh family dies with the access token, not after 7 days.
    expect(rows.every((row) => new Date(row.expires_at).getTime() === exp * 1000)).toBe(true);

    // A token minted with another target's secret is rejected.
    const forged = users[0].accessToken.replace(/\.[^.]+$/, '.invalidsignature');
    await expect(authenticate(forged)).rejects.toThrow(/rejected/);
  });

  it('reprovisioning reuses the buyers and revokes the previous pool', async () => {
    const before = await readPool(join(dir, 'first.json'));
    const result = await provision('second.json', 3);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ created: 0, reused: 3, revokedRefreshTokens: 3 });
    const after = await readPool(result.out);
    const userId = subjectOf(after[0].accessToken);
    expect(subjectOf(before[0].accessToken)).toBe(userId);
    await expect(queue.resolveBrowserIdentity(userId, before[0].refreshToken)).rejects.toThrow('유효한 브라우저 세션이 필요합니다');
    await expect(queue.resolveBrowserIdentity(userId, after[0].refreshToken)).resolves.toMatchObject({ userId });
    expect(run(['provision', '--count', '3', '--out', result.out]).stderr).toContain('(output_exists)');
  });

  it('refuses the whole run when a namespace account is not a safe synthetic buyer', async () => {
    const squatter = await pool.query(`INSERT INTO users (email,password_hash,name,phone,gender,birth_date,is_phone_verified,is_email_verified)
      VALUES ('phase26-buyer-000004@phase26-load.invalid','argon-hash','Squatter','+821000000004','male','1990-01-01',true,true)
      RETURNING id`);
    await pool.query(`INSERT INTO refresh_tokens (user_id,token_hash,family,expires_at)
      VALUES ($1,$2,'squatter-family',now() + interval '7 days')`,
    [squatter.rows[0].id, createHash('sha256').update('squatter-refresh').digest('hex')]);
    const active = await pool.query('SELECT count(*)::int AS n FROM refresh_tokens WHERE revoked_at IS NULL');
    const result = await provision('conflict.json', 5);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('(synthetic_buyer_conflict)');
    await expect(stat(result.out)).rejects.toMatchObject({ code: 'ENOENT' });
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM users WHERE email = 'phase26-buyer-000005@phase26-load.invalid'");
    expect(rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM refresh_tokens WHERE revoked_at IS NULL')).rows[0].n).toBe(active.rows[0].n);
  });

  it('cleanup revokes the pool at once and deletes buyers only after their reservations are gone', async () => {
    const users = await readPool(join(dir, 'second.json'));
    const buyerId = subjectOf(users[0].accessToken);
    const performanceId = randomUUID();
    const showtimeId = randomUUID();
    const reservationId = randomUUID();
    await pool.query(`INSERT INTO performances (id,title,genre,start_date,end_date,age_rating,publish_state)
      VALUES ($1,'PHASE26_TEST-20261002 load','artist_celebrity','2099-12-01','2099-12-02','All','review')`, [performanceId]);
    await pool.query('INSERT INTO showtimes (id,performance_id,date_time) VALUES ($1,$2,$3)', [showtimeId, performanceId, '2099-12-01T11:00:00Z']);
    await pool.query(`INSERT INTO reservations (id,user_id,showtime_id,reservation_number,toss_order_id,status,total_amount,cancel_deadline)
      VALUES ($1,$2,$3,'PHASE26-R1','PHASE26_ORD-1','CANCELLED',52000,'2099-11-30')`, [reservationId, buyerId, showtimeId]);

    const revoke = run(['cleanup']);
    expect(revoke.exitCode).toBe(0);
    expect(JSON.parse(revoke.stdout)).toEqual({ command: 'cleanup', revokedRefreshTokens: 3, deletedUsers: 0, skippedAccounts: 1 });
    for (const user of users) {
      await expect(queue.resolveBrowserIdentity(subjectOf(user.accessToken), user.refreshToken)).rejects.toThrow();
    }

    const refused = run(['cleanup', '--delete-users']);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('(synthetic_buyers_still_referenced)');
    expect(JSON.parse(refused.stdout)).toEqual({ command: 'cleanup', revokedRefreshTokens: 0, deletedUsers: 0, skippedAccounts: 1 });
    expect((await pool.query("SELECT count(*)::int AS n FROM users WHERE email ~ '^phase26-buyer-'")).rows[0].n).toBe(4);

    await pool.query('DELETE FROM reservations WHERE id = $1', [reservationId]);
    const deleted = run(['cleanup', '--delete-users']);
    expect(deleted.exitCode).toBe(0);
    expect(JSON.parse(deleted.stdout)).toEqual({ command: 'cleanup', revokedRefreshTokens: 0, deletedUsers: 3, skippedAccounts: 1 });
    const left = await pool.query(`SELECT u.email, r.revoked_at FROM users u JOIN refresh_tokens r ON r.user_id = u.id
      WHERE u.email ~ '^phase26-buyer-'`);
    // The squatter in the namespace keeps its account and session.
    expect(left.rows).toEqual([{ email: 'phase26-buyer-000004@phase26-load.invalid', revoked_at: null }]);
    // A deleted buyer's still-unexpired access token no longer authenticates.
    await expect(authenticate(users[0].accessToken)).rejects.toThrow('사용자를 찾을 수 없습니다');

    // Accounts outside the namespace are never touched.
    await expect(queue.resolveBrowserIdentity(realUserId, realRefreshToken)).resolves.toMatchObject({ refreshTokenFamilyId: 'real-family' });
  });

  it('refuses to run without the dedicated test-event approval', () => {
    const result = run(['cleanup'], { PHASE26_LOAD_APPROVED: 'yes' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('(approval_missing)');
  });
});
