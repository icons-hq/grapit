import assert from 'node:assert/strict';
import { Agent, request as httpRequest } from 'node:https';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { guard, guardApiUrl } from './guard.mjs';
import { CONFIRM_PAYMENT_MAX_RETRIES, isRetryableConfirmPaymentError, getConfirmPaymentRetryDelayMs } from './payment-return-policy.mjs';
const config = guard(process.env, 'load');
const base = guardApiUrl(process.env.REHEARSAL_API_URL, config.id);
const apiInstances = Number(process.env.REHEARSAL_API_INSTANCES??2);assert([2,3,4].includes(apiInstances));
const bases = Array.from({length:apiInstances},()=>base);
const apiPoolMax=Number(process.env.DB_POOL_MAX);assert([2,3,4,5].includes(apiPoolMax));
const waveSizes=(process.env.REHEARSAL_WAVES??'600,1000,1500').split(',').map(Number);assert(waveSizes.every(v=>[600,1000,1500].includes(v)));
const saleSeats = 600;
const activeAdmissionLimit = Number(process.env.QUEUE_MAX_ACTIVE_ADMISSIONS);
assert(Number.isInteger(activeAdmissionLimit) && activeAdmissionLimit >= 50 && activeAdmissionLimit <= 300);
const socketClients=Number(process.env.REHEARSAL_SEAT_SOCKET_CLIENTS??100);assert([100,200,250,300].includes(socketClients));
const holdSeatSockets=process.env.REHEARSAL_HOLD_SEAT_SOCKETS==='1';
const isolateRestAffinity=process.env.REHEARSAL_REST_AFFINITY==='isolated';
const syncUpgradeCookies=process.env.REHEARSAL_COOKIE_SYNC==='1';
const cookieDiagnostics={upgradeResponses:0,affinityCookiesReceived:0,affinityCookieChanges:0,synchronized:syncUpgradeCookies};
const queueSocketLimit=Number(process.env.REHEARSAL_QUEUE_SOCKET_LIMIT??2000);assert([0,100,200,2000].includes(queueSocketLimit));
const prepareOnly=process.env.REHEARSAL_PREPARE_ONLY==='1';
const entryOnly=process.env.REHEARSAL_ENTRY_ONLY==='1';
const diagnosticCohorts=Number(process.env.REHEARSAL_DIAGNOSTIC_COHORTS??0);assert([0,1].includes(diagnosticCohorts));
const confirmCadenceMs=Number(process.env.REHEARSAL_CONFIRM_CADENCE_MS??0);assert([0,100,1000].includes(confirmCadenceMs));
const targetSales=diagnosticCohorts?activeAdmissionLimit*diagnosticCohorts:saleSeats;
const require = createRequire('/app/package.json');
const webRequire = createRequire('/rehearsal-deps/package.json');
require('reflect-metadata');
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { JwtService } = require('@nestjs/jwt');
const schema = require('/app/dist/database/schema/index.js');
const shared = require('@grabit/shared');
const Redis = require('ioredis');
const jwt = new JwtService();
const jwtSecret = process.env.JWT_SECRET;
const qrSecret = process.env.QR_TICKET_SECRET;
const agents = [], openSockets = [];
const expectedSocketClosures = new WeakSet();
const recoveryReads = new Set();
const socketRecovery={disconnectReasons:{},reconnections:0,resyncs:0,resyncFailures:0,reconnectFailures:0};
const confirmRecovery={ordersRetried:0,retryAttempts:0,recoveredOrders:0,unrecoveredOrders:0};
const samples = new Map();
const instanceMemory = new Map();
const allInstances = new Set();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const interruption = new AbortController();
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => interruption.abort(new Error('Rehearsal interrupted')));
function checkInterrupted() { if (interruption.signal.aborted) throw interruption.signal.reason; }
const metadata = async (path) => {
  const response = await fetch(`http://metadata.google.internal/computeMetadata/v1/${path}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(10000) });
  assert(response.ok, 'Metadata request failed'); return response;
};
const identityToken = await (await metadata(`instance/service-accounts/default/identity?audience=${encodeURIComponent(base)}&format=full`)).text();
const oauthToken = (await (await metadata('instance/service-accounts/default/token')).json()).access_token;
const iamHeaders = { 'X-Serverless-Authorization': `Bearer ${identityToken}` };
async function googleGet(url) {
  assert(new URL(url).hostname.endsWith('.googleapis.com'));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${oauthToken}` }, signal: AbortSignal.timeout(15000) });
  assert(response.ok, `Required read-only isolation check failed: ${response.status}`); return response.json();
}
async function assertRedisNotBoundToProduction() {
  const service = await googleGet('https://run.googleapis.com/v2/projects/grapit-491806/locations/asia-northeast3/services/grabit-api');
  const entry = service.template.containers[0].env.find((item) => item.name === 'REDIS_URL');
  assert(entry, 'Production Redis binding must be readable');
  let value = entry.value;
  if (!value) {
    const ref = entry.valueSource?.secretKeyRef; assert(ref?.secret && ref?.version);
    const path = ref.secret.startsWith('projects/') ? ref.secret : `projects/grapit-491806/secrets/${ref.secret}`;
    const secret = await googleGet(`https://secretmanager.googleapis.com/v1/${path}/versions/${ref.version}:access`);
    value = Buffer.from(secret.payload.data, 'base64').toString();
  }
  assert.notEqual(new URL(value.trim()).hostname, config.redisHost, 'Refusing to use Valkey already bound to production');
}
let pool, db;
async function openFixturePool() {
  pool = new Pool({ ...config.db, application_name: 'grabit-synthetic-rehearsal-fixtures', idleTimeoutMillis: 1000 });
  const row = (await pool.query('SELECT current_database() AS database, current_user AS owner')).rows[0];
  assert.equal(row.database, config.database, 'Refusing writes outside the dedicated synthetic database');
  assert.equal(row.owner, config.database, 'Refusing to use a production database role');
  db = drizzle(pool, { schema });
}
async function closeFixturePool() { await pool?.end(); pool = undefined; db = undefined; }
const output = '/tmp/cloud-capacity-result.json';
const summary = { restAffinity:isolateRestAffinity?'isolated':'shared',cookieDiagnostics, syntheticIdentities:'unique phone identity per actor across retained fixtures',workload:{confirmCadenceMs,confirmPattern:confirmCadenceMs?'paced-'+(60000/confirmCadenceMs)+'-per-minute':'synchronized-cohort-burst',profilingEnabled:process.env.REHEARSAL_PROFILE_CONFIRM==='1'}, diagnosticOnly:diagnosticCohorts>0||entryOnly||prepareOnly,startedAt: new Date().toISOString(), environment: 'private-cloud-run-rehearsal', sourceImage: process.env.REHEARSAL_SOURCE_IMAGE, database: config.database, apiService: `grabit-rehearsal-${config.id}`, apiResources: { cpu: 1, memoryMiB: 512, heapMiB: 256, minInstances: 2, maxInstances: 2 }, topology: { queueSocketLimit, apiInstances, dbPoolMax: apiPoolMax, admissionLimit: activeAdmissionLimit, saleSeats, socketClients }, provider: 'simulated-300ms-no-provider-network', pollModel: '15-20 second per-waiter jitter, matching use-queue.ts; bounded batches only for final assertions', excludes: ['real payment provider latency and charges', 'public edge routing', 'production-only bootstrap and browser secure-cookie behavior', 'human seat-choice time', 'field QR scanner contention'], waves: [] };
summary.workload.holdSeatSocketsThroughCheckout=holdSeatSockets;
summary.workload.browserConfirmRetryPolicy='current payment-return.ts: 3 retries, 1/2/4 second backoff, same order and payment key';
summary.workload.seatReconnectPolicy='current socket-client.ts: 10 attempts, 1-5 seconds; rejoin and snapshot with <=3 second jitter';
summary.socketRecovery=socketRecovery;summary.confirmRecovery=confirmRecovery;
function progress(stage, data = {}) { console.log(JSON.stringify({ kind: 'cloud-capacity-progress', stage, ...data })); }

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
      const req = httpRequest((bases[actor?.lane ?? 0] ?? base) + path, { method, agent: actor?.agent, signal: AbortSignal.any([AbortSignal.timeout(timeout), interruption.signal]),
        headers: { ...iamHeaders, 'Content-Type': 'application/json', ...(encoded ? { 'Content-Length': Buffer.byteLength(encoded) } : {}), ...(actor ? {
        Authorization: `Bearer ${actor.token}`, Cookie: [...actor.cookies].filter(([key])=>!isolateRestAffinity||key!=='GAESA').map(([key, value]) => `${key}=${value}`).join('; '),
        } : {}) } }, (response) => {
        const instance = response.headers['x-grabit-rehearsal-instance'];
        const rss = Number(response.headers['x-grabit-rehearsal-rss-bytes']);
        if (typeof instance === 'string') { allInstances.add(instance); if (Number.isFinite(rss)) instanceMemory.set(instance, Math.max(instanceMemory.get(instance) ?? 0, Math.ceil(rss / 1048576))); }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          let data = null;
          try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* Empty response. */ }
          done({ instance, status: response.statusCode, cookies: response.headers['set-cookie'] ?? [], data });
        });
      });
      req.on('error', reject); req.end(encoded);
    });
    if (actor) for (const cookie of result.cookies) {
      const pair = cookie.split(';')[0]; const offset = pair.indexOf('=');
      if(isolateRestAffinity&&pair.slice(0,offset)==='GAESA')continue;
      actor.cookies.set(pair.slice(0, offset), pair.slice(offset + 1));
    }
    if (metric) record(metric, performance.now() - started, result.status, result.data?.outcome);
    return { status: result.status, data: result.data, instance: result.instance };
  } catch (error) {
    if (metric) record(metric, performance.now() - started, 'transport_error', error.code ?? error.cause?.code ?? error.name);
    return { status: 'transport_error', data: null };
  }
}

