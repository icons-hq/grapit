#!/usr/bin/env node
// Read-only release evidence. The caller owns a Cloud SQL Auth Proxy connected
// to the exact instance below and passes the original secret only in memory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (!args.includes('--read-only')) {
  console.log('Usage: REVAMP_PROD_DATABASE_URL=<secret in process memory> node scripts/revamp/production-preflight.mjs --read-only --proxy-port=15439 --output=/private/before.json [--baseline=/private/before.json]');
  process.exit(0);
}
const output = args.find((arg) => arg.startsWith('--output='))?.slice(9);
const baselinePath = args.find((arg) => arg.startsWith('--baseline='))?.slice(11);
const port = Number(args.find((arg) => arg.startsWith('--proxy-port='))?.slice(13));
assert(output?.startsWith('/'), 'Use an absolute private output path');
assert(Number.isInteger(port) && port > 1024 && port < 65536, 'Explicit local proxy port required');
const instance = 'grapit-491806:asia-northeast3:grabit-db-managed-demo';
const target = 'grabit-db-managed-demo/grapit';
const connection = new URL(process.env.REVAMP_PROD_DATABASE_URL);
assert.equal(connection.pathname, '/grapit', 'Unexpected database');
assert.equal(connection.searchParams.get('host'), `/cloudsql/${instance}`, 'Unexpected Cloud SQL instance');
connection.hostname = '127.0.0.1'; connection.port = String(port);
connection.searchParams.delete('host'); connection.searchParams.delete('sslmode');
await mkdir(dirname(output), { recursive: true });
await (await open(output, 'wx', 0o600)).close();
const baseline = baselinePath ? JSON.parse(await readFile(baselinePath, 'utf8')) : null;
if (baseline) { assert.equal(baseline.target, target); assert.equal(baseline.readOnly, true); }
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(`${root}/apps/api/package.json`);
const { Client } = require('pg');
const client = new Client({ connectionString: connection.toString(), ssl: false,
  connectionTimeoutMillis: 10000, options: '-c default_transaction_read_only=on -c statement_timeout=15000' });
const tables = ['users', 'social_accounts', 'consent_items', 'consent_audit_logs', 'performances', 'showtimes',
  'reservations', 'payments', 'ticket_items', 'tickets', 'ticket_benefit_entitlements',
  'ticket_benefit_redemption_records', 'ticket_scan_events'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const identifier = (name) => { assert(/^[a-z_][a-z0-9_]*$/.test(name)); return `"${name}"`; };
const immutableColumns = {
  reservations: ['id', 'user_id', 'showtime_id', 'reservation_number', 'total_amount'],
  payments: ['id', 'reservation_id', 'toss_order_id', 'amount', 'currency', 'provider_charge_currency', 'provider_charge_amount_minor'],
};
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
  assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, 'grapit');
  const columns = (await client.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows;
  const records = {};
  for (const table of tables) {
    const available = columns.filter((row) => row.table_name === table).map((row) => row.column_name);
    // Compare only pre-release columns; additive migrations are not data loss.
    const selected = baseline?.records[table]?.columns ?? available;
    assert(selected.length > 0 && selected.includes('id') && selected.every((name) => available.includes(name)), `Missing original columns: ${table}`);
    const rows = (await client.query(`SELECT ${selected.map(identifier).join(',')} FROM ${identifier(table)} ORDER BY id`)).rows;
    records[table] = { columns: selected, rows: Object.fromEntries(rows.map((row) => [hash(String(row.id)), {
      original: hash(JSON.stringify(row)),
      ...(immutableColumns[table] ? { immutable: hash(JSON.stringify(immutableColumns[table].map((name) => row[name]))) } : {}),
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
  const comparison = baseline ? Object.fromEntries(tables.map((table) => {
    const before = baseline.records[table].rows; const after = records[table].rows;
    return [table, { before: Object.keys(before).length, after: Object.keys(after).length,
      missing: Object.keys(before).filter((key) => !after[key]).length,
      originalChanged: Object.keys(before).filter((key) => after[key] && before[key].original !== after[key].original).length,
      immutableChanged: Object.keys(before).filter((key) => after[key] && before[key].immutable !== after[key].immutable).length,
      added: Object.keys(after).filter((key) => !before[key]).length }];
  })) : null;
  const preservationPassed = comparison ? Object.values(comparison).every((row) => row.missing === 0 && row.immutableChanged === 0) : null;
  await client.query('COMMIT');
  const result = { checkedAt: new Date().toISOString(), target, readOnly: true, records, inFlight, providerProcessing,
    pendingTicketCancellations, pendingRefunds, migrations, expandedCheckoutColumns, comparison, preservationPassed };
  await writeFile(output, JSON.stringify(result, null, 2));
  // No row contents, customer identifiers, credentials or financial totals.
  console.log(JSON.stringify({ target, readOnly: true, inFlight, providerProcessing, pendingTicketCancellations,
    pendingRefunds, migrations, expandedCheckoutColumns, comparison, preservationPassed, result: output }));
  if (preservationPassed === false) process.exitCode = 2;
} catch {
  console.error('Read-only preflight failed. Check the expected proxy, target and schema privately; no SQL write was attempted.');
  process.exitCode = 1;
} finally {
  await client.end();
}
