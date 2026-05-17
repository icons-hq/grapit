import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigService } from '@nestjs/config';
import * as schema from './schema/index.js';

export const DRIZZLE = Symbol('DRIZZLE');

export type DrizzleDB = NodePgDatabase<typeof schema>;

function parsePositiveIntegerEnv(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const rawValue = config.get<string>(key);
  if (rawValue === undefined || rawValue.trim() === '') {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }

  return value;
}

export const drizzleProvider = {
  provide: DRIZZLE,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const pool = new Pool({
      connectionString: config.get<string>('DATABASE_URL'),
      max: parsePositiveIntegerEnv(config, 'DB_POOL_MAX', 10),
      idleTimeoutMillis: parsePositiveIntegerEnv(
        config,
        'DB_POOL_IDLE_TIMEOUT_MS',
        30_000,
      ),
      connectionTimeoutMillis: parsePositiveIntegerEnv(
        config,
        'DB_POOL_CONNECTION_TIMEOUT_MS',
        5_000,
      ),
    });
    return drizzle(pool, { schema });
  },
};