async function inBatches(values, action) {
  for (let start = 0; start < values.length; start += 64) await Promise.all(values.slice(start, start + 64).map(action));
}

async function warmConnections(values) {
  // Measure established customer sessions after TLS/process warm-up. Cold
  // connection storms remain a separate deployment test.
  await inBatches(values, async (actor) => {
    let result = await request(actor, '/api/v1/health');
    // The server may close an idle connection just as warm-up reuses it.
    if (result.status === 'transport_error') result = await request(actor, '/api/v1/health');
    assert.equal(result.status, 200, 'Connection warm-up must succeed before measurement');
  });
}

function metrics() {
  return Object.fromEntries([...samples].map(([name, values]) => {
    const times = values.map((v) => v.elapsed).sort((a, b) => a - b);
    const counts = (field) => values.reduce((out, value) => { const key = String(value[field] ?? 'none'); out[key] = (out[key] ?? 0) + 1; return out; }, {});
    const unexpectedErrors = values.filter((v) => v.status === 'transport_error' ||
      (Number(v.status) >= 400 && !(name === 'seat.contention' && v.status === 409)
        && !(name === 'checkout.duplicate-inflight' && v.status === 503))).length;
    return [name, { requests: values.length, unexpectedErrors, errorRate: unexpectedErrors / values.length,
      p50Ms: Math.round(times[Math.ceil(times.length * .5) - 1]),
      p95Ms: Math.round(times[Math.ceil(times.length * .95) - 1]), maxMs: Math.round(times.at(-1)),
      statuses: counts('status'), outcomes: counts('outcome') }];
  }));
}

