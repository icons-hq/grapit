#!/usr/bin/env node
// Read-only release evidence. By default the script starts its own Cloud SQL
// Auth Proxy for the exact instance below on a free loopback port, so the port
// cannot silently belong to another instance's proxy. It also records the
// connected server's identity and refuses a baseline taken from a different
// server. The database secret stays in process memory and is never printed.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INSTANCE = 'grapit-491806:asia-northeast3:grabit-db-managed-demo';
export const TARGET = 'grabit-db-managed-demo/grapit';
const DATABASE = 'grapit';
const PROXY_READY_PATTERN = /ready for new connections/i;
const PROXY_START_TIMEOUT_MS = 30_000;
const SERVER_ID_PATTERN = /^[0-9a-f]{64}$/;
// Where `server.identity` came from. The cluster's system identifier is
// preferred. If the application role cannot execute pg_control_system(), the
// postmaster start time plus the database OID still tell instances apart; it
// changes when the server restarts, which fails closed (baseline mismatch).
export const IDENTITY_SOURCES = {
  control: 'sha256(pg_control_system().system_identifier)',
  postmaster: 'sha256(pg_postmaster_start_time() microseconds + database oid)',
};

const USAGE = [
  'Usage: REVAMP_PROD_DATABASE_URL=<secret in process memory> node scripts/revamp/production-preflight.mjs --read-only',
  '         --output=/private/before.json [--baseline=/private/before.json] [--expected-migrations=<count>]',
  '  Default: starts `cloud-sql-proxy <instance>` (CLOUD_SQL_PROXY_BIN or PATH) on a free loopback port and stops it afterwards.',
  '  --proxy-port=<port> --expected-server-id=<sha256>: use an already running proxy only when the connected',
  '         server identity equals the `server.identity` recorded by a script-managed run.',
].join('\n');

// Fixed, value-free messages. Parser and driver errors can embed the secret
// (WHATWG URL errors carry `input`), so they are never printed.
const FAILURES = {
  invalid_arguments: 'Invalid arguments. Use an absolute --output path and, for an external proxy, --proxy-port with --expected-server-id.',
  invalid_database_url: 'REVAMP_PROD_DATABASE_URL is missing or could not be parsed. Its value is not printed.',
  unexpected_database: 'REVAMP_PROD_DATABASE_URL does not select the expected database.',
  unexpected_instance: 'REVAMP_PROD_DATABASE_URL does not select the expected Cloud SQL instance.',
  output_exists: 'The output path already exists or is not writable. Use a new private path.',
  invalid_baseline: 'The baseline file is not read-only evidence for the expected target.',
  baseline_server_identity_missing: 'The baseline has no server identity. Capture a new baseline with this script version.',
  baseline_server_identity_source_mismatch: 'The baseline server identity came from a different source. Capture baseline and comparison with the same database role.',
  proxy_unavailable: 'Cloud SQL Auth Proxy could not be started. Check CLOUD_SQL_PROXY_BIN/PATH and ADC privately.',
  proxy_failed: 'Cloud SQL Auth Proxy exited or did not become ready for the expected instance.',
  server_identity_unavailable: 'The connected server identity could not be read, so the target cannot be proven. No evidence was written.',
  server_identity_mismatch: 'The connected server is not the expected server. No comparison was written.',
  baseline_server_mismatch: 'The connected server differs from the baseline server. No comparison was written.',
  read_failed: 'Read-only preflight failed. Check the expected proxy, target and schema privately; no SQL write was attempted.',
};

export class PreflightError extends Error {
  constructor(code) {
    super(FAILURES[code] ?? FAILURES.read_failed);
    this.code = FAILURES[code] ? code : 'read_failed';
  }
}

export function failureMessage(error) {
  return error instanceof PreflightError ? `${error.message} (code=${error.code})` : `${FAILURES.read_failed} (code=read_failed)`;
}

