import assert from 'node:assert/strict';
export const TEST_TOSS_SECRET = 'test_sk_grabit_cloud_rehearsal';
export function guard(env, kind) {
  assert.equal(env.GRABIT_CLOUD_REHEARSAL, 'synthetic-600-seat-only', 'Cloud rehearsal approval marker required');
  assert.equal(env.NODE_ENV, 'test', 'Rehearsal must never run as production');
  const id = env.GRABIT_REHEARSAL_ID;
  assert(/^[a-z0-9][a-z0-9-]{5,24}$/.test(id ?? ''), 'Invalid rehearsal ID');
  const database = `grabit_rehearsal_${id.replaceAll('-', '_')}`;
  assert.equal(kind === 'api' ? env.K_SERVICE : env.CLOUD_RUN_JOB, kind === 'api' ? `grabit-rehearsal-${id}` : `grabit-load-${id}`, 'Unexpected Cloud Run identity');
  assert.equal(env.BACKGROUND_PROCESSING_ENABLED, 'false', 'Background side effects must be disabled');
  assert.equal(env.TOSS_SECRET_KEY, TEST_TOSS_SECRET, 'Only the non-provider test key is permitted');
  for (const [key, value] of Object.entries(env)) {
    if (/^(RESEND_|INFOBIP_|TWILIO_|R2_|DEEPL_|SENTRY_DSN|KAKAO_CLIENT|NAVER_CLIENT|GOOGLE_CLIENT)/.test(key)) assert(!value, 'Outbound service credentials are forbidden');
    if (key.startsWith('TOSS_') && key !== 'TOSS_SECRET_KEY') assert(!value, 'Additional payment credentials are forbidden');
  }
  const expiry = Date.parse(env.GRABIT_REHEARSAL_EXPIRES_AT ?? '');
  assert(Number.isFinite(expiry) && expiry > Date.now() && expiry < Date.now() + 24 * 3600000, 'Rehearsal authorization expired or excessive');
  let url;
  try { url = new URL(env.DATABASE_URL?.replace(/^(postgres(?:ql)?:\/\/[^/?#]*)@\//, '$1@localhost/')); }
  catch { throw new Error('Invalid synthetic database binding'); }
  assert(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL required');
  assert.equal(decodeURIComponent(url.pathname.slice(1)), database, 'Production database binding forbidden');
  assert.equal(decodeURIComponent(url.username), database, 'Dedicated database owner required');
  assert.equal(url.searchParams.get('host'), '/cloudsql/grapit-491806:asia-northeast3:grabit-db-capfix-20261029', 'Unexpected Cloud SQL instance');
  const db = { host: url.searchParams.get('host'), database, user: database, password: decodeURIComponent(url.password), max: 1, connectionTimeoutMillis: 10000 };
  const redis = new URL(env.REDIS_URL);
  assert(['redis:', 'rediss:'].includes(redis.protocol) && (!redis.pathname || redis.pathname === '/' || redis.pathname === '/0'), 'Invalid Valkey binding');
  assert.equal(env.REHEARSAL_VALKEY_INSTANCE, 'grabit-valkey-capfix-20261029', 'Only the new, unbound HA target is permitted');
  assert(env.QR_TICKET_SECRET_VERSION?.trim(), 'QR signing key version is required');
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'QR_TICKET_SECRET']) assert((env[key]?.length ?? 0) >= 32, 'Dedicated signing secret required');
  return { id, database, db, redisHost: redis.hostname };
}
export function guardApiUrl(value, id) {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:');
  assert(url.hostname.startsWith(`grabit-rehearsal-${id}-`) && url.hostname.endsWith('.run.app'), 'Only the private rehearsal API is permitted');
  assert(url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash, 'Unexpected API URL structure');
  return url.origin;
}
