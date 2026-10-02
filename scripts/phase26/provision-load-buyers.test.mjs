import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  MAX_VALID_FOR_MS,
  ProvisionError,
  SYNTHETIC_EMAIL_SQL_PATTERN,
  failureMessage,
  main,
  parseArgs,
  parseDurationMs,
  syntheticEmail,
  syntheticPhone,
} from './provision-load-buyers.mjs';
import { assertUsersOutliveRun, parseConfig, parseUserPool, runValidUntilMs } from '../k6/lib/phase26-load.js';

// The API's own verifier (AuthModule registers JwtModule with JWT_SECRET; passport-jwt
// verifies the same HS256 signature and exp).
const api = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { JwtService } = api('@nestjs/jwt');

const SECRET = 'jwt-secret-unit-7f3c9a';
const DB_PASSWORD = 'db-pass-unit-41ad';
const DATABASE_URL = `postgresql://grapit_app:${DB_PASSWORD}@127.0.0.1:15432/grapit`;
const NOW = new Date('2026-10-02T09:00:00.000Z');
const APPROVED = { PHASE26_LOAD_APPROVED: 'PHASE26_DEDICATED_TEST_EVENT_APPROVED' };

// Records statements and answers like PostgreSQL would for an empty namespace,
// or for the namespace rows the test injects. The real SQL runs against PG16 in
// apps/api/test/phase26-load-buyers.integration.spec.ts.
function fakeClient({ existing = [], failOn, skipped = 0 } = {}) {
  const statements = [];
  const users = new Map(existing.map((row) => [row.email, row]));
  return {
    statements,
    ended: false,
    async query(text, values = []) {
      statements.push({ text, values });
      if (failOn && failOn.test(text)) throw Object.assign(new Error(`failed with ${DATABASE_URL}`), { code: '40P01' });
      if (/^INSERT INTO users/.test(text)) {
        const [emails] = values;
        let rowCount = 0;
        emails.forEach((email, index) => {
          if (users.has(email)) return;
          users.set(email, { id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, email, role: 'user',
            account_status: 'active', is_email_verified: true, is_phone_verified: true, passwordless: true, no_admin: true,
            no_social: true });
          rowCount += 1;
        });
        return { rowCount, rows: [] };
      }
      if (/^SELECT u\.id/.test(text)) return { rows: values[0].filter((email) => users.has(email)).map((email) => users.get(email)) };
      if (/^UPDATE refresh_tokens/.test(text)) return { rowCount: 2 };
      if (/^SELECT count\(\*\)::int AS skipped/.test(text)) return { rows: [{ skipped }] };
      return { rowCount: 0, rows: [] };
    },
    async end() { this.ended = true; },
  };
}

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'phase26-buyers-'));
  try { return await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function capture(run) {
  const out = [];
  const original = { log: console.log, error: console.error };
  console.log = (...args) => out.push(args.join(' '));
  console.error = (...args) => out.push(args.join(' '));
  try { await run(); } finally { Object.assign(console, original); }
  return out.join('\n');
}

const provisionEnv = { ...APPROVED, PHASE26_TARGET_DATABASE_URL: DATABASE_URL, PHASE26_TARGET_JWT_SECRET: SECRET };

test('parses commands, counts and a bounded validity window', () => {
  assert.equal(parseArgs(['provision', '--count', '3', '--out', '/private/users.json']).validForMs, 2 * 3600000);
  assert.equal(parseArgs(['provision', '--count', '3', '--out', 'u.json', '--valid-for', '90m']).validForMs, 90 * 60000);
  assert.equal(parseDurationMs('6h'), MAX_VALID_FOR_MS);
  for (const bad of ['7h', '0m', '15', '1d', '']) assert.throws(() => parseDurationMs(bad), { code: 'invalid_valid_for' });
  assert.throws(() => parseArgs(['provision', '--count', '0', '--out', 'u.json']), { code: 'invalid_count' });
  assert.throws(() => parseArgs(['provision', '--count', '50001', '--out', 'u.json']), { code: 'invalid_count' });
  assert.throws(() => parseArgs(['provision', '--count', '3']), { code: 'invalid_out' });
  assert.throws(() => parseArgs(['provision', 'cleanup']), { code: 'invalid_command' });
  assert.equal(parseArgs(['cleanup', '--delete-users']).deleteUsers, true);
});

test('keeps buyers inside a reserved, undeliverable namespace with unassignable phones', () => {
  assert.equal(syntheticEmail(1), 'phase26-buyer-000001@phase26-load.invalid');
  assert.match(syntheticEmail(20000), new RegExp(SYNTHETIC_EMAIL_SQL_PATTERN));
  assert.equal(syntheticPhone(20000), '+821000020000');
  assert.ok(syntheticPhone(50000).length <= 20, 'fits users.phone varchar(20)');
});

test('writes a 0600 pool the API verifies and k6 accepts for a run that starts long after provisioning', async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, 'users.json');
    const client = fakeClient();
    const printed = await capture(() => main(['provision', '--count', '3', '--out', out, '--valid-for', '2h'], provisionEnv,
      { connectClient: async (url) => { assert.equal(url, DATABASE_URL); return client; }, now: () => NOW }));
    assert.equal((await stat(out)).mode & 0o777, 0o600);
    const pool = JSON.parse(await readFile(out, 'utf8'));
    assert.equal(pool.length, 3);
    assert.ok(client.ended);

    const jwt = new JwtService({ secret: SECRET });
    const subjects = new Set();
    for (const [index, user] of pool.entries()) {
      const claims = jwt.verify(user.accessToken, { clockTimestamp: NOW.getTime() / 1000 + 60 });
      assert.equal(claims.role, 'user');
      assert.equal(claims.email, syntheticEmail(index + 1));
      assert.equal(claims.exp - claims.iat, 2 * 3600);
      assert.deepEqual(claims.adminCapabilities, []);
      subjects.add(claims.sub);
      assert.throws(() => new JwtService({ secret: 'another-target' }).verify(user.accessToken), /invalid signature/);
    }
    assert.equal(subjects.size, 3);

    // Only sha256 hashes of the refresh tokens reach the database, one family
    // each, expiring with the access tokens.
    const insert = client.statements.find((statement) => /^INSERT INTO refresh_tokens/.test(statement.text));
    const [userIds, hashes, families, expiresAt] = insert.values;
    assert.equal(userIds.length, 3);
    assert.deepEqual(hashes, pool.map((user) => createHash('sha256').update(user.refreshToken).digest('hex')));
    assert.equal(new Set(families).size, 3);
    assert.equal(expiresAt, new Date(NOW.getTime() + 2 * 3600000).toISOString());
    assert.ok(client.statements.some((statement) => /^UPDATE refresh_tokens SET revoked_at/.test(statement.text)),
      'previous families are revoked');
    assert.deepEqual(client.statements.map((statement) => statement.text).filter((text) => /^(BEGIN|COMMIT)$/.test(text)),
      ['BEGIN', 'COMMIT']);

    // 20K VU initialisation can take tens of minutes; a 15-minute API token
    // would fail here, the provisioned pool does not.
    const config = parseConfig({
      GRABIT_API_URL: 'https://load.example.test/api/v1',
      PHASE26_TEST_PERFORMANCE_ID: '11111111-1111-4111-8111-111111111111',
      PHASE26_TEST_SHOWTIME_ID: '22222222-2222-4222-8222-222222222222',
      PHASE26_TEST_MARKER: 'PHASE26_TEST-20261002',
      PHASE26_USER_POOL_FILE: '/private/users.json',
      PHASE26_SEAT_POOL_FILE: '/private/seats.json',
      PHASE26_TEST_ORDER_PREFIX: 'PHASE26_ORD-',
      PHASE26_STRESS_TARGET_VUS: '3',
      ...APPROVED,
    }, 'LOAD_20K_STRESS');
    const startMs = NOW.getTime() + 45 * 60000;
    const users = parseUserPool(pool, { minUsers: 3, validUntilMs: runValidUntilMs(config, NOW.getTime() + 10 * 60000) });
    assert.doesNotThrow(() => assertUsersOutliveRun(users, config, startMs));

    for (const secretValue of [SECRET, DB_PASSWORD, ...pool.flatMap((user) => [user.accessToken, user.refreshToken])]) {
      assert.equal(printed.includes(secretValue), false, 'nothing secret is printed');
    }
    assert.deepEqual(JSON.parse(printed), { command: 'provision', buyers: 3, created: 3, reused: 0, revokedRefreshTokens: 2,
      validUntil: '2026-10-02T11:00:00.000Z' });
  });
});