export function parseArgs(argv) {
  const value = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const readOnly = argv.includes('--read-only');
  const output = value('output');
  const baselinePath = value('baseline');
  const rawPort = value('proxy-port');
  const expectedServerId = value('expected-server-id');
  const rawMigrations = value('expected-migrations');
  if (!readOnly) return { readOnly };
  if (!output?.startsWith('/')) throw new PreflightError('invalid_arguments');
  if (baselinePath !== undefined && !baselinePath.startsWith('/')) throw new PreflightError('invalid_arguments');
  let proxyPort = null;
  if (rawPort !== undefined) {
    proxyPort = Number(rawPort);
    if (!Number.isInteger(proxyPort) || proxyPort <= 1024 || proxyPort >= 65536) throw new PreflightError('invalid_arguments');
    // An externally started proxy proves nothing about its instance; require the
    // identity recorded from a script-managed run.
    if (!expectedServerId || !SERVER_ID_PATTERN.test(expectedServerId)) throw new PreflightError('invalid_arguments');
  } else if (expectedServerId !== undefined && !SERVER_ID_PATTERN.test(expectedServerId)) {
    throw new PreflightError('invalid_arguments');
  }
  let expectedMigrations = null;
  if (rawMigrations !== undefined) {
    expectedMigrations = Number(rawMigrations);
    if (!Number.isInteger(expectedMigrations) || expectedMigrations < 1) throw new PreflightError('invalid_arguments');
  }
  return { readOnly, output, baselinePath, proxyPort, expectedServerId: expectedServerId ?? null, expectedMigrations };
}

