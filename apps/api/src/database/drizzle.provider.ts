import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as schema from './schema/index.js';
import {
  parseOptionalPositiveIntegerEnv,
  parsePositiveIntegerEnv,
  resolveDatabaseApplicationName,
} from './pool-config.js';

export const DRIZZLE = Symbol('DRIZZLE');

export type DrizzleDB = NodePgDatabase<typeof schema>;

const logger = new Logger('DatabasePool');

export function buildDatabasePoolConfig(
  config: Pick<ConfigService, 'get'>,
): PoolConfig {
  const poolConfig: PoolConfig = {
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
    application_name: resolveDatabaseApplicationName(config),
  };

  // Session guards are opt-in. A transaction that legitimately awaits an
  // external call (for example a Toss cancel inside the legacy reservation
  // cancel transaction) must finish before these limits, so operators size
  // them from load evidence instead of the code imposing a silent default.
  const statementTimeout = parseOptionalPositiveIntegerEnv(
    config,
    'DB_STATEMENT_TIMEOUT_MS',
  );
  if (statementTimeout !== undefined) {
    poolConfig.statement_timeout = statementTimeout;
  }

  const idleInTransactionTimeout = parseOptionalPositiveIntegerEnv(
    config,
    'DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS',
  );
  if (idleInTransactionTimeout !== undefined) {
    poolConfig.idle_in_transaction_session_timeout = idleInTransactionTimeout;
  }

  return poolConfig;
}

function describePoolError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/**
 * A lost server session (Cloud SQL failover/maintenance, pg_terminate_backend,
 * network reset) surfaces as an EventEmitter `error`, and an unobserved
 * `error` is an uncaught exception that kills the process. Two emitters need a
 * listener:
 *
 * - the pool, for idle clients: pg-pool's idle listener discards the client and
 *   re-emits the error on the pool;
 * - each client while it is checked out: pg-pool removes its idle listener at
 *   checkout, and drizzle `transaction()` holds a `pool.connect()` client with
 *   no per-query listener. pg emits `error` on that client whether or not a
 *   query is running (for example while the transaction awaits a Toss call).
 *
 * Observing is enough: pg marks the client unqueryable, so the in-flight query
 * and the transaction reject, and pg-pool discards the client on release.
 */
export function attachDatabasePoolErrorListener(
  pool: Pick<Pool, 'on'>,
  poolName: string,
): void {
  const checkedOutClients = new WeakSet<PoolClient>();

  pool.on('error', (error: Error) => {
    logger.error(
      `PostgreSQL idle client error in ${poolName} pool; the client was discarded and will be replaced on demand`,
      describePoolError(error),
    );
  });
  pool.on('acquire', (client: PoolClient) => {
    checkedOutClients.add(client);
  });
  pool.on('release', (_error: Error | undefined, client: PoolClient) => {
    checkedOutClients.delete(client);
  });
  pool.on('connect', (client: PoolClient) => {
    client.on('error', (error: Error) => {
      // Idle-client errors are reported once, by the pool listener above.
      if (!checkedOutClients.has(client)) {
        return;
      }
      logger.error(
        `PostgreSQL connection lost on a checked-out ${poolName} pool client; its query or transaction fails and the client is discarded on release`,
        describePoolError(error),
      );
    });
  });
}

export const drizzleProvider = {
  provide: DRIZZLE,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const pool = new Pool(buildDatabasePoolConfig(config));
    attachDatabasePoolErrorListener(pool, 'application');
    return drizzle(pool, { schema });
  },
};