test('refuses a namespace account it cannot safely use and leaves no pool file', async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, 'users.json');
    const client = fakeClient({ existing: [{ id: 'x', email: syntheticEmail(2), role: 'user', account_status: 'active',
      is_email_verified: true, is_phone_verified: true, passwordless: false, no_admin: true, no_social: true }] });
    await assert.rejects(main(['provision', '--count', '3', '--out', out], provisionEnv,
      { connectClient: async () => client, now: () => NOW }), { code: 'synthetic_buyer_conflict' });
    await assert.rejects(stat(out), { code: 'ENOENT' });
    const texts = client.statements.map((statement) => statement.text);
    assert.equal(texts.at(-1), 'ROLLBACK');
    assert.equal(texts.some((text) => /refresh_tokens/.test(text)), false, 'no refresh family is touched');
  });
});

test('never overwrites a pool file and never prints the database URL or secret on failure', async () => {
  await withTempDir(async (dir) => {
    const out = join(dir, 'users.json');
    await writeFile(out, 'previous pool');
    await assert.rejects(main(['provision', '--count', '1', '--out', out], provisionEnv,
      { connectClient: async () => assert.fail('must not connect') }), { code: 'output_exists' });
    assert.equal(await readFile(out, 'utf8'), 'previous pool');

    const fresh = join(dir, 'fresh.json');
    let caught;
    try {
      await main(['provision', '--count', '1', '--out', fresh], provisionEnv,
        { connectClient: async () => fakeClient({ failOn: /^INSERT INTO refresh_tokens/ }), now: () => NOW });
    } catch (error) { caught = error; }
    assert.equal(caught.code, '40P01');
    await assert.rejects(stat(fresh), { code: 'ENOENT' });
    const message = failureMessage(caught);
    assert.equal(message, 'phase26 load buyers: The database rejected the operation; nothing was committed (database_error 40P01)');
    assert.equal(failureMessage(new Error(`connect ${DATABASE_URL} ${SECRET}`)).includes(DB_PASSWORD), false);
  });
  await assert.rejects(main(['provision', '--count', '1', '--out', 'x.json'], { PHASE26_TARGET_DATABASE_URL: DATABASE_URL }),
    { code: 'approval_missing' });
  await assert.rejects(main(['provision', '--count', '1', '--out', 'x.json'], { ...APPROVED, PHASE26_TARGET_DATABASE_URL: DATABASE_URL }),
    { code: 'jwt_secret_missing' });
  assert.ok(new ProvisionError('approval_missing').message.includes('PHASE26_LOAD_APPROVED'));
});

