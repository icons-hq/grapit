#!/usr/bin/env node
// Provisions the synthetic buyer pool (PHASE26_USER_POOL_FILE) for the Phase 26
// k6 load gate in scripts/k6/phase26-*.js.
//
// Why the pool is not built by logging in: POST /auth/login is limited to 60
// requests per minute per client (default throttler), so 10,000 buyers take
// about 167 minutes and 20,000 about 333 minutes, while API-issued access tokens
// live 15 minutes (auth.config.ts). k6 does not call /auth/refresh either: it is
// a public route throttled per client like login, and refresh rotates the
// refresh token, so a pool would become single-use and a lost response would
// revoke the whole family.
//
// Instead, against the database and JWT secret of the target the k6 run hits:
//  1. buyers are created or reused under a reserved, undeliverable namespace
//     (phase26-buyer-NNNNNN@phase26-load.invalid). A buyer is used only when it
//     is an active `user` with verified email and phone, no password, no social
//     login and no admin capability, so nobody can sign in as it; any other
//     account in the namespace aborts the run without changes;
//  2. their previous refresh families are revoked and one new family per buyer
//     is stored (sha256 hash, as a login stores it), expiring with the access
//     token instead of after 7 days, so a leaked pool file dies with the run;
//  3. each access token is signed with the target's JWT secret (HS256, the
//     claims of AuthService.generateTokenPair) for --valid-for, so it outlives
//     VU initialisation and the run.
// The pool file is created 0600 and never overwritten. Tokens, the secret and
// the database URL are never printed; failures print a fixed message and code.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APPROVAL_TOKEN = 'PHASE26_DEDICATED_TEST_EVENT_APPROVED';
export const SYNTHETIC_EMAIL_DOMAIN = 'phase26-load.invalid';
// The same namespace as a PostgreSQL regular expression, for cleanup scoping.
export const SYNTHETIC_EMAIL_SQL_PATTERN = '^phase26-buyer-[0-9]{6}@phase26-load\\.invalid$';
export const MAX_BUYERS = 50000;
export const DEFAULT_VALID_FOR = '2h';
// Long enough for 20K VU initialisation plus a baseline and a stress run, short
// enough to bound the life of a leaked pool file.
export const MAX_VALID_FOR_MS = 6 * 60 * 60 * 1000;

const MESSAGES = {
  approval_missing: `PHASE26_LOAD_APPROVED must equal ${APPROVAL_TOKEN}`,
  database_url_missing: 'PHASE26_TARGET_DATABASE_URL is required (the database of the target the k6 run hits)',
  jwt_secret_missing: 'PHASE26_TARGET_JWT_SECRET is required (the JWT_SECRET of the target API)',
  invalid_command: 'Unknown command; use provision, cleanup or --help',
  invalid_count: `--count must be an integer between 1 and ${MAX_BUYERS}`,
  invalid_valid_for: '--valid-for must be a duration such as 90m or 2h, at most 6h',
  invalid_out: '--out <file> is required for provision and must be a writable new file',
  output_exists: 'The --out file already exists; pool files are never overwritten',
  synthetic_buyer_conflict: 'An account in the reserved phase26-load.invalid namespace is not a passwordless, verified, active non-admin user without social login; nothing was changed',
  synthetic_buyers_still_referenced: 'Synthetic buyers still have reservations or audit rows, so none was deleted; run the dedicated test-event cleanup first. Their refresh families are revoked',
  database_error: 'The database rejected the operation; nothing was committed',
  unexpected_error: 'Unexpected failure; nothing was printed from the error to avoid leaking secrets',
};

export class ProvisionError extends Error {
  constructor(code) {
    super(MESSAGES[code] || MESSAGES.unexpected_error);
    this.code = code;
  }
}

