import type { ConfigService } from '@nestjs/config';

export const DEFAULT_DATABASE_APPLICATION_NAME = 'grabit-api';

type ConfigReader = Pick<ConfigService, 'get'>;

/**
 * Reads an optional positive integer env value. Blank or missing values return
 * `undefined`; anything else that is not a positive integer fails startup so a
 * typo never silently changes the connection budget.
 */
export function parseOptionalPositiveIntegerEnv(
  config: ConfigReader,
  key: string,
): number | undefined {
  const rawValue = config.get<string>(key);
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return undefined;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }

  return value;
}

export function parsePositiveIntegerEnv(
  config: ConfigReader,
  key: string,
  fallback: number,
): number {
  return parseOptionalPositiveIntegerEnv(config, key) ?? fallback;
}

/**
 * `application_name` reported in `pg_stat_activity`, so connection budgets can
 * be verified per process kind (API vs bounded worker) and per pool (app vs
 * pg-boss). A value embedded in DATABASE_URL still wins inside node-postgres.
 */
export function resolveDatabaseApplicationName(config: ConfigReader): string {
  const configured = config.get<string>('DB_APPLICATION_NAME')?.trim();
  return configured || DEFAULT_DATABASE_APPLICATION_NAME;
}
