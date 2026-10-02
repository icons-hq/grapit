import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INSTANCE,
  PreflightError,
  assertServerIdentity,
  failureMessage,
  parseArgs,
  parseDatabaseUrl,
  serverIdentity,
} from './production-preflight.mjs';

const SECRET = 'Pw-unit-3b9e';

test('parses the Cloud Run unix-socket DATABASE_URL form that WHATWG URL rejects', () => {
  const raw = `postgresql://grapit_app:${SECRET}@/grapit?host=/cloudsql/${INSTANCE}`;
  assert.throws(() => new URL(raw));
  assert.deepEqual(parseDatabaseUrl(raw), { user: 'grapit_app', password: SECRET, database: 'grapit' });
  assert.deepEqual(parseDatabaseUrl(`postgres://grapit_app:p%40ss%2Fword@/grapit?host=/cloudsql/${INSTANCE}`),
    { user: 'grapit_app', password: 'p@ss/word', database: 'grapit' });
});

test('turns every parse or target failure into a fixed message without the secret', () => {
  const cases = [
    [undefined, 'invalid_database_url'],
    [`postgresql://grapit_app:${SECRET}@[broken/grapit?host=/cloudsql/${INSTANCE}`, 'invalid_database_url'],
    [`postgresql://grapit_app:${SECRET}%ZZ@/grapit?host=/cloudsql/${INSTANCE}`, 'invalid_database_url'],
    [`mysql://grapit_app:${SECRET}@/grapit?host=/cloudsql/${INSTANCE}`, 'invalid_database_url'],
    [`postgresql://grapit_app:${SECRET}@/other?host=/cloudsql/${INSTANCE}`, 'unexpected_database'],
    [`postgresql://grapit_app:${SECRET}@/grapit?host=/cloudsql/grapit-491806:asia-northeast3:grapit-db`, 'unexpected_instance'],
  ];
  for (const [raw, code] of cases) {
    let caught;
    try { parseDatabaseUrl(raw); } catch (error) { caught = error; }
    assert.ok(caught instanceof PreflightError, String(code));
    assert.equal(caught.code, code);
    const printed = `${failureMessage(caught)} ${JSON.stringify(caught)} ${caught.stack}`;
    assert.ok(!printed.includes(SECRET), `secret leaked for ${code}`);
  }
  assert.equal(failureMessage(new TypeError(`Invalid URL ${SECRET}`)).includes(SECRET), false);
});

test('an external proxy port requires the server identity recorded by a script-managed run', () => {
  const id = serverIdentity('7691968773436092450');
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.throws(() => parseArgs(['--read-only', '--output=/private/a.json', '--proxy-port=15439']), { code: 'invalid_arguments' });
  assert.throws(() => parseArgs(['--read-only', '--output=relative.json']), { code: 'invalid_arguments' });
  assert.deepEqual(parseArgs(['--read-only', '--output=/private/a.json', '--proxy-port=15439', `--expected-server-id=${id}`]), {
    readOnly: true, output: '/private/a.json', baselinePath: undefined, proxyPort: 15439, expectedServerId: id, expectedMigrations: null,
  });
  assert.equal(parseArgs(['--read-only', '--output=/private/a.json']).proxyPort, null);
});

test('refuses a connected server that differs from the expected or baseline server', () => {
  const current = serverIdentity('1');
  const other = serverIdentity('2');
  assert.doesNotThrow(() => assertServerIdentity({ current, expected: current, baseline: { server: { identity: current } } }));
  assert.throws(() => assertServerIdentity({ current, expected: other, baseline: null }), { code: 'server_identity_mismatch' });
  assert.throws(() => assertServerIdentity({ current: null, expected: current, baseline: null }), { code: 'server_identity_unavailable' });
  assert.throws(() => assertServerIdentity({ current, expected: null, baseline: { server: { identity: other } } }), { code: 'baseline_server_mismatch' });
  assert.throws(() => assertServerIdentity({ current, expected: null, baseline: {} }), { code: 'baseline_server_identity_missing' });
  assert.doesNotThrow(() => assertServerIdentity({ current: null, expected: null, baseline: null }));
});