async function actors(count, role) {
  const now = new Date();
  const identityRow=(await pool.query("SELECT coalesce(max(substring(phone FROM 6)::bigint),90000000)::bigint AS last_phone FROM users WHERE phone ~ '^[+]8210[0-9]{8}$'")).rows[0];
  const phoneStart=Number(identityRow.last_phone)+1;assert(phoneStart+count<100000000,'Synthetic phone identity space exhausted');
  const records = Array.from({ length: count }, (_, n) => ({ id: randomUUID(), email: `${role}-${n}-${randomUUID()}@example.test`,
    name: `Capacity ${role} ${n}`, phone: `+8210${String(phoneStart + n)}`, gender: 'unspecified', birthDate: '1990-01-01',
    role: role === 'scanner' ? 'admin' : 'user', adminCapabilityBundle: role === 'scanner' ? 'scanner' : null,
    isEmailVerified: true, isPhoneVerified: true }));
  await db.insert(schema.users).values(records);
  const output = records.map((user, index) => {
    const refresh = randomBytes(32).toString('base64url');
    const agent = new Agent({ keepAlive: true, maxSockets: 1 }); agents.push(agent);
    return { id: user.id, lane: index % apiInstances, token: jwt.sign({ sub: user.id, role: user.role }, { secret: jwtSecret, expiresIn: '1h' }),
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
    ...(!saleSeats ? [{ performanceId: event.id, dateTime: new Date('2099-01-02') }] : []),
  ]).returning();
  await db.insert(schema.bookingPolicies).values({ performanceId: event.id, maxTicketsPerUser: 4, bookingStartsAt: new Date('2020-01-01') });
  await db.insert(schema.priceTiers).values({ performanceId: event.id, tierName: 'VIP', price: 50000 });
  await db.insert(schema.seatMaps).values({ performanceId: event.id, totalSeats: saleSeats || count + 2,
    svgUrl: 'https://example.test/unused.svg', seatConfig: { tiers: [{ tierName: 'VIP', color: '#6C3CE0',
      seatIds: Array.from({ length: saleSeats || count + 2 }, (_, n) => `A-${n + 1}`) }] } });
  if (saleSeats) return { event, show };
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

// Every session that holds its own lock prepares and confirms on the same
// showtime, exercising real pool/seat contention and shared showtime locks.
// The PG is the in-process stub (pgLatencyMs per call).
function prepareBody(showtimeId, n, orderId) {
  return { orderId, showtimeId, amount: 52000, paymentDeadlineAt: new Date().toISOString(),
    seats: [{ seatId: `A-${n + 1}`, seatKey: `1F:A-${n + 1}`, floorKey: '1F', floorLabel: '1F', tierName: 'VIP', price: 50000, row: 'A', number: String(n + 1) }],
    consentItems: shared.BOOKING_CONSENT_ITEM_KEYS.map((key) => ({ key, version: shared.CONSENT_DOCUMENT_VERSIONS[key],
      language: shared.resolveConsentDocumentLanguage('ko'), accepted: true, sourceFlow: 'booking' })),
    bookingPolicy: { maxTicketsPerOrder: 4, cancellationChangePolicy: 'CANCEL_ONLY', sameGradeChangeEnabled: false },
    paymentMethod: { method: 'CARD', provider: 'CARD', currency: 'KRW' } };
}

async function checkout(holders, showtimeId) {
  const prepared = await Promise.all(holders.map(async ({ actor, n }) => {
    const orderId = `ISOLATED-${randomUUID()}`;
    const response = await request(actor, '/api/v1/reservations/prepare', { method: 'POST', body: prepareBody(showtimeId, n, orderId), metric: 'checkout.prepare' });
    return response.status === 201 ? { actor, orderId } : null;
  }));
  const ready = prepared.filter(Boolean);
  progress('prepared', { ready: ready.length, p95: Object.fromEntries(Object.entries(metrics()).map(([k,v])=>[k,v.p95Ms])) });
  if(prepareOnly)return {prepared:ready.length,diagnosticPrepared:true};
  // Concurrent callers are told to retry while the order lease is held (503).
  // After the winner commits, every API process must replay the same order.
  const first = ready[0];
  const body = first ? { paymentKey: `isolated_stub_${first.orderId}`, orderId: first.orderId, amount: 52000 } : null;
  // Keep initial attempts + all-instance replays within confirm's per-user
  // throttle. Four instances need one concurrent duplicate and four replays.
  const duplicateCopies = apiInstances === 4 ? [1] : [1, 2];
  const duplicates = first ? Promise.all(duplicateCopies.map(() => request({ ...first.actor, agent: undefined, lane: (first.actor.lane + 1) % apiInstances }, '/api/v1/payments/confirm', {
    method: 'POST', body, metric: 'checkout.duplicate-inflight',
  }))) : Promise.resolve([]);
  let completedConfirmCount=0;
  const confirmed = await Promise.all(ready.map(async ({ actor, orderId }, index) => {
    // This optional human/provider-think-time model is reported separately
    // from synchronized bursts. It never changes the measured request timer.
    if(confirmCadenceMs) await delay(index*confirmCadenceMs);
    const response=await (index===0?request:confirmLikeBrowser)(actor, '/api/v1/payments/confirm', {
      method: 'POST', body: { paymentKey: `isolated_stub_${orderId}`, orderId, amount: 52000 },
      metric: index === 0 ? 'checkout.duplicate-inflight' : 'checkout.confirm' });
    completedConfirmCount++;
    if(confirmCadenceMs && completedConfirmCount%50===0)progress('paced-confirm-progress',{completed:completedConfirmCount,cohort:ready.length});
    return response;
  }));
  const repeated = await duplicates;
  const contenders = first ? [confirmed[0], ...repeated] : [];
  const successful = (result) => result.status === 200 || result.status === 201;
  const winner = contenders.find(successful);
  const replays = [];
  if (first && winner) for (let index = 0; index < Math.max(2, apiInstances); index++) replays.push(await request({ ...first.actor, lane: index % apiInstances },
    '/api/v1/payments/confirm', { method: 'POST', body, metric: 'checkout.duplicate-replay' }));
  const duplicateConfirm = { initialStatuses: contenders.map((result) => result.status),
    replayStatuses: replays.map((result) => result.status),
    sameReservation: !!winner?.data?.id && replays.length === Math.max(2, apiInstances)
      && replays.every((result) => successful(result) && result.data?.id === winner.data.id) };
  return { confirmInstances:confirmed.reduce((out,r)=>{const k=r.instance??'none';out[k]=(out[k]??0)+1;return out;},{}), prepared: ready.length, confirmed: confirmed.slice(1).filter(successful).length + (winner ? 1 : 0),
    duplicateConfirmSucceeded: duplicateConfirm.sameReservation, duplicateConfirm };

}

async function confirmLikeBrowser(actor,path,options){
  const started=performance.now();let retries=0;
  for(;;){
    const response=await request(actor,path,{...options,metric:retries?options.metric+'.retry':options.metric});
    const success=response.status===200||response.status===201;
    const error=response.status==='transport_error'?new TypeError('Transport failure'):Object.assign(new Error(String(response.data?.message??'')),{statusCode:response.status});
    if(success||retries>=CONFIRM_PAYMENT_MAX_RETRIES||!isRetryableConfirmPaymentError(error)){
      record(options.metric+'.completed',performance.now()-started,response.status);
      if(retries){if(success)confirmRecovery.recoveredOrders++;else confirmRecovery.unrecoveredOrders++;}
      return response;
    }
    if(!retries)confirmRecovery.ordersRetried++;
    confirmRecovery.retryAttempts++;
    await delay(getConfirmPaymentRetryDelayMs(retries));retries++;
  }
}

// N Socket.IO clients join the showtime room before the lock storm; each
// seat-update is timed from the moment its lock request was sent.
function observeSocketCookies(socket,actor) {
  const ws=socket.io.engine?.transport?.ws;
  assert(ws?.on,'Node WebSocket upgrade response must be observable');
  ws.on('upgrade',response=>{
    cookieDiagnostics.upgradeResponses++;
    for(const cookie of response.headers['set-cookie']??[]) {
      const pair=cookie.split(';')[0],i=pair.indexOf('=');if(i<1)continue;
      const key=pair.slice(0,i),value=pair.slice(i+1);
      if(key==='GAESA'){cookieDiagnostics.affinityCookiesReceived++;if(actor.cookies.get(key)!==value)cookieDiagnostics.affinityCookieChanges++;}
      if(syncUpgradeCookies)actor.cookies.set(key,value);
    }
  });
}
async function openSeatSockets(showtimeId, count, lockSentAt, socketActors) {
  const { io } = webRequire('socket.io-client');
  const received = Array.from({ length: count }, () => new Set());
  received.latest=Array.from({length:count},()=>new Map());
  received.duplicateDeliveries = 0;
  await inBatches(Array.from({ length: count }, (_, index) => index), async (index) => {
    const actor=socketActors[index%socketActors.length];
    const socket = io(`${bases[index % apiInstances]}/booking`, { transports: ['websocket'], extraHeaders: { ...iamHeaders, Authorization: `Bearer ${actor.token}`, Cookie: [...actor.cookies].map(([k,v])=>`${k}=${v}`).join('; ') }, reconnection: true, reconnectionAttempts:10,reconnectionDelay:1000,reconnectionDelayMax:5000,forceNew: true, timeout: 20000 });
    let connectedBefore=false;
    socket.on('disconnect',reason=>{if(!expectedSocketClosures.has(socket))socketRecovery.disconnectReasons[reason]=(socketRecovery.disconnectReasons[reason]??0)+1;});
    socket.io.on('reconnect_failed',()=>socketRecovery.reconnectFailures++);
    socket.on('connect',()=>{
      if(!connectedBefore){connectedBefore=true;return;}
      socketRecovery.reconnections++;
      let acknowledged=false;
      const joined=()=>{
        if(acknowledged||expectedSocketClosures.has(socket))return;acknowledged=true;
        const pending=(async()=>{
          await delay(Math.floor(Math.random()*3000));
          if(expectedSocketClosures.has(socket))return;
          const r=await request(actor,`/api/v1/booking/schedules/${showtimeId}/seats`,{metric:'seat.resync'});
          if(r.status!==200||!r.data?.seats){socketRecovery.resyncFailures++;return;}
          socketRecovery.resyncs++;
          for(const [key,state] of Object.entries(r.data.seats))received.latest[index].set(key,state);
        })().finally(()=>recoveryReads.delete(pending));
        recoveryReads.add(pending);
      };
      socket.once('joined',joined);socket.emit('join-showtime',showtimeId,ack=>{if(ack?.event==='joined'||ack===showtimeId)joined();});
    });
    observeSocketCookies(socket,actor);
    openSockets.push(socket);
    await new Promise((done, fail) => { socket.once('connect', done); socket.once('connect_error', fail); });
    await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Socket.IO join-showtime timed out')), 10000);
      const joined = () => { clearTimeout(timer); done(); };
      socket.once('joined', joined);
      socket.emit('join-showtime', showtimeId, (ack) => { if (ack?.event === 'joined' || ack === showtimeId) joined(); });
    });
    // `locked` arrives as `seat-update.v2` (current API) or as the legacy
    // `seat-update` (API before the v2 event), never as both.
    const onSeatUpdate = (payload) => {
      if(payload?.seatId&&payload?.status)received.latest[index].set(payload.seatId,payload.status);
      const sentAt = payload?.status === 'locked' ? lockSentAt.get(payload.seatId) : undefined;
      if (sentAt === undefined) return;
      if (received[index].has(payload.seatId)) { received.duplicateDeliveries += 1; return; }
      received[index].add(payload.seatId);
      record('socket.seat-update', performance.now() - sentAt, 'delivered');
    };
    socket.on('seat-update.v2', onSeatUpdate);
    socket.on('seat-update', onSeatUpdate);
  });
  return received;
}

