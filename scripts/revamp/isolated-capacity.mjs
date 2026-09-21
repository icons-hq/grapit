#!/usr/bin/env node
// Creates its own disposable PostgreSQL/Valkey/API. Never accepts a target URL
// or DATABASE_URL, and never calls a payment, message or external provider API.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { Agent, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, open, readFile, writeFile, rm } from 'node:fs/promises';
import { arch, platform, release, tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (!args.includes('--run')) {
  console.log('Usage: node scripts/revamp/isolated-capacity.mjs --run --sessions=100,500,1000 --output=/absolute/private/result.json');
  process.exit(0);
}
const waves = (args.find((x) => x.startsWith('--sessions='))?.split('=')[1] ?? '100,500,1000').split(',').map(Number);
assert(waves.length > 0 && waves.every((n) => [100, 500, 1000].includes(n)), 'Only bounded rehearsal waves are supported');
assert(waves.every((n, index) => index === 0 || n > waves[index - 1]), 'Waves must be unique and ascending');
const output = args.find((x) => x.startsWith('--output='))?.slice(9);
assert(output?.startsWith('/'), 'An absolute result path is required');
await mkdir(dirname(output), { recursive: true });
// Keep earlier evidence intact and guarantee private permissions on this run.
await (await open(output, 'wx', 0o600)).close();
const require = createRequire(join(root, 'apps/api/package.json'));
// Rebuild the measured code so an old dist directory cannot impersonate HEAD.
// Run without an active dev/build process using these same output directories.
console.log('Building shared contracts and API before creating disposable resources');
execFileSync(process.execPath, [join(root, 'packages/shared/node_modules/typescript/bin/tsc')], {
  cwd: join(root, 'packages/shared'), stdio: 'inherit',
});
execFileSync(process.execPath, [require.resolve('@swc/cli/bin/swc.js'), 'src', '-d', 'dist', '--strip-leading-paths'], {
  cwd: join(root, 'apps/api'), stdio: 'inherit',
});
require('reflect-metadata');
const { GenericContainer } = require('testcontainers');
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { JwtService } = require('@nestjs/jwt');
const schema = require(join(root, 'apps/api/dist/database/schema/index.js'));
const jwt = new JwtService();
const jwtSecret = randomBytes(32).toString('hex');
const qrSecret = randomBytes(32).toString('hex');
const password = randomBytes(24).toString('hex');
const work = await mkdtemp(join(tmpdir(), 'grabit-capacity-'));
const summary = { startedAt: new Date().toISOString(), environment: 'disposable-local',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  trackedChangesSha256: createHash('sha256').update(execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: root })).digest('hex'),
  harnessSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
  runtime: { node: process.version, platform: platform(), architecture: arch(), kernel: release() },
  build: 'Shared TypeScript and API SWC rebuilt immediately before this run',
  topology: { apiProcesses: 1, dbPoolMax: 2, valkeyMode: 'standalone' },
  connectionModel: 'One HTTP/1.1 keep-alive connection per actor; warm-up in batches of 64, then simultaneous requests',
  authentication: 'synthetic users and persisted refresh families; real JWT, queue and capability guards',
  excludes: ['password/OAuth load', 'PG approval', 'production capacity', 'real devices'], waves: [], faults: [] };
let pgContainer, redisContainer, pool, child, childLog, base, db;
let pausedContainer;
const agents = [];
const samples = new Map();
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const interruption = new AbortController();
const interrupt = (signal) => {
  interruption.abort(new Error(`Experiment interrupted by ${signal}`));
  child?.kill('SIGTERM');
};
const onSigint = () => interrupt('SIGINT');
const onSigterm = () => interrupt('SIGTERM');
process.once('SIGINT', onSigint); process.once('SIGTERM', onSigterm);
function checkInterrupted() { if (interruption.signal.aborted) throw interruption.signal.reason; }

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