// Cloud Run secrets use the unix-socket form `user:pw@/grapit?host=/cloudsql/<instance>`.
// WHATWG URL rejects the empty host and its TypeError carries the whole input,
// so normalize first and convert every parser failure into a fixed error.
export function parseDatabaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') throw new PreflightError('invalid_database_url');
  const normalized = raw.trim().replace(/^(postgres(?:ql)?:\/\/[^/?#]*)@\//, '$1@localhost/');
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new PreflightError('invalid_database_url');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new PreflightError('invalid_database_url');
  let user;
  let password;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new PreflightError('invalid_database_url');
  }
  if (!user) throw new PreflightError('invalid_database_url');
  if (url.pathname !== `/${DATABASE}`) throw new PreflightError('unexpected_database');
  if (url.searchParams.get('host') !== `/cloudsql/${INSTANCE}`) throw new PreflightError('unexpected_instance');
  return { user, password, database: DATABASE };
}

export function serverIdentity(systemIdentifier) {
  return createHash('sha256').update(String(systemIdentifier)).digest('hex');
}

export function postmasterServerIdentity({ postmasterStartMicros, databaseOid }) {
  return createHash('sha256').update(`postmaster:${postmasterStartMicros}:database:${databaseOid}`).digest('hex');
}

// Runs before any table is read, outside the snapshot transaction, so a
// permission error cannot abort it. Returns null only when neither source works.
export async function readServerIdentity(client) {
  try {
    const row = (await client.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0];
    if (row?.id) return { identity: serverIdentity(row.id), source: IDENTITY_SOURCES.control };
  } catch { /* Managed PostgreSQL may not grant pg_control_system() to application roles. */ }
  try {
    const row = (await client.query(`SELECT (extract(epoch FROM pg_postmaster_start_time()) * 1000000)::bigint::text AS started,
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid`)).rows[0];
    if (row?.started && row?.database_oid) {
      return {
        identity: postmasterServerIdentity({ postmasterStartMicros: row.started, databaseOid: row.database_oid }),
        source: IDENTITY_SOURCES.postmaster,
      };
    }
  } catch { /* fall through: an unidentified server is refused below */ }
  return null;
}

// Every run must identify its server: evidence from an unidentified server could
// never be pinned by a later --baseline comparison, so it is refused up front.
export function assertServerIdentity({ current, expected, baseline }) {
  if (!current?.identity) throw new PreflightError('server_identity_unavailable');
  if (expected && current.identity !== expected) throw new PreflightError('server_identity_mismatch');
  if (baseline) {
    const recorded = baseline.server?.identity;
    if (!recorded) throw new PreflightError('baseline_server_identity_missing');
    if ((baseline.server.source ?? IDENTITY_SOURCES.control) !== current.source) {
      throw new PreflightError('baseline_server_identity_source_mismatch');
    }
    if (recorded !== current.identity) throw new PreflightError('baseline_server_mismatch');
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

async function startManagedProxy() {
  const bin = process.env.CLOUD_SQL_PROXY_BIN?.trim() || 'cloud-sql-proxy';
  const port = await freePort();
  // The proxy authenticates with ADC; it never needs the database secret.
  const { REVAMP_PROD_DATABASE_URL: _secret, ...env } = process.env;
  const child = spawn(bin, [INSTANCE, '--address=127.0.0.1', `--port=${port}`, '--run-connection-test'], {
    stdio: ['ignore', 'pipe', 'pipe'], env,
  });
  try {
    await new Promise((done, fail) => {
      let seen = '';
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); child.stdout.off('data', onData); child.stderr.off('data', onData); callback(value);
      };
      const timer = setTimeout(() => finish(fail, new PreflightError('proxy_failed')), PROXY_START_TIMEOUT_MS);
      function onData(chunk) {
        seen = (seen + chunk.toString()).slice(-4096);
        if (PROXY_READY_PATTERN.test(seen)) finish(done);
      }
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('error', () => finish(fail, new PreflightError('proxy_unavailable')));
      child.once('exit', () => finish(fail, new PreflightError('proxy_failed')));
    });
  } catch (error) {
    await stopProxy(child);
    throw error;
  }
  // Keep draining output so a chatty proxy cannot block on a full pipe.
  child.stdout.resume(); child.stderr.resume();
  child.once('exit', () => { child.exitedEarly = true; });
  return { port, child };
}

async function stopProxy(child) {
  if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGTERM');
  let timer;
  const timeout = new Promise((done) => { timer = setTimeout(done, 5000); });
  await Promise.race([exited, timeout]);
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
}

const TABLES = ['users', 'social_accounts', 'consent_items', 'consent_audit_logs', 'performances', 'showtimes',
  'reservations', 'payments', 'ticket_items', 'tickets', 'ticket_benefit_entitlements',
  'ticket_benefit_redemption_records', 'ticket_scan_events', 'refunds',
  'admin_audit_logs', 'booking_operation_audit_logs', 'payment_webhook_events'];
const IMMUTABLE_EVENT_TABLES = new Set(['consent_audit_logs', 'admin_audit_logs', 'booking_operation_audit_logs']);
const IMMUTABLE_COLUMNS = {
  reservations: ['id', 'user_id', 'showtime_id', 'reservation_number', 'total_amount'],
  payments: ['id', 'reservation_id', 'toss_order_id', 'amount', 'currency', 'provider_charge_currency', 'provider_charge_amount_minor'],
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
function identifier(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new PreflightError('read_failed');
  return `"${name}"`;
}
function ensure(condition) { if (!condition) throw new PreflightError('read_failed'); }

async function collect(client, baseline) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  ensure((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only === 'on');
  ensure((await client.query('SELECT current_database() AS name')).rows[0].name === DATABASE);
  const columns = (await client.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows;
  const records = {};
  for (const table of TABLES) {
    const available = columns.filter((row) => row.table_name === table).map((row) => row.column_name);
    // Compare only pre-release columns; additive migrations are not data loss.
    const selected = baseline?.records?.[table]?.columns ?? available;
    ensure(selected.length > 0 && selected.includes('id') && selected.every((name) => available.includes(name)));
    const rows = (await client.query(`SELECT ${selected.map(identifier).join(',')} FROM ${identifier(table)} ORDER BY id`)).rows;
    records[table] = { columns: selected, rows: Object.fromEntries(rows.map((row) => [hash(String(row.id)), {
      original: hash(JSON.stringify(row)),
      ...(IMMUTABLE_COLUMNS[table] ? { immutable: hash(JSON.stringify(IMMUTABLE_COLUMNS[table].map((name) => row[name]))) }
        : IMMUTABLE_EVENT_TABLES.has(table) || (table === 'refunds' && row.status === 'completed')
          ? { immutable: hash(JSON.stringify(row)) } : {}),
    }])) };
  }
  const inFlight = (await client.query(`SELECT count(*) FILTER (WHERE status::text='PENDING_PAYMENT')::int AS all_pending,
    count(*) FILTER (WHERE status::text='PENDING_PAYMENT' AND payment_deadline_at>now())::int AS within_deadline FROM reservations`)).rows[0];
  const providerProcessing = (await client.query(`SELECT status,count(*)::int AS count FROM payments
    WHERE status::text IN ('READY','IN_PROGRESS','WAITING_FOR_DEPOSIT') GROUP BY status`)).rows;
  const pendingTicketCancellations = (await client.query(`SELECT count(*)::int AS count FROM ticket_items WHERE status::text='cancellation_pending'`)).rows[0].count;
  const pendingRefunds = (await client.query(`SELECT status,count(*)::int AS count FROM refunds WHERE status::text!='completed' GROUP BY status`)).rows;
  const migrations = (await client.query('SELECT count(*)::int AS count,max(created_at)::text AS latest_created_at FROM drizzle.__drizzle_migrations')).rows[0];
  const expandedCheckoutColumns = Object.fromEntries(['checkout_payment_method', 'checkout_started_at'].map((name) => [name,
    columns.some((column) => column.table_name === 'reservations' && column.column_name === name)]));
  await client.query('COMMIT');
  return { records, inFlight, providerProcessing, pendingTicketCancellations, pendingRefunds, migrations, expandedCheckoutColumns };
}

function compare(baseline, records) {
  if (!baseline) return null;
  return Object.fromEntries(TABLES.map((table) => {
    const before = baseline.records[table].rows; const after = records[table].rows;
    return [table, { before: Object.keys(before).length, after: Object.keys(after).length,
      missing: Object.keys(before).filter((key) => !after[key]).length,
      originalChanged: Object.keys(before).filter((key) => after[key] && before[key].original !== after[key].original).length,
      immutableChanged: Object.keys(before).filter((key) => after[key] && before[key].immutable !== undefined && before[key].immutable !== after[key].immutable).length,
      added: Object.keys(after).filter((key) => !before[key]).length }];
  }));
}

export async function main(argv = process.argv.slice(2)) {
  let proxy = null;
  let client = null;
  try {
    const args = parseArgs(argv);
    if (!args.readOnly) { console.log(USAGE); return 0; }
    const credentials = parseDatabaseUrl(process.env.REVAMP_PROD_DATABASE_URL);
    const baseline = args.baselinePath ? await readBaseline(args.baselinePath) : null;
    await mkdir(dirname(args.output), { recursive: true });
    try { await (await open(args.output, 'wx', 0o600)).close(); } catch { throw new PreflightError('output_exists'); }

    let port = args.proxyPort;
    if (port === null) {
      proxy = await startManagedProxy();
      port = proxy.port;
    }
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const { Client } = createRequire(`${root}/apps/api/package.json`)('pg');
    client = new Client({ ...credentials, host: '127.0.0.1', port, ssl: false, connectionTimeoutMillis: 10000,
      options: '-c default_transaction_read_only=on -c statement_timeout=15000' });
    client.on('error', () => undefined);
    try { await client.connect(); } catch { throw new PreflightError(proxy?.child.exitedEarly ? 'proxy_failed' : 'read_failed'); }

    // Prove the server before reading a single table from it.
    const server = await readServerIdentity(client);
    assertServerIdentity({ current: server, expected: args.expectedServerId, baseline });
    const snapshot = await collect(client, baseline);
    if (proxy?.child.exitedEarly) throw new PreflightError('proxy_failed');

    const comparison = compare(baseline, snapshot.records);
    const preservationPassed = comparison ? Object.values(comparison).every((row) => row.missing === 0 && row.immutableChanged === 0) : null;
    const migrationExpectation = args.expectedMigrations === null ? null
      : { expected: args.expectedMigrations, actual: snapshot.migrations.count, met: snapshot.migrations.count === args.expectedMigrations };
    const connection = { proxy: args.proxyPort === null ? 'script-managed' : 'external', instance: INSTANCE };
    const { records, inFlight, providerProcessing, pendingTicketCancellations, pendingRefunds, migrations, expandedCheckoutColumns } = snapshot;
    const result = { checkedAt: new Date().toISOString(), target: TARGET, readOnly: true, connection, server, records, inFlight,
      providerProcessing, pendingTicketCancellations, pendingRefunds, migrations, migrationExpectation, expandedCheckoutColumns,
      comparison, preservationPassed };
    await writeFile(args.output, JSON.stringify(result, null, 2));
    // No row contents, customer identifiers, credentials or financial totals.
    console.log(JSON.stringify({ target: TARGET, readOnly: true, connection, server, inFlight, providerProcessing,
      pendingTicketCancellations, pendingRefunds, migrations, migrationExpectation, expandedCheckoutColumns, comparison,
      preservationPassed, result: args.output }));
    if (preservationPassed === false) return 2;
    if (migrationExpectation && !migrationExpectation.met) {
      console.error('Migration count differs from --expected-migrations. Confirm the deployed migration job and target before release.');
      return 3;
    }
    return 0;
  } catch (error) {
    console.error(failureMessage(error));
    return 1;
  } finally {
    await client?.end().catch(() => undefined);
    await stopProxy(proxy?.child);
  }
}

async function readBaseline(path) {
  let baseline;
  try { baseline = JSON.parse(await readFile(path, 'utf8')); } catch { throw new PreflightError('invalid_baseline'); }
  if (baseline?.target !== TARGET || baseline?.readOnly !== true || typeof baseline?.records !== 'object') {
    throw new PreflightError('invalid_baseline');
  }
  for (const table of TABLES) {
    if (!Array.isArray(baseline.records[table]?.columns) || typeof baseline.records[table]?.rows !== 'object') {
      throw new PreflightError('invalid_baseline');
    }
  }
  return baseline;
}

function isEntrypoint() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isEntrypoint()) {
  process.exitCode = await main();
}