export function syntheticEmail(index) {
  return `phase26-buyer-${String(index).padStart(6, '0')}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

// 010-0XXX-XXXX is not an assignable Korean mobile range, so a synthetic phone
// never matches a real buyer (account merge and SMS look at phones).
export function syntheticPhone(index) {
  return `+82100${String(index).padStart(7, '0')}`;
}

export function parseDurationMs(value) {
  const match = /^(\d+)(m|h)$/.exec(String(value || '').trim());
  if (!match) throw new ProvisionError('invalid_valid_for');
  const ms = Number(match[1]) * (match[2] === 'h' ? 3600000 : 60000);
  if (ms <= 0 || ms > MAX_VALID_FOR_MS) throw new ProvisionError('invalid_valid_for');
  return ms;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// HS256, the algorithm and claims @nestjs/jwt produces in AuthService.generateTokenPair.
export function signAccessToken({ secret, userId, email, issuedAtSeconds, expiresAtSeconds }) {
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({
    sub: userId,
    email,
    role: 'user',
    adminCapabilityBundle: null,
    adminCapabilities: [],
    iat: issuedAtSeconds,
    exp: expiresAtSeconds,
  });
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function parseArgs(argv) {
  const args = { command: '', count: NaN, out: '', validFor: DEFAULT_VALID_FOR, deleteUsers: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      return argv[index] ?? '';
    };
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--count') args.count = /^\d+$/.test(next()) ? Number(argv[index]) : NaN;
    else if (arg === '--out') args.out = next();
    else if (arg === '--valid-for') args.validFor = next();
    else if (arg === '--delete-users') args.deleteUsers = true;
    else if (!args.command && (arg === 'provision' || arg === 'cleanup')) args.command = arg;
    else throw new ProvisionError('invalid_command');
  }
  if (args.help) return args;
  if (!args.command) throw new ProvisionError('invalid_command');
  if (args.command === 'provision') {
    if (!Number.isInteger(args.count) || args.count < 1 || args.count > MAX_BUYERS) throw new ProvisionError('invalid_count');
    if (!args.out) throw new ProvisionError('invalid_out');
    args.validForMs = parseDurationMs(args.validFor);
  }
  return args;
}

export function usage() {
  return `Usage:
  node scripts/phase26/provision-load-buyers.mjs provision --count <n> --out <file> [--valid-for ${DEFAULT_VALID_FOR}]
  node scripts/phase26/provision-load-buyers.mjs cleanup [--delete-users]

Environment (never printed):
  PHASE26_LOAD_APPROVED         Must equal ${APPROVAL_TOKEN}
  PHASE26_TARGET_DATABASE_URL   Database of the target the k6 run hits (through its proxy)
  PHASE26_TARGET_JWT_SECRET     JWT_SECRET of the same target API (provision only)

provision  Creates or reuses buyers phase26-buyer-000001..N@${SYNTHETIC_EMAIL_DOMAIN}, revokes their
           old refresh families, stores one new family each and writes the k6 pool
           [{ accessToken, refreshToken }] to --out (0600, never overwritten). Access
           tokens and refresh families are valid for --valid-for (at most 6h).
cleanup    Revokes every active refresh family of the synthetic buyers, which stops queue
           entry, seat lock, prepare and confirm for the pool at once. With --delete-users
           it also deletes them; run the dedicated test-event cleanup first, because buyers
           that still have reservations or audit rows cannot be deleted. Namespace accounts
           that are not synthetic buyers are never touched and are reported as skipped.`;
}

async function inTransaction(client, work) {
  await client.query('BEGIN');
  try {
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

function isUsableBuyer(row) {
  return row.role === 'user' && row.passwordless === true && row.no_admin === true && row.no_social === true
    && row.account_status === 'active' && row.is_email_verified === true && row.is_phone_verified === true;
}

// Creates or reuses `count` buyers and rotates their refresh families in one
// transaction. Returns raw refresh tokens; only their hashes reach the database.
export async function provisionBuyers(client, { count, expiresAt }) {
  const emails = Array.from({ length: count }, (_, index) => syntheticEmail(index + 1));
  return inTransaction(client, async () => {
    const created = await client.query(
      `INSERT INTO users (email, name, phone, gender, country, birth_date, is_phone_verified, is_email_verified,
         marketing_consent, role)
       SELECT t.email, t.name, t.phone, 'unspecified'::gender, 'KR', '1990-01-01', true, true, false, 'user'
       FROM unnest($1::text[], $2::text[], $3::text[]) AS t(email, name, phone)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [emails, emails.map((_, index) => `PHASE26 load buyer ${index + 1}`), emails.map((_, index) => syntheticPhone(index + 1))],
    );
    const { rows } = await client.query(
      `SELECT u.id, u.email, u.role, u.account_status, u.is_email_verified, u.is_phone_verified,
         u.password_hash IS NULL AS passwordless,
         (u.admin_capability_bundle IS NULL AND u.admin_capabilities = '[]'::jsonb) AS no_admin,
         NOT EXISTS (SELECT 1 FROM social_accounts s WHERE s.user_id = u.id) AS no_social
       FROM users u WHERE u.email = ANY($1::text[])`,
      [emails],
    );
    const byEmail = new Map(rows.map((row) => [row.email, row]));
    if (rows.length !== count || !rows.every(isUsableBuyer)) throw new ProvisionError('synthetic_buyer_conflict');
    const buyers = emails.map((email) => ({ userId: byEmail.get(email).id, email, refreshToken: randomBytes(32).toString('hex') }));
    const userIds = buyers.map((buyer) => buyer.userId);
    // The API keeps at most two refresh families per user; a buyer keeps exactly one.
    const revoked = await client.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = ANY($1::uuid[]) AND revoked_at IS NULL',
      [userIds],
    );
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at)
       SELECT t.user_id, t.token_hash, t.family, $4::timestamptz
       FROM unnest($1::uuid[], $2::text[], $3::text[]) AS t(user_id, token_hash, family)`,
      [
        userIds,
        buyers.map((buyer) => createHash('sha256').update(buyer.refreshToken).digest('hex')),
        buyers.map(() => randomUUID()),
        expiresAt.toISOString(),
      ],
    );
    return { buyers, created: created.rowCount, reused: count - created.rowCount, revokedRefreshTokens: revoked.rowCount };
  });
}

// One validity window for the whole pool, whole seconds like a JWT `exp`.
export function poolWindow(now, validForMs) {
  const issuedAtSeconds = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds = Math.floor((now.getTime() + validForMs) / 1000);
  return { issuedAtSeconds, expiresAtSeconds, expiresAt: new Date(expiresAtSeconds * 1000) };
}

export function buildUserPool(buyers, { secret, window }) {
  return buyers.map((buyer) => ({
    accessToken: signAccessToken({
      secret,
      userId: buyer.userId,
      email: buyer.email,
      issuedAtSeconds: window.issuedAtSeconds,
      expiresAtSeconds: window.expiresAtSeconds,
    }),
    refreshToken: buyer.refreshToken,
  }));
}

// Accounts this script could have created: the reserved namespace, plus no
// password, social login or admin capability. Cleanup never touches others.
const SYNTHETIC_BUYER_SQL = `u.email ~ $1 AND u.role = 'user' AND u.password_hash IS NULL
  AND u.admin_capability_bundle IS NULL AND u.admin_capabilities = '[]'::jsonb
  AND NOT EXISTS (SELECT 1 FROM social_accounts s WHERE s.user_id = u.id)`;

// Revokes every active refresh family of the synthetic buyers (queue entry,
// lock, prepare and confirm all need one), then optionally deletes them.
// Namespace accounts that are not synthetic buyers are left alone and counted.
export async function cleanupBuyers(client, { deleteUsers = false } = {}) {
  return inTransaction(client, async () => {
    const skipped = await client.query(
      `SELECT count(*)::int AS skipped FROM users u WHERE u.email ~ $1 AND NOT (${SYNTHETIC_BUYER_SQL})`,
      [SYNTHETIC_EMAIL_SQL_PATTERN],
    );
    const revoked = await client.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE revoked_at IS NULL AND user_id IN (SELECT u.id FROM users u WHERE ${SYNTHETIC_BUYER_SQL})`,
      [SYNTHETIC_EMAIL_SQL_PATTERN],
    );
    const result = { revokedRefreshTokens: revoked.rowCount, deletedUsers: 0, skippedAccounts: skipped.rows[0].skipped };
    if (!deleteUsers) return result;
    // A savepoint keeps the revocation when deletion is refused.
    await client.query('SAVEPOINT delete_buyers');
    try {
      const deleted = await client.query(`DELETE FROM users u WHERE ${SYNTHETIC_BUYER_SQL}`, [SYNTHETIC_EMAIL_SQL_PATTERN]);
      return { ...result, deletedUsers: deleted.rowCount };
    } catch (error) {
      if (error?.code !== '23503') throw error;
      await client.query('ROLLBACK TO SAVEPOINT delete_buyers');
      return { ...result, deletionRefused: 'synthetic_buyers_still_referenced' };
    }
  });
}