function record(name, elapsed, status, outcome) {
  const rows = samples.get(name) ?? [];
  rows.push({ elapsed, status, outcome });
  samples.set(name, rows);
}

async function request(actor, path, { method = 'GET', body, metric, timeout = 30000 } = {}) {
  checkInterrupted();
  assert(path.startsWith('/api/v1/'), 'Only this API path is supported');
  const started = performance.now();
  try {
    const encoded = body ? JSON.stringify(body) : undefined;
    const result = await new Promise((done, reject) => {
      const req = httpRequest(base + path, { method, agent: actor?.agent, signal: AbortSignal.any([AbortSignal.timeout(timeout), interruption.signal]),
        headers: { 'Content-Type': 'application/json', ...(encoded ? { 'Content-Length': Buffer.byteLength(encoded) } : {}), ...(actor ? {
        Authorization: `Bearer ${actor.token}`, Cookie: [...actor.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
        } : {}) } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          let data = null;
          try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* Empty response. */ }
          done({ status: response.statusCode, cookies: response.headers['set-cookie'] ?? [], data });
        });
      });
      req.on('error', reject); req.end(encoded);
    });
    if (actor) for (const cookie of result.cookies) {
      const pair = cookie.split(';')[0]; const offset = pair.indexOf('=');
      actor.cookies.set(pair.slice(0, offset), pair.slice(offset + 1));
    }
    if (metric) record(metric, performance.now() - started, result.status, result.data?.outcome);
    return { status: result.status, data: result.data };
  } catch (error) {
    if (metric) record(metric, performance.now() - started, 'transport_error', error.code ?? error.cause?.code ?? error.name);
    return { status: 'transport_error', data: null };
  }
}

async function inBatches(values, action) {
  for (let start = 0; start < values.length; start += 64) await Promise.all(values.slice(start, start + 64).map(action));
}

async function warmConnections(values) {
  // Avoid conflating macOS's small TCP accept backlog with 1,000 established
  // customer sessions. Cold-connection storms need a separate deployment test.
  await inBatches(values, async (actor) => {
    const result = await request(actor, '/api/v1/health');
    assert.equal(result.status, 200, 'Connection warm-up must succeed before measurement');
  });
}

function metrics() {
  return Object.fromEntries([...samples].map(([name, values]) => {
    const times = values.map((v) => v.elapsed).sort((a, b) => a - b);
    const counts = (field) => values.reduce((out, value) => { const key = String(value[field] ?? 'none'); out[key] = (out[key] ?? 0) + 1; return out; }, {});
    const unexpectedErrors = values.filter((v) => v.status === 'transport_error' ||
      (Number(v.status) >= 400 && !(name === 'seat.contention' && v.status === 409))).length;
    return [name, { requests: values.length, unexpectedErrors, errorRate: unexpectedErrors / values.length,
      p50Ms: Math.round(times[Math.ceil(times.length * .5) - 1]),
      p95Ms: Math.round(times[Math.ceil(times.length * .95) - 1]), maxMs: Math.round(times.at(-1)),
      statuses: counts('status'), outcomes: counts('outcome') }];
  }));
}

async function actors(count, role) {
  const now = new Date();
  const records = Array.from({ length: count }, (_, n) => ({ id: randomUUID(), email: `${role}-${n}-${randomUUID()}@example.test`,
    name: `Capacity ${role} ${n}`, phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01',
    role: role === 'scanner' ? 'admin' : 'user', adminCapabilityBundle: role === 'scanner' ? 'scanner' : null,
    isEmailVerified: true, isPhoneVerified: true }));
  await db.insert(schema.users).values(records);
  const output = records.map((user) => {
    const refresh = randomBytes(32).toString('base64url');
    const agent = new Agent({ keepAlive: true, maxSockets: 1 }); agents.push(agent);
    return { id: user.id, token: jwt.sign({ sub: user.id, role: user.role }, { secret: jwtSecret, expiresIn: '1h' }),
      agent, refreshHash: createHash('sha256').update(refresh).digest('hex'), cookies: new Map([['refreshToken', refresh]]) };
  });
  await db.insert(schema.refreshTokens).values(output.map((user) => ({ userId: user.id, tokenHash: user.refreshHash,
    family: randomUUID(), expiresAt: new Date(now.getTime() + 3600000) })));
  return output;
}

