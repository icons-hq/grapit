import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { StartedTestContainer } from 'testcontainers';
import { startPostgresContainer } from './helpers/postgres-container.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const INSTANCE = 'grapit-491806:asia-northeast3:grabit-db-managed-demo';
const SCRIPT = resolve('../../scripts/revamp/production-preflight.mjs');

// Stand-in for `cloud-sql-proxy`: it records its arguments and environment,
// then forwards loopback connections to the disposable container only.
const FAKE_PROXY = `#!/usr/bin/env node
import { connect, createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
writeFileSync(process.env.FAKE_PROXY_RECORD, JSON.stringify({ args, receivedSecret: 'REVAMP_PROD_DATABASE_URL' in process.env }));
const port = Number(args.find((arg) => arg.startsWith('--port='))?.slice(7));
if (args[0] !== process.env.FAKE_PROXY_EXPECTED_INSTANCE || !args.includes('--address=127.0.0.1')) {
  console.error('unexpected instance');
  process.exit(1);
}
const server = createServer((socket) => {
  const upstream = connect(Number(process.env.FAKE_PROXY_UPSTREAM_PORT), process.env.FAKE_PROXY_UPSTREAM_HOST);
  socket.pipe(upstream).pipe(socket);
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});
server.listen(port, '127.0.0.1', () => console.log('The proxy has started successfully and is ready for new connections!'));
process.on('SIGTERM', () => process.exit(0));
`;