async function connect(databaseUrl) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const { Client } = createRequire(`${root}/apps/api/package.json`)('pg');
  const client = new Client({ connectionString: databaseUrl });
  client.on('error', () => {});
  await client.connect();
  return client;
}

export async function main(argv = process.argv.slice(2), env = process.env, { connectClient = connect, now = () => new Date() } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (env.PHASE26_LOAD_APPROVED !== APPROVAL_TOKEN) throw new ProvisionError('approval_missing');
  const databaseUrl = String(env.PHASE26_TARGET_DATABASE_URL || '').trim();
  if (!databaseUrl) throw new ProvisionError('database_url_missing');

  if (args.command === 'cleanup') {
    const client = await connectClient(databaseUrl);
    let result;
    try {
      result = await cleanupBuyers(client, { deleteUsers: args.deleteUsers });
    } finally {
      await client.end().catch(() => {});
    }
    const { deletionRefused, ...summary } = result;
    console.log(JSON.stringify({ command: 'cleanup', ...summary }));
    // The refresh families are revoked either way; only the deletion is refused.
    if (deletionRefused) throw new ProvisionError(deletionRefused);
    return;
  }

  // Used byte for byte, like the API reads process.env.JWT_SECRET.
  const secret = String(env.PHASE26_TARGET_JWT_SECRET || '');
  if (!secret.trim()) throw new ProvisionError('jwt_secret_missing');
  let handle;
  try {
    handle = await open(args.out, 'wx', 0o600);
  } catch (error) {
    throw new ProvisionError(error?.code === 'EEXIST' ? 'output_exists' : 'invalid_out');
  }
  let written = false;
  try {
    const window = poolWindow(now(), args.validForMs);
    const client = await connectClient(databaseUrl);
    let result;
    try {
      result = await provisionBuyers(client, { count: args.count, expiresAt: window.expiresAt });
    } finally {
      await client.end().catch(() => {});
    }
    await handle.writeFile(`${JSON.stringify(buildUserPool(result.buyers, { secret, window }))}\n`);
    written = true;
    console.log(JSON.stringify({
      command: 'provision',
      buyers: result.buyers.length,
      created: result.created,
      reused: result.reused,
      revokedRefreshTokens: result.revokedRefreshTokens,
      validUntil: window.expiresAt.toISOString(),
    }));
  } finally {
    await handle.close();
    if (!written) await rm(args.out, { force: true });
  }
}

export function failureMessage(error) {
  if (error instanceof ProvisionError) return `phase26 load buyers: ${error.message} (${error.code})`;
  const pgCode = typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : '';
  return pgCode
    ? `phase26 load buyers: ${MESSAGES.database_error} (database_error ${pgCode})`
    : `phase26 load buyers: ${MESSAGES.unexpected_error} (unexpected_error)`;
}

function isMain() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((error) => {
    console.error(failureMessage(error));
    process.exitCode = 1;
  });
}