async function fixture(count, buyers) {
  const [event] = await db.insert(schema.performances).values({ title: `REVAMP_ISOLATED_CAPACITY_${count}_${randomUUID()}`,
    genre: 'artist_celebrity', ageRating: 'Test only', publishState: 'published', status: 'selling',
    startDate: new Date('2099-01-01'), endDate: new Date('2099-01-02') }).returning();
  const [show, fieldShow] = await db.insert(schema.showtimes).values([
    { performanceId: event.id, dateTime: new Date('2099-01-01') },
    { performanceId: event.id, dateTime: new Date('2099-01-02') },
  ]).returning();
  await db.insert(schema.bookingPolicies).values({ performanceId: event.id, maxTicketsPerUser: 4, bookingStartsAt: new Date('2020-01-01') });
  await db.insert(schema.priceTiers).values({ performanceId: event.id, tierName: 'VIP', price: 50000 });
  await db.insert(schema.seatMaps).values({ performanceId: event.id, totalSeats: count + 2,
    svgUrl: 'https://example.test/unused.svg', seatConfig: { tiers: [{ tierName: 'VIP', color: '#6C3CE0',
      seatIds: Array.from({ length: count + 2 }, (_, n) => `A-${n + 1}`) }] } });
  // One order/payment per attendee avoids an artificial shared-order row lock.
  const rows = Array.from({ length: count + 1 }, (_, n) => ({ reservationId: randomUUID(), paymentId: randomUUID(), itemId: randomUUID(), jti: randomUUID(),
    buyerId: buyers[n % count].id, number: String(n + 1), orderId: `LOAD-${randomUUID()}` }));
  await db.insert(schema.reservations).values(rows.map((r) => ({ id: r.reservationId, userId: r.buyerId, showtimeId: fieldShow.id,
    reservationNumber: r.reservationId.slice(0, 28), tossOrderId: r.orderId, status: 'CONFIRMED', totalAmount: 52000, cancelDeadline: new Date('2098-12-31') })));
  await db.insert(schema.payments).values(rows.map((r) => ({ id: r.paymentId, reservationId: r.reservationId,
    tossOrderId: r.orderId, paymentKey: `isolated_load_${r.paymentId}`, method: 'CARD', provider: 'CARD', amount: 52000, status: 'DONE', paidAt: new Date() })));
  await db.insert(schema.ticketItems).values(rows.map((r) => ({ id: r.itemId, reservationId: r.reservationId, paymentId: r.paymentId, showtimeId: fieldShow.id,
    seatId: `1F:A-${r.number}`, seatKey: `1F:A-${r.number}`, floorKey: '1F', floorLabel: '1F', tierName: 'VIP', row: 'A', number: r.number, price: 50000, serviceFee: 2000 })));
  const issuedAt = new Date();
  await db.insert(schema.tickets).values(rows.map((r) => ({ reservationId: r.reservationId, paymentId: r.paymentId, showtimeId: fieldShow.id,
    ticketItemId: r.itemId, qrTokenJti: r.jti, secretVersion: 'capacity', issuedAt })));
  const credentials = rows.map((r) => jwt.sign({ type: 'qr-ticket', jti: r.jti, reservationId: r.reservationId, paymentId: r.paymentId,
    showtimeId: fieldShow.id, ticketItemId: r.itemId, secretVersion: 'capacity', issuedAt: issuedAt.toISOString(),
    seatIdentity: { seatId: `1F:A-${r.number}`, seatKey: `1F:A-${r.number}`, floorKey: '1F', floorLabel: '1F', row: 'A', number: r.number, tierName: 'VIP' },
  }, { secret: qrSecret, algorithm: 'HS256', noTimestamp: true }));
  return { event, show, fieldShow, credentials, rows };
}