test('cleanup revokes only synthetic buyers and deletes them only when asked', async () => {
  const client = fakeClient({ skipped: 1 });
  const printed = await capture(() => main(['cleanup'], { ...APPROVED, PHASE26_TARGET_DATABASE_URL: DATABASE_URL },
    { connectClient: async () => client }));
  assert.deepEqual(JSON.parse(printed), { command: 'cleanup', revokedRefreshTokens: 2, deletedUsers: 0, skippedAccounts: 1 });
  const revoke = client.statements.find((statement) => /^UPDATE refresh_tokens/.test(statement.text));
  assert.deepEqual(revoke.values, [SYNTHETIC_EMAIL_SQL_PATTERN]);
  assert.match(revoke.text, /password_hash IS NULL/);
  assert.equal(client.statements.some((statement) => /DELETE/.test(statement.text)), false);
  assert.ok(client.ended);
});

test('a refused deletion keeps the revocation and fails with a fixed message', async () => {
  const client = fakeClient();
  const query = client.query.bind(client);
  client.query = async (text, values) => {
    if (/^DELETE FROM users/.test(text)) {
      await query(text, values);
      throw Object.assign(new Error('violates foreign key constraint on reservations'), { code: '23503' });
    }
    return query(text, values);
  };
  let printed;
  let caught;
  printed = await capture(async () => {
    try {
      await main(['cleanup', '--delete-users'], { ...APPROVED, PHASE26_TARGET_DATABASE_URL: DATABASE_URL },
        { connectClient: async () => client });
    } catch (error) { caught = error; }
  });
  assert.equal(caught.code, 'synthetic_buyers_still_referenced');
  assert.deepEqual(JSON.parse(printed), { command: 'cleanup', revokedRefreshTokens: 2, deletedUsers: 0, skippedAccounts: 0 });
  assert.deepEqual(client.statements.map((statement) => statement.text).filter((text) => !/^(SELECT|UPDATE|DELETE)/.test(text)),
    ['BEGIN', 'SAVEPOINT delete_buyers', 'ROLLBACK TO SAVEPOINT delete_buyers', 'COMMIT']);
});
