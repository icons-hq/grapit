import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema/index.js';
import { parseIncludedBenefitRepairArgs, repairIncludedBenefits } from './included-benefit-repair.js';

async function main() {
  const args = parseIncludedBenefitRepairArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1,
    connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  try {
    const report = await repairIncludedBenefits(drizzle(pool, { schema }), args.showtimeId,
      args.mode === 'apply'
        ? { expectedHash: args.expectedHash, operatorUserId: args.operatorUserId, reason: args.reason }
        : undefined);
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