async function exercise(count, buyers, scanners) {
  samples.clear();
  const started = performance.now();
  const f = await fixture(count, buyers);
  const preflight = await request(buyers[0], `/api/v1/performances/${f.event.id}`);
  assert.equal(preflight.data?.title, f.event.title, 'API must use the freshly created disposable DB');
  await warmConnections(buyers);
  await Promise.all(buyers.map((actor) => request(actor, '/api/v1/users/me/reservations?locale=en', { metric: 'buyer.wallet' })));
  await Promise.all(buyers.map((actor) => request(actor, `/api/v1/booking/schedules/${f.show.id}/seats`, { metric: 'seat.read' })));
  const queue = await Promise.all(buyers.map(async (actor) => {
    let response = await request(actor, `/api/v1/queue/performances/${f.event.id}/enter`, { method: 'POST', body: {}, metric: 'queue.enter' });
    const sessionId = response.data?.queueSessionId;
    for (let tries = 0; response.data?.state === 'WAITING' && tries < 10; tries++) {
      await delay(1000);
      response = await request(actor, `/api/v1/queue/sessions/${sessionId}`, { metric: 'queue.status' });
    }
    return response.data?.state;
  }));
  const admitted = buyers.filter((_, n) => queue[n] === 'ADMITTED');
  const locks = await Promise.all(admitted.map((actor, n) => request(actor, '/api/v1/booking/seats/lock', {
    method: 'POST', body: { showtimeId: f.show.id, seatId: `1F:A-${n + 1}` }, metric: 'seat.lock' })));
  const raceSeat = `1F:A-${count + 1}`;
  const contention = await Promise.all(admitted.map((actor) => request(actor, '/api/v1/booking/seats/lock', {
    method: 'POST', body: { showtimeId: f.show.id, seatId: raceSeat }, metric: 'seat.contention' })));
  const lockWinners = contention.filter((r) => r.status === 201).length;
  await warmConnections(scanners);
  const field = await Promise.all(scanners.map((actor, n) => request(actor, '/api/v1/field/check-in/consume', {
    method: 'POST', body: { token: f.credentials[n], showtimeId: f.fieldShow.id, deviceAttemptId: randomUUID(), confirmed: true }, metric: 'field.consume' })));
  const fieldRace = await Promise.all(scanners.map((actor) => request(actor, '/api/v1/field/check-in/consume', {
    method: 'POST', body: { token: f.credentials[count], showtimeId: f.fieldShow.id, deviceAttemptId: randomUUID(), confirmed: true }, metric: 'field.contention' })));
  const entryWinners = fieldRace.filter((r) => r.data?.outcome === 'entered').length;
  const readback = await pool.query('select count(*)::int as entered from ticket_items where showtime_id=$1 and admission_state=\'entered\'', [f.fieldShow.id]);
  const data = { sessions: count, durationMs: Math.round(performance.now() - started), admitted: admitted.length,
    locksSucceeded: locks.filter((r) => r.status === 201).length, seatContentionWinners: lockWinners,
    fieldEntriesSucceeded: field.filter((r) => r.data?.outcome === 'entered').length,
    fieldContentionWinners: entryWinners, enteredReadback: readback.rows[0].entered, metrics: metrics() };
  data.invariantsPassed = lockWinners === 1 && entryWinners === 1 && data.enteredReadback === data.fieldEntriesSucceeded + 1;
  data.latencyTargetsPassed = Object.entries(data.metrics).every(([name, value]) => value.p95Ms <= (
    name.startsWith('field.') || ['seat.lock', 'seat.contention'].includes(name) ? 1000 : 2000));
  data.sloPassed = data.invariantsPassed && data.latencyTargetsPassed && data.admitted === count
    && data.locksSucceeded === count && data.fieldEntriesSucceeded === count
    && Object.values(data.metrics).every((value) => value.errorRate < .01);
  summary.waves.push(data);
  console.log(JSON.stringify({ sessions: count, admitted: data.admitted, invariantsPassed: data.invariantsPassed,
    latencyTargetsPassed: data.latencyTargetsPassed, sloPassed: data.sloPassed,
    transportErrors: Object.values(data.metrics).reduce((total, value) => total + (value.statuses.transport_error ?? 0), 0),
    p95: Object.fromEntries(Object.entries(data.metrics).map(([key, value]) => [key, value.p95Ms])) }));
  await writeFile(output, JSON.stringify(summary, null, 2), { mode: 0o600 });
  await inBatches(admitted, (actor) => request(actor, `/api/v1/booking/seats/lock-all/${f.show.id}`, { method: 'DELETE' }));
  return { actor: admitted[0], fixture: f };
}