describe('Revamp read-only release evidence', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let work: string;
  let connection: string;
  let fakeProxy: string;
  let serverId: string;
  beforeAll(async () => {
    const postgres = await startPostgresContainer({ database: 'grapit' });
    container = postgres.container;
    connection = postgres.connectionString;
    pool = new Pool({ connectionString: connection });
    await migrate(drizzle(pool), { migrationsFolder: 'src/database/migrations' });
    work = await mkdtemp(join(tmpdir(), 'grabit-preflight-test-'));
    fakeProxy = join(work, 'fake-cloud-sql-proxy.mjs');
    await writeFile(fakeProxy, FAKE_PROXY);
    await chmod(fakeProxy, 0o755);
    const { rows } = await pool.query<{ id: string }>('SELECT system_identifier::text AS id FROM pg_control_system()');
    serverId = createHash('sha256').update(rows[0]!.id).digest('hex');
  }, 120000);
  afterAll(async () => { await pool?.end(); await container?.stop(); if (work) await rm(work, { recursive: true, force: true }); });

  function run(databaseUrl: string, args: string[], env: Record<string, string> = {}) {
    // The script's production identity guard is exercised against only this
    // disposable container. No Cloud SQL proxy, secret or network is used.
    const result = spawnSync(process.execPath, [SCRIPT, '--read-only', ...args], {
      env: { ...process.env, REVAMP_PROD_DATABASE_URL: databaseUrl, ...env }, encoding: 'utf8', timeout: 60000,
    });
    return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  function tcpUrl() {
    const original = new URL(connection);
    original.searchParams.set('host', `/cloudsql/${INSTANCE}`);
    return original.toString();
  }

  function managedProxyEnv(record: string, expectedInstance = INSTANCE) {
    return {
      CLOUD_SQL_PROXY_BIN: fakeProxy,
      FAKE_PROXY_RECORD: record,
      FAKE_PROXY_EXPECTED_INSTANCE: expectedInstance,
      FAKE_PROXY_UPSTREAM_HOST: container.getHost(),
      FAKE_PROXY_UPSTREAM_PORT: String(container.getMappedPort(5432)),
    };
  }

  async function capture(name: string, baseline?: string) {
    const output = join(work, `${name}.json`);
    const result = run(tcpUrl(), [`--proxy-port=${container.getMappedPort(5432)}`, `--expected-server-id=${serverId}`,
      `--output=${output}`, ...(baseline ? [`--baseline=${baseline}`] : [])]);
    const raw = await readFile(output, 'utf8');
    return { output, raw, data: JSON.parse(raw), exitCode: result.exitCode };
  }

  it('keeps evidence private, allows new records, and fails on removed identities or changed original amounts', async () => {
    const buyer = randomUUID(); const event = randomUUID(); const show = randomUUID();
    const reservation = randomUUID(); const payment = randomUUID(); const removable = randomUUID();
    await pool.query(`INSERT INTO users (id,email,name,phone,gender,birth_date)
      VALUES ($1,'preflight-private@example.test','Private buyer','+82100000000','unspecified','1990-01-01')`, [buyer]);
    await pool.query(`INSERT INTO performances (id,title,genre,start_date,end_date,age_rating)
      VALUES ($1,'Preflight event','artist_celebrity','2099-12-01','2099-12-02','All')`, [event]);
    await pool.query(`INSERT INTO showtimes (id,performance_id,date_time) VALUES ($1,$2,'2099-12-01')`, [show, event]);
    await pool.query(`INSERT INTO reservations (id,user_id,showtime_id,reservation_number,toss_order_id,status,total_amount,cancel_deadline)
      VALUES ($1,$2,$3,'PREFLIGHT-ORDER','preflight-order','CONFIRMED',104000,'2099-11-30')`, [reservation, buyer, show]);
    await pool.query(`INSERT INTO payments (id,reservation_id,payment_key,toss_order_id,method,provider,currency,amount,status)
      VALUES ($1,$2,'private-provider-key','preflight-order','CARD','CARD','KRW',104000,'DONE')`, [payment, reservation]);
    await pool.query(`INSERT INTO consent_items (id,key,version,locale,title,body,is_required)
      VALUES ($1,'preflight-consent','v1','en','Original consent','Original wording',false)`, [removable]);
    await pool.query(`INSERT INTO refunds (reservation_id,payment_id,provider,status,provider_metadata,completed_at)
      VALUES ($1,$2,'CARD','completed','{"cancelAmount":52000}',now())`, [reservation, payment]);
    await pool.query(`INSERT INTO admin_audit_logs (actor_user_id,action,resource_type,resource_id,status,reason)
      VALUES ($1,'refund.admin_refund','reservation',$2,'success','Original audited reason')`, [buyer, reservation]);

    const before = await capture('before');
    expect(before.exitCode).toBe(0);
    expect(before.data.readOnly).toBe(true);
    expect(before.data.connection).toEqual({ proxy: 'external', instance: INSTANCE });
    expect(before.data.server.identity).toBe(serverId);
    for (const privateValue of [buyer, reservation, payment, 'preflight-private@example.test', 'Private buyer', 'private-provider-key']) {
      expect(before.raw).not.toContain(privateValue);
    }
    await pool.query(`UPDATE users SET preferred_locale='th' WHERE id=$1`, [buyer]);
    await pool.query(`INSERT INTO consent_items (key,version,locale,title,body,is_required)
      VALUES ('new-consent','v1','en','New consent','New wording',false)`);
    const changed = await capture('changed', before.output);
    expect(changed.exitCode).toBe(0);
    expect(changed.data.preservationPassed).toBe(true);
    expect(changed.data.comparison.users.originalChanged).toBe(1);
    expect(changed.data.comparison.consent_items.added).toBe(1);

    await pool.query(`UPDATE refunds SET provider_metadata='{"cancelAmount":1}' WHERE payment_id=$1`, [payment]);
    await pool.query(`UPDATE admin_audit_logs SET reason='Changed audited reason' WHERE actor_user_id=$1`, [buyer]);
    const tampered = await capture('tampered', before.output);
    expect(tampered.exitCode).toBe(2);
    expect(tampered.data.comparison.refunds.immutableChanged).toBe(1);
    expect(tampered.data.comparison.admin_audit_logs.immutableChanged).toBe(1);

    await pool.query('UPDATE payments SET amount=103999 WHERE id=$1', [payment]);
    await pool.query('DELETE FROM consent_items WHERE id=$1', [removable]);
    await pool.query('DELETE FROM refunds WHERE payment_id=$1', [payment]);
    await pool.query('DELETE FROM admin_audit_logs WHERE actor_user_id=$1', [buyer]);
    const broken = await capture('broken', before.output);
    expect(broken.exitCode).toBe(2);
    expect(broken.data.preservationPassed).toBe(false);
    expect(broken.data.comparison.payments.immutableChanged).toBe(1);
    expect(broken.data.comparison.consent_items.missing).toBe(1);
    expect(broken.data.comparison.refunds.missing).toBe(1);
    expect(broken.data.comparison.admin_audit_logs.missing).toBe(1);
  }, 30000);

  it('accepts the Cloud Run unix-socket secret through a script-managed proxy without printing the password', async () => {
    const password = 'Pw-preflight-socket-7c1d';
    await pool.query(`ALTER ROLE postgres PASSWORD '${password}'`);
    try {
      const record = join(work, 'managed-proxy.json');
      const output = join(work, 'managed.json');
      const socketUrl = `postgresql://postgres:${password}@/grapit?host=/cloudsql/${INSTANCE}`;
      const result = run(socketUrl, [`--output=${output}`], managedProxyEnv(record));
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}${result.stderr}`).not.toContain(password);
      const evidence = JSON.parse(await readFile(output, 'utf8'));
      expect(evidence.connection).toEqual({ proxy: 'script-managed', instance: INSTANCE });
      expect(evidence.server.identity).toBe(serverId);
      expect(JSON.stringify(evidence)).not.toContain(password);
      const proxy = JSON.parse(await readFile(record, 'utf8'));
      expect(proxy.args[0]).toBe(INSTANCE);
      expect(proxy.receivedSecret).toBe(false);
      expect((await stat(output)).mode & 0o777).toBe(0o600);
    } finally {
      await pool.query(`ALTER ROLE postgres PASSWORD 'test'`);
    }
  }, 30000);

  it('proves a configured Cloud SQL instance through the script-managed proxy (audit #166, D7)', async () => {
    // A sale-capacity restore may replace the instance; --instance or the environment
    // names it, and the proxy, secret check, evidence target and baseline follow it.
    const saleInstance = 'grapit-491806:asia-northeast3:grabit-db-sale';
    const password = 'Pw-preflight-instance-5b2e';
    await pool.query(`ALTER ROLE postgres PASSWORD '${password}'`);
    try {
      const socketUrl = `postgresql://postgres:${password}@/grapit?host=/cloudsql/${saleInstance}`;
      const record = join(work, 'sale-proxy.json');
      const output = join(work, 'sale.json');
      const result = run(socketUrl, [`--output=${output}`, `--instance=${saleInstance}`], managedProxyEnv(record, saleInstance));
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(`${result.stdout}${result.stderr}`).not.toContain(password);
      const proxy = JSON.parse(await readFile(record, 'utf8'));
      expect(proxy.args[0]).toBe(saleInstance);
      expect(proxy.receivedSecret).toBe(false);
      const evidence = JSON.parse(await readFile(output, 'utf8'));
      expect(evidence.target).toBe('grabit-db-sale/grapit');
      expect(evidence.connection).toEqual({ proxy: 'script-managed', instance: saleInstance });

      // The environment variable selects the same instance, and its baseline is accepted.
      const envRecord = join(work, 'sale-env-proxy.json');
      const after = join(work, 'sale-after.json');
      const fromEnv = run(socketUrl, [`--output=${after}`, `--baseline=${output}`],
        { ...managedProxyEnv(envRecord, saleInstance), REVAMP_PROD_CLOUD_SQL_INSTANCE: saleInstance });
      expect(fromEnv.stderr).toBe('');
      expect(fromEnv.exitCode).toBe(0);
      expect(JSON.parse(await readFile(envRecord, 'utf8')).args[0]).toBe(saleInstance);
      expect(JSON.parse(await readFile(after, 'utf8')).preservationPassed).toBe(true);

      // Without the option the managed-demo default refuses the sale secret before any proxy starts,
      // and a baseline of the other instance is not comparable.
      const unconfigured = run(socketUrl, [`--output=${join(work, 'sale-default.json')}`],
        managedProxyEnv(join(work, 'sale-unused.json'), saleInstance));
      expect(unconfigured.exitCode).toBe(1);
      expect(unconfigured.stderr).toContain('code=unexpected_instance');
      const demoUrl = `postgresql://postgres:${password}@/grapit?host=/cloudsql/${INSTANCE}`;
      const crossed = run(demoUrl, [`--output=${join(work, 'sale-crossed.json')}`, `--baseline=${output}`],
        managedProxyEnv(join(work, 'sale-crossed-proxy.json')));
      expect(crossed.exitCode).toBe(1);
      expect(crossed.stderr).toContain('code=invalid_baseline');

      const invalid = run(socketUrl, [`--output=${join(work, 'sale-invalid.json')}`, '--instance=grabit-db-sale'],
        managedProxyEnv(join(work, 'sale-invalid-proxy.json'), saleInstance));
      expect(invalid.exitCode).toBe(1);
      expect(invalid.stderr).toContain('code=invalid_arguments');
    } finally {
      await pool.query(`ALTER ROLE postgres PASSWORD 'test'`);
    }
  }, 60000);

  it('fails with a fixed message and never echoes an unparseable secret', async () => {
    const password = 'Pw-unparseable-9e4f';
    const output = join(work, 'unparseable.json');
    for (const databaseUrl of [
      `postgresql://postgres:${password}@[bad/grapit?host=/cloudsql/${INSTANCE}`,
      `postgresql://postgres:${password}@/grapit?host=/cloudsql/other-project:region:other-instance`,
      `postgresql://postgres:${password}%ZZ@/grapit?host=/cloudsql/${INSTANCE}`,
    ]) {
      const result = run(databaseUrl, [`--output=${output}`], managedProxyEnv(join(work, 'unused.json')));
      expect(result.exitCode).toBe(1);
      expect(`${result.stdout}${result.stderr}`).not.toContain(password);
      expect(result.stderr).toMatch(/code=(invalid_database_url|unexpected_instance)/);
    }
    await expect(stat(output)).rejects.toThrow();
  });

  it('identifies the server without pg_control_system() and refuses a server it cannot identify', async () => {
    // Managed PostgreSQL may not grant pg_control_system() to the application role.
    const role = 'preflight_reader';
    const password = 'Pw-preflight-reader-2d8a';
    await pool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    await pool.query(`GRANT USAGE ON SCHEMA public, drizzle TO ${role}`);
    await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO ${role}`);
    await pool.query('REVOKE EXECUTE ON FUNCTION pg_control_system() FROM PUBLIC');
    try {
      const readerUrl = `postgresql://${role}:${password}@/grapit?host=/cloudsql/${INSTANCE}`;
      const { rows } = await pool.query<{ started: string; oid: string }>(`SELECT
        (extract(epoch FROM pg_postmaster_start_time()) * 1000000)::bigint::text AS started,
        (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid`);
      const fallbackId = createHash('sha256').update(`postmaster:${rows[0]!.started}:database:${rows[0]!.oid}`).digest('hex');
      const proxyEnv = managedProxyEnv(join(work, 'reader-proxy.json'));

      const beforePath = join(work, 'reader-before.json');
      const before = run(readerUrl, [`--output=${beforePath}`], proxyEnv);
      expect(before.stderr).toBe('');
      expect(before.exitCode).toBe(0);
      const evidence = JSON.parse(await readFile(beforePath, 'utf8'));
      expect(evidence.server).toEqual({
        identity: fallbackId,
        source: 'sha256(pg_postmaster_start_time() microseconds + database oid)',
      });
      expect(evidence.server.identity).not.toBe(serverId);

      const afterPath = join(work, 'reader-after.json');
      const after = run(readerUrl, [`--output=${afterPath}`, `--baseline=${beforePath}`], proxyEnv);
      expect(after.exitCode).toBe(0);
      expect(JSON.parse(await readFile(afterPath, 'utf8')).preservationPassed).toBe(true);

      // A baseline identified through pg_control_system() is never compared with a fallback identity.
      const controlBaseline = await capture('control-source-baseline');
      expect(controlBaseline.data.server.source).toBe('sha256(pg_control_system().system_identifier)');
      const crossedPath = join(work, 'reader-crossed.json');
      const crossed = run(readerUrl, [`--output=${crossedPath}`, `--baseline=${controlBaseline.output}`], proxyEnv);
      expect(crossed.exitCode).toBe(1);
      expect(crossed.stderr).toContain('code=baseline_server_identity_source_mismatch');
      expect(await readFile(crossedPath, 'utf8')).toBe('');

      // With no identity source left, even the first capture is refused before any table is read.
      await pool.query('REVOKE EXECUTE ON FUNCTION pg_postmaster_start_time() FROM PUBLIC');
      const unknownPath = join(work, 'reader-unidentified.json');
      const unknown = run(readerUrl, [`--output=${unknownPath}`], proxyEnv);
      expect(unknown.exitCode).toBe(1);
      expect(unknown.stderr).toContain('code=server_identity_unavailable');
      expect(`${unknown.stdout}${unknown.stderr}`).not.toContain(password);
      expect(await readFile(unknownPath, 'utf8')).toBe('');
    } finally {
      await pool.query('GRANT EXECUTE ON FUNCTION pg_postmaster_start_time() TO PUBLIC');
      await pool.query('GRANT EXECUTE ON FUNCTION pg_control_system() TO PUBLIC');
      await pool.query(`DROP OWNED BY ${role}`);
      await pool.query(`DROP ROLE ${role}`);
    }
  }, 60000);

  it('refuses an external proxy or baseline that points to a different server', async () => {
    const otherServer = createHash('sha256').update('another-cluster').digest('hex');
    const mismatched = run(tcpUrl(), [`--proxy-port=${container.getMappedPort(5432)}`,
      `--expected-server-id=${otherServer}`, `--output=${join(work, 'external-mismatch.json')}`]);
    expect(mismatched.exitCode).toBe(1);
    expect(mismatched.stderr).toContain('code=server_identity_mismatch');
    expect(await readFile(join(work, 'external-mismatch.json'), 'utf8')).toBe('');

    const unbound = run(tcpUrl(), [`--proxy-port=${container.getMappedPort(5432)}`, `--output=${join(work, 'external-unbound.json')}`]);
    expect(unbound.exitCode).toBe(1);
    expect(unbound.stderr).toContain('code=invalid_arguments');

    const baseline = await capture('identity-baseline');
    const foreign = join(work, 'foreign-baseline.json');
    await writeFile(foreign, JSON.stringify({ ...baseline.data, server: { ...baseline.data.server, identity: otherServer } }));
    const crossed = run(tcpUrl(), [`--proxy-port=${container.getMappedPort(5432)}`, `--expected-server-id=${serverId}`,
      `--output=${join(work, 'crossed.json')}`, `--baseline=${foreign}`]);
    expect(crossed.exitCode).toBe(1);
    expect(crossed.stderr).toContain('code=baseline_server_mismatch');
    expect(await readFile(join(work, 'crossed.json'), 'utf8')).toBe('');

    const legacy = join(work, 'legacy-baseline.json');
    const { server: _server, ...legacyBaseline } = baseline.data;
    await writeFile(legacy, JSON.stringify(legacyBaseline));
    const old = run(tcpUrl(), [`--proxy-port=${container.getMappedPort(5432)}`, `--expected-server-id=${serverId}`,
      `--output=${join(work, 'legacy.json')}`, `--baseline=${legacy}`]);
    expect(old.exitCode).toBe(1);
    expect(old.stderr).toContain('code=baseline_server_identity_missing');

    const { rows } = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations');
    const migrationGap = run(tcpUrl(), [`--proxy-port=${container.getMappedPort(5432)}`, `--expected-server-id=${serverId}`,
      `--output=${join(work, 'migration-gap.json')}`, `--expected-migrations=${rows[0]!.count + 1}`]);
    expect(migrationGap.exitCode).toBe(3);
    expect(JSON.parse(await readFile(join(work, 'migration-gap.json'), 'utf8')).migrationExpectation)
      .toEqual({ expected: rows[0]!.count + 1, actual: rows[0]!.count, met: false });
  }, 30000);
});
