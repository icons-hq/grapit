import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IDENTITY_SOURCES,
  INSTANCE,
  PreflightError,
  assertServerIdentity,
  failureMessage,
  parseArgs,
  parseDatabaseUrl,
  postmasterServerIdentity,
  readServerIdentity,
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
  const current = { identity: serverIdentity('1'), source: IDENTITY_SOURCES.control };
  const other = serverIdentity('2');
  const baselineOf = (identity, source) => ({ server: { identity, ...(source ? { source } : {}) } });
  assert.doesNotThrow(() => assertServerIdentity({ current, expected: current.identity, baseline: baselineOf(current.identity, current.source) }));
  // Baselines recorded before the source field existed came from pg_control_system().
  assert.doesNotThrow(() => assertServerIdentity({ current, expected: null, baseline: baselineOf(current.identity) }));
  assert.throws(() => assertServerIdentity({ current, expected: other, baseline: null }), { code: 'server_identity_mismatch' });
  assert.throws(() => assertServerIdentity({ current, expected: null, baseline: baselineOf(other) }), { code: 'baseline_server_mismatch' });
  assert.throws(() => assertServerIdentity({ current, expected: null, baseline: {} }), { code: 'baseline_server_identity_missing' });
  const fallback = { identity: postmasterServerIdentity({ postmasterStartMicros: '1790000000000000', databaseOid: '16384' }),
    source: IDENTITY_SOURCES.postmaster };
  assert.throws(() => assertServerIdentity({ current: fallback, expected: null, baseline: baselineOf(current.identity, current.source) }),
    { code: 'baseline_server_identity_source_mismatch' });
});

test('an unidentified server is refused on every run, including the first baseline capture', () => {
  for (const current of [null, { identity: null, source: IDENTITY_SOURCES.control }]) {
    assert.throws(() => assertServerIdentity({ current, expected: null, baseline: null }), { code: 'server_identity_unavailable' });
    assert.throws(() => assertServerIdentity({ current, expected: serverIdentity('1'), baseline: null }), { code: 'server_identity_unavailable' });
  }
});

function fakeClient(answers) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      const answer = answers.find(([pattern]) => pattern.test(sql))?.[1];
      if (answer instanceof Error) throw answer;
      return { rows: answer ?? [] };
    },
  };
}

test('falls back to the postmaster identity when pg_control_system() is not granted', async () => {
  const denied = new Error('permission denied for function pg_control_system');
  const control = await readServerIdentity(fakeClient([[/pg_control_system/, [{ id: '7691968773436092450' }]]]));
  assert.deepEqual(control, { identity: serverIdentity('7691968773436092450'), source: IDENTITY_SOURCES.control });

  const fallback = await readServerIdentity(fakeClient([[/pg_control_system/, denied],
    [/pg_postmaster_start_time/, [{ started: '1790000000123456', database_oid: '16384' }]]]));
  assert.deepEqual(fallback, {
    identity: postmasterServerIdentity({ postmasterStartMicros: '1790000000123456', databaseOid: '16384' }),
    source: IDENTITY_SOURCES.postmaster,
  });
  assert.notEqual(fallback.identity,
    postmasterServerIdentity({ postmasterStartMicros: '1790000000123457', databaseOid: '16384' }), 'a restarted or other server differs');

  assert.equal(await readServerIdentity(fakeClient([[/pg_control_system/, denied], [/pg_postmaster_start_time/, denied]])), null);
});
