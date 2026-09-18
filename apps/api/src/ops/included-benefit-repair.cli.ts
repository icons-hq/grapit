import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema/index.js';
import { repairIncludedBenefits } from './included-benefit-repair.js';

async function main() {
  const [mode, showtimeId, hash, ...extra] = process.argv.slice(2);
  if (!['dry-run', 'apply'].includes(mode ?? '') || !showtimeId
    || !/^[0-9a-f-]{36}$/i.test(showtimeId) || extra.length > 0
    || (mode === 'apply' ? !/^[0-9a-f]{64}$/.test(hash ?? '') : hash !== undefined)) {
    throw new Error('Usage: included-benefit-repair <dry-run|apply> <showtime UUID> [reviewed hash]');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1,
    connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  try {
    const report = await repairIncludedBenefits(drizzle(pool, { schema }), showtimeId, mode === 'apply' ? hash : undefined);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally { await pool.end(); }
}

void main().catch((error: unknown) => {
  // Database errors can include credentials or SQL parameters. Print only known safe codes.
  const message = error instanceof Error ? error.message : '';
  process.stderr.write(`${message.startsWith('Usage:') || message.startsWith('BENEFIT_REPAIR_')
    || message === 'DATABASE_URL_REQUIRED' ? message : 'BENEFIT_REPAIR_FAILED'}\n`);
  process.exitCode = 1;
});
