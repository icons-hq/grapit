import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { analyticsTrafficHistoryImportSchema } from '@grabit/shared';

async function main() {
  const mode = process.argv[2];
  if (mode !== 'dry-run' && mode !== 'apply') throw new Error('Use dry-run or apply');
  const encoded = process.env['ANALYTICS_HISTORY_BASE64'];
  const databaseUrl = process.env['DATABASE_URL'];
  const expectedDatabase = process.env['EXPECTED_DATABASE_NAME'];
  if (!encoded || !databaseUrl || !expectedDatabase) throw new Error('History input and expected database are required');
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const hash = createHash('sha256').update(decoded).digest('hex');
  const input = analyticsTrafficHistoryImportSchema.parse(JSON.parse(decoded));
  if (mode === 'apply' && process.env['EXPECTED_HISTORY_SHA256'] !== hash) throw new Error('Reviewed history hash does not match');
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000, lock_timeout: 500, application_name: 'grabit-analytics-history-import' });
  try {
    const target = await pool.query('select current_database() as database');
    if (target.rows[0]?.database !== expectedDatabase) throw new Error('Unexpected database; no writes performed');
    console.log(JSON.stringify({ mode, database: expectedDatabase, hash, rows: input.rows.length, observedThrough: input.observedThrough }));
    if (mode === 'dry-run') return;
    const result = await pool.query(`insert into analytics_traffic_history(bucket,source,metric,count,sampled,observed_through)
      select x.bucket::timestamptz,x.source,x.metric,x.count,x.sampled,$2::timestamptz
      from jsonb_to_recordset($1::jsonb) as x(bucket text,source text,metric text,count int,sampled boolean)
      order by x.bucket,x.source,x.metric
      on conflict(bucket,source,metric) do update set count=excluded.count,sampled=excluded.sampled,observed_through=excluded.observed_through
      where analytics_traffic_history.observed_through<=excluded.observed_through`, [JSON.stringify(input.rows), input.observedThrough]);
    console.log(JSON.stringify({ imported: result.rowCount, hash }));
  } finally { await pool.end(); }
}
void main().catch(() => { console.error('Analytics history import failed; no credentials or payload logged'); process.exitCode = 1; });