async function fault(container, actor, path, options) {
  checkInterrupted();
  pausedContainer = container.getId();
  execFileSync('docker', ['pause', pausedContainer], { stdio: 'ignore' });
  let interrupted;
  try {
    const pending = request(actor, path, { ...options, timeout: 1000 });
    await delay(1500);
    execFileSync('docker', ['unpause', pausedContainer], { stdio: 'ignore' });
    pausedContainer = undefined;
    interrupted = await pending;
  } finally {
    if (pausedContainer) { execFileSync('docker', ['unpause', pausedContainer], { stdio: 'ignore' }); pausedContainer = undefined; }
  }
  const recovery = await request(actor, path, options);
  return { duringPause: interrupted.status, afterResume: recovery.status };
}

try {
  await mkdir(dirname(output), { recursive: true });
  await mkdir(join(work, 'apps/api'), { recursive: true });
  await writeFile(join(work, '.env'), '', { mode: 0o600 });
  pgContainer = await new GenericContainer('postgres:16-alpine').withEnvironment({ POSTGRES_PASSWORD: password, POSTGRES_DB: 'grabit_disposable_capacity' }).withExposedPorts(5432).start();
  checkInterrupted();
  redisContainer = await new GenericContainer('valkey/valkey:8-alpine').withExposedPorts(6379).start();
  checkInterrupted();
  const databaseUrl = `postgresql://postgres:${password}@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/grabit_disposable_capacity`;
  pool = new Pool({ connectionString: databaseUrl, max: 2 }); db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: join(root, 'apps/api/src/database/migrations') });
  checkInterrupted();
  // Production deploys the worker (and its job schema) before the API. Mirror
  // that schema prerequisite without running workers or external side effects.
  const { PgBoss } = await import(require.resolve('pg-boss'));
  const installer = new PgBoss({ connectionString: databaseUrl, max: 1 });
  await installer.start(); await installer.stop();
  const count = Math.max(...waves);
  const buyers = await actors(count, 'buyer'); const scanners = await actors(count, 'scanner');
  checkInterrupted();
  const port = await freePort(); base = `http://127.0.0.1:${port}`;
  childLog = await open(`${output}.api.log`, 'w', 0o600);
  // Positive allowlist: future provider credentials cannot silently reach the API.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'SystemRoot'].includes(key)));
  child = spawn(process.execPath, [join(root, 'apps/api/dist/main.js')], { cwd: join(work, 'apps/api'),
    stdio: ['ignore', childLog.fd, childLog.fd], env: { ...inherited, NODE_ENV: 'test', PORT: String(port),
      DATABASE_URL: databaseUrl, REDIS_URL: `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`,
      VALKEY_MODE: 'standalone', DB_POOL_MAX: '2', FRONTEND_URL: 'http://localhost:3000',
      JWT_SECRET: jwtSecret, JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
      QR_TICKET_SECRET: qrSecret, QR_TICKET_SECRET_VERSION: 'capacity', BOOKING_ENABLED: 'true',
      BACKGROUND_PROCESSING_ENABLED: 'false', SENTRY_DSN: '', TOSS_SECRET_KEY: '',
    } });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    checkInterrupted();
    if (child.exitCode !== null) throw new Error('Disposable API exited; inspect the private API log');
    const response = await request(null, '/api/v1/health', { timeout: 500 });
    if (response.status === 200) { ready = true; break; }
    await delay(200);
  }
  assert(ready, 'Disposable API did not become healthy');
  console.log(JSON.stringify({ ready: true, environment: 'disposable-local', sessions: waves }));
  let last;
  for (const wave of waves) last = await exercise(wave, buyers.slice(0, wave), scanners.slice(0, wave));
  if (last?.actor) {
    const seat = `1F:A-${Math.max(...waves) + 2}`;
    const redis = await fault(redisContainer, last.actor, '/api/v1/booking/seats/lock', { method: 'POST', body: { showtimeId: last.fixture.show.id, seatId: seat } });
    const owned = await request(last.actor, `/api/v1/booking/my-locks/${last.fixture.show.id}`);
    summary.faults.push({ component: 'valkey', ...redis, sameOwnerAfterRetry: owned.data?.seatIds?.filter((id) => id === seat).length === 1 });
    summary.faults.push({ component: 'postgres', ...await fault(pgContainer, last.actor, '/api/v1/users/me/reservations?locale=en', {}) });
  }
  summary.completedAt = new Date().toISOString();
  checkInterrupted();
  summary.highestPassingSessions = Math.max(0, ...summary.waves.filter((wave) => wave.sloPassed).map((wave) => wave.sessions));
  summary.status = summary.waves.every((wave) => wave.sloPassed) ? 'measured_targets_passed' : 'capacity_limited';
  summary.faultRecoveryPassed = summary.faults.every((item) => item.duringPause === 'transport_error'
    && (item.component === 'valkey' ? item.afterResume === 201 && item.sameOwnerAfterRetry : item.afterResume === 200));
  if (!summary.faultRecoveryPassed || summary.waves.some((wave) => !wave.invariantsPassed)) summary.status = 'correctness_failed';
  // A bounded experiment can finish successfully while its capacity target fails.
  // CI callers must not interpret that experiment as a passing release gate.
  if (summary.status !== 'measured_targets_passed') process.exitCode = 2;
  console.log(JSON.stringify({ faults: summary.faults, result: output }));
} catch (error) {
  summary.status = 'experiment_failed';
  summary.error = error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[connection redacted]');
  console.error(JSON.stringify({ error: summary.error, result: output }));
  process.exitCode = 1;
} finally {
  const cleanupFailures = [];
  const cleanup = async (resource, action) => {
    try { await action(); } catch { cleanupFailures.push(resource); }
  };
  await cleanup('paused-container', async () => { if (pausedContainer) execFileSync('docker', ['unpause', pausedContainer], { stdio: 'ignore' }); });
  await cleanup('api-process', async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const exited = new Promise((done) => child.once('exit', done));
      await Promise.race([exited, delay(5000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL'); await exited;
      }
    }
  });
  await cleanup('api-log', async () => { await childLog?.close(); });
  for (const agent of agents) agent.destroy();
  await cleanup('database-pool', async () => { await pool?.end(); });
  await Promise.all([cleanup('valkey', async () => { await redisContainer?.stop(); }), cleanup('postgres', async () => { await pgContainer?.stop(); })]);
  await cleanup('temporary-files', () => rm(work, { recursive: true, force: true }));
  summary.cleanupFailures = cleanupFailures;
  summary.disposableResourcesRemoved = cleanupFailures.length === 0;
  if (cleanupFailures.length) { summary.status = 'cleanup_failed'; process.exitCode = 1; }
  await writeFile(output, JSON.stringify(summary, null, 2), { mode: 0o600 });
  process.removeListener('SIGINT', onSigint); process.removeListener('SIGTERM', onSigterm);
}