async function waitForDeliveries(received, expectedPerClient, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && received.some((value) => value.size < expectedPerClient)) {
    checkInterrupted();
    await delay(100);
  }
  return received.reduce((total, value) => total + Math.min(value.size, expectedPerClient), 0);
}

function closeSockets() {
  for (const socket of openSockets.splice(0)) {expectedSocketClosures.add(socket);socket.close();}
}

async function opening(count, buyers) {
  samples.clear(); instanceMemory.clear(); allInstances.clear();
  const started = performance.now();
  const f = await fixture(saleSeats, buyers);
  await pool.query('ANALYZE users, refresh_tokens, performances, showtimes, booking_policies, price_tiers, seat_maps');
  await closeFixturePool(); // no fixture connection competes with checkout pools
  const preflight = await request(buyers[0], `/api/v1/performances/${f.event.id}`);
  assert.equal(preflight.data?.title, f.event.title, 'Rehearsal API must read the synthetic fixture database');
  await warmConnections(buyers);
  progress('warm', { sessions: count, instancesObserved: allInstances.size });
  if(!entryOnly) {
    await Promise.all(buyers.map((actor) => request(actor, `/api/v1/performances/${f.event.id}`, { metric: 'performance.detail' })));
    await Promise.all(buyers.map((actor) => request(actor, `/api/v1/booking/schedules/${f.show.id}/seats`, { metric: 'seat.read' })));
  }
  const monitor = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
  let peakActiveAdmissions = 0, monitoringError, pollError;
  const pendingPolls=new Set(); let maxConcurrentPolls=0;
  const sockets = new Map(), admittedViaSocket = new Set();
  let positionMessages = 0, connected = 0;
  const readActive = async () => { peakActiveAdmissions = Math.max(peakActiveAdmissions, await monitor.scard(`{queue:${f.event.id}}:active`)); };
  const monitorTimer = setInterval(() => { void readActive().catch((e) => { monitoringError = e; }); }, 100);
  let pollTimer;
  try {
    const queue = await Promise.all(buyers.map(async (actor) => {
      const r = await request(actor, `/api/v1/queue/performances/${f.event.id}/enter`, { method: 'POST', body: {}, metric: 'queue.enter' });
      assert.equal(r.status, 201, 'Queue entry must accept each synthetic visitor');
      return { actor, sessionId: r.data.queueSessionId, state: r.data.state, position: r.data.position, processed: false, polling: false, nextPoll: performance.now() + 15000 + Math.random() * 5000 };
    }));
    const initialAdmitted = queue.filter((r) => r.state === 'ADMITTED').length;
    assert.equal(initialAdmitted, activeAdmissionLimit);
    progress('entered', { sessions: count, admitted: initialAdmitted, waiting: count - initialAdmitted, p95: Object.fromEntries(Object.entries(metrics()).map(([k,v])=>[k,v.p95Ms])) });
    if(entryOnly) {
      await readActive();const measured=metrics();const latencyTargetsPassed=measured['queue.enter'].p95Ms<=2000;
      summary.waves.push({sessions:count,admitted:initialAdmitted,waiting:count-initialAdmitted,peakActiveAdmissions,metrics:measured,latencyTargetsPassed,sloPassed:latencyTargetsPassed,invariantsPassed:initialAdmitted===activeAdmissionLimit&&peakActiveAdmissions<=activeAdmissionLimit,apiInstancesObserved:allInstances.size});
      return;
    }
    const apply = (r, snapshot) => { if (snapshot?.state) { r.state = snapshot.state; r.position = snapshot.position; if(queueSocketLimit<2000) void syncQueueSocket(r).catch(e=>{pollError=e;}); } };
    const pollRecord = async (r, metric = 'queue.status') => {
      assert(!r.polling, 'One in-flight poll per browser session'); r.polling = true;
      try {
        const response = await request(r.actor, `/api/v1/queue/sessions/${r.sessionId}`, { metric });
        if (response.status === 200) apply(r, response.data);
        else if (metric === 'queue.status.final') throw new Error('Final queue state could not be verified');
      } finally {
        r.polling = false;
        r.nextPoll = performance.now() + 15000 + Math.random() * 5000;
      }
    };
    pollTimer = setInterval(() => {
      const due = queue.filter((r) => !r.processed && !r.polling && r.state === 'WAITING' && r.nextPoll <= performance.now());
      if (!due.length) return;
      // Each browser schedules its next poll independently after completion.
      for (const r of due) {
        const pending = pollRecord(r).catch((e) => { pollError=e; }).finally(() => { pendingPolls.delete(pending); });
        pendingPolls.add(pending);
      }
      maxConcurrentPolls=Math.max(maxConcurrentPolls,pendingPolls.size);
    }, 100);
    const socketSetupStarted=performance.now();
    const { io } = webRequire('socket.io-client');
    async function syncQueueSocket(r) {
      const wanted=r.state==='WAITING' && (queueSocketLimit===2000 || (r.position>0 && r.position<=queueSocketLimit));
      if(!wanted) { sockets.get(r.sessionId)?.close();sockets.delete(r.sessionId);return; }
      if(sockets.has(r.sessionId))return;
      const socket = io(`${base}/queue`, { transports: ['websocket'], extraHeaders: { ...iamHeaders, Authorization: `Bearer ${r.actor.token}`, Cookie: [...r.actor.cookies].map(([k,v])=>`${k}=${v}`).join('; ') }, reconnection: false, forceNew: true, timeout: 20000 });
      observeSocketCookies(socket,r.actor);
      sockets.set(r.sessionId, socket);
      socket.on('queue:admitted', (snapshot) => { admittedViaSocket.add(r.sessionId); apply(r, snapshot); });
      socket.on('queue:position', (snapshot) => { positionMessages++; apply(r, snapshot); });
      await new Promise((done, fail) => { socket.once('connect', done); socket.once('connect_error', fail); });
      await new Promise((done, fail) => {
        const timer = setTimeout(() => fail(new Error('Queue socket join timed out')), 20000);
        const joined = () => { clearTimeout(timer); done(); };
        socket.once('joined', joined); socket.emit('join-queue-session', r.sessionId, (ack) => { if (ack?.event === 'joined' || ack === r.sessionId) joined(); });
      });
      connected++;
    }
    await inBatches(queue.filter(r=>r.state==='WAITING'),syncQueueSocket);
    progress('waiting-sockets-connected', { sessions: count, connected, setupMs:Math.round(performance.now()-socketSetupStarted), maxConcurrentPolls });
    const cohorts = []; let sold = 0, expectedDeliveries = 0, delivered = 0, duplicateDeliveries = 0;
    while (sold < targetSales) {
      const expected = Math.min(activeAdmissionLimit, saleSeats - sold);
      const ready = () => queue.filter((r) => !r.processed && r.state === 'ADMITTED');
      const deadline = Date.now() + 120000;
      while (ready().length < expected && Date.now() < deadline) { assert(!pollError); checkInterrupted(); await delay(200); }
      const cohort = ready(); assert.equal(cohort.length, expected, 'Configured capacity must refill');
      await delay(100);
      for (const r of cohort) sockets.get(r.sessionId)?.close();
      await readActive();
      const observingClients=Math.min(socketClients,cohort.length);
      const sent = new Map(); const received = await openSeatSockets(f.show.id, observingClients, sent, cohort.map(r=>r.actor));
      const receiverDelay=monitorEventLoopDelay({resolution:20});receiverDelay.enable();
      const receiverStart=performance.eventLoopUtilization();
      const holders = cohort.map((r, index) => ({ actor: r.actor, n: sold + index }));
      const locks = await Promise.all(holders.map(({ actor, n }) => {
        const seatId = `1F:A-${n + 1}`; sent.set(seatId, performance.now());
        return request(actor, '/api/v1/booking/seats/lock', { method: 'POST', body: { showtimeId: f.show.id, seatId }, metric: 'seat.lock' });
      }));
      assert(locks.every((r) => r.status === 201), 'Each admitted buyer must lock one seat');
      expectedDeliveries += observingClients * holders.length; delivered += await waitForDeliveries(received, holders.length); duplicateDeliveries += received.duplicateDeliveries;
      receiverDelay.disable();
      const receiverLoad={cohort:cohort.length,eventLoopUtilization:performance.eventLoopUtilization(receiverStart).utilization,eventLoopDelayP95Ms:Math.round(receiverDelay.percentile(95)/1e6),eventLoopDelayMaxMs:Math.round(receiverDelay.max/1e6)};
      (summary.loadGeneratorSeatBursts??=[]).push(receiverLoad);progress('seat-observer-load',receiverLoad);
      if(!holdSeatSockets)closeSockets();
      const sales = await checkout(holders, f.show.id);
      if(holdSeatSockets){
        const deadline=Date.now()+20000;
        const soldState=(map,n)=>map.get(`1F:A-${n+1}`)??map.get(`A-${n+1}`);
        const complete=()=>received.latest.every(map=>holders.every(({n})=>soldState(map,n)==='sold'));
        while(Date.now()<deadline&&!complete()){checkInterrupted();await delay(100);}
        await Promise.allSettled([...recoveryReads]);
        const live=openSockets.filter(s=>s.connected).length;
        (summary.seatHoldChecks??=[]).push({clients:observingClients,connectedAtEnd:live,finalSoldStatesComplete:complete()});
        assert.equal(live,observingClients,'Every held seat observer must reconnect');
        assert(complete(),'Every held seat observer must receive final sold states by event or reconnect snapshot');
      }
      if(holdSeatSockets)closeSockets();
      progress('checkout-cohort-result', { sessions: count, soldBefore: sold, sales });
      if(prepareOnly){const measured=metrics();const latencyTargetsPassed=Object.entries(measured).every(([k,v])=>v.p95Ms<=(['seat.lock','socket.seat-update'].includes(k)?1000:2000));summary.waves.push({sessions:count,diagnostic:'prepare-only',admitted:initialAdmitted,prepared:sales.prepared,peakActiveAdmissions,metrics:measured,latencyTargetsPassed,sloPassed:latencyTargetsPassed,invariantsPassed:sales.prepared===activeAdmissionLimit&&peakActiveAdmissions<=activeAdmissionLimit,apiInstancesObserved:allInstances.size});return;}
      assert.equal(sales.prepared, cohort.length); assert.equal(sales.confirmed, cohort.length); assert(sales.duplicateConfirmSucceeded);
      cohort.forEach((r) => { r.processed = true; }); sold += sales.confirmed; cohorts.push({ buyers: cohort.length, ...sales });
      progress('cohort-completed', { sessions: count, sold, confirmed: sales.confirmed }); await delay(2200);
    }
    clearInterval(pollTimer); pollTimer = undefined;
    await Promise.allSettled([...pendingPolls]);
    assert(!pollError && !monitoringError);
    const remaining = queue.filter((r) => !r.processed);
    await inBatches(remaining, (r) => pollRecord(r, 'queue.status.final'));
    await readActive();
    await openFixturePool();
    const row = (await pool.query(`SELECT
      (SELECT count(*)::int FROM seat_inventories WHERE showtime_id=$1 AND status='sold') AS sold,
      (SELECT count(*)::int FROM reservations WHERE showtime_id=$1 AND status='CONFIRMED') AS confirmed,
      (SELECT count(*)::int FROM ticket_items WHERE showtime_id=$1 AND status='active') AS items,
      (SELECT count(*)::int FROM tickets WHERE showtime_id=$1 AND status='active') AS credentials`, [f.show.id])).rows[0];
    await closeFixturePool();
    const positions = remaining.map((r) => r.position).sort((a,b) => a-b);
    const result = { sessions: count, seats: saleSeats, admitted: initialAdmitted, initialWaiting: count - initialAdmitted, finalWaiting: remaining.length, peakActiveAdmissions, activeAdmissionLimit,
      cohorts, maxConcurrentPolls, durationMs: Math.round(performance.now()-started), checkout: row, queueSockets: { connected, admissionEventsReceived: admittedViaSocket.size, expectedAdmissionEvents: saleSeats - initialAdmitted, positionMessages },
      socketFanout: { clients: socketClients, expectedDeliveries, delivered, duplicateDeliveries }, apiRssMiBObservedMax: [...instanceMemory.values()], apiInstancesObserved: allInstances.size, metrics: metrics() };
    result.invariantsPassed = Object.values(row).every((v) => v === saleSeats) && sold === saleSeats && peakActiveAdmissions <= activeAdmissionLimit && remaining.length === count-saleSeats
      && positions.every((p,i) => p===i+1) && remaining.every((r) => r.state === 'WAITING') && (queueSocketLimit<2000 || admittedViaSocket.size === saleSeats-initialAdmitted) && delivered === expectedDeliveries && duplicateDeliveries===0;
    result.latencyTargetsPassed = Object.entries(result.metrics).every(([name,m]) => m.p95Ms <= (['seat.lock','socket.seat-update'].includes(name) ? 1000 : 2000));
    result.paymentConfirmTargetPassed=result.metrics['checkout.confirm.completed']?.p95Ms<=2000 && result.metrics['checkout.confirm.completed']?.unexpectedErrors===0;
    result.memoryBudgetPassed = result.apiRssMiBObservedMax.length > 0 && result.apiRssMiBObservedMax.every((v) => v <= 512);
    result.sloPassed = result.invariantsPassed && result.latencyTargetsPassed && result.memoryBudgetPassed && result.apiInstancesObserved >= 2 && Object.values(result.metrics).every((m) => m.errorRate < .01);
    summary.waves.push(result); progress('wave-completed', { sessions: count, sloPassed: result.sloPassed, invariantsPassed: result.invariantsPassed, instances: result.apiInstancesObserved, memoryMiB: result.apiRssMiBObservedMax, p95: Object.fromEntries(Object.entries(result.metrics).map(([k,v]) => [k,v.p95Ms])) });
    await writeFile(output, JSON.stringify(summary));
  } finally {
    clearInterval(monitorTimer); if (pollTimer) clearInterval(pollTimer); await Promise.allSettled([...pendingPolls]); closeSockets(); for (const socket of sockets.values()) socket.close(); await monitor.quit().catch(() => monitor.disconnect());
  }
}
try {
  await assertRedisNotBoundToProduction();
  const liveApi=await googleGet('https://run.googleapis.com/v2/projects/grapit-491806/locations/asia-northeast3/services/grabit-rehearsal-'+config.id);
  const liveResources=liveApi.template.containers[0].resources.limits;
  assert(['1','2'].includes(liveResources.cpu)&&liveResources.memory==='512Mi','Unexpected measured API resources');
  summary.apiResources.cpu=Number(liveResources.cpu);
  summary.apiResources.minInstances=liveApi.scaling?.minInstanceCount??0;
  summary.apiResources.maxInstances=liveApi.scaling?.maxInstanceCount??liveApi.template.scaling?.maxInstanceCount;
  assert.equal(summary.apiResources.maxInstances,apiInstances,'Measured maximum API instances must match the workload metadata');
  summary.apiRevision=liveApi.latestReadyRevision;
  summary.apiScaling=liveApi.scaling;

  for (const count of waveSizes) {
    await openFixturePool(); const buyers = await actors(count, 'buyer'); await opening(count, buyers);
    for (const actor of buyers) actor.agent.destroy(); await delay(1000);
  }
  summary.status = entryOnly||prepareOnly ? (summary.waves.every(w=>w.sloPassed)?'diagnostic_passed':'diagnostic_limited') : diagnosticCohorts ? 'diagnostic_only' : summary.waves.every((w) => w.sloPassed) ? 'passed' : 'capacity_limited';
} catch (error) {
  summary.status = 'failed'; summary.partialMetrics = metrics(); summary.partialMemoryMiB = [...instanceMemory.values()]; summary.partialApiInstances = allInstances.size; summary.error = { name: error.name, code: error.code ?? null, message: /AssertionError/.test(error.name) ? error.message.slice(0,600) : 'Private diagnostic required; credentials suppressed' };
} finally {
  await closeFixturePool().catch(() => {}); closeSockets(); for (const agent of agents) agent.destroy();
  if(process.env.REHEARSAL_PROFILE_CONFIRM==='1'){
    const profiles=new Map();for(let i=0;i<32;i++){const r=await request(null,'/api/v1/__rehearsal/profile');if(r.data?.instance)profiles.set(r.data.instance,r.data);if(profiles.size>=2)break;}summary.confirmProfiles=[...profiles.values()];
  }
  summary.completedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(summary));
  console.log(JSON.stringify({ kind: 'cloud-capacity-result', result: summary }));
  if (!['passed','diagnostic_passed'].includes(summary.status)) process.exitCode = 1;
}
