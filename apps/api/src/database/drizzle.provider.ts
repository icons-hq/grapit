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

type QueryFunction = (...args: unknown[]) => unknown;

function isBeginStatement(queryArg: unknown): boolean {
  const text = typeof queryArg === 'string'
    ? queryArg
    : typeof queryArg === 'object' && queryArg !== null
      ? (queryArg as { text?: unknown }).text
      : undefined;
  return typeof text === 'string' && /^\s*begin\b/i.test(text);
}

/**
 * drizzle-orm 0.45 `transaction()` checks a client out with `pool.connect()`
 * and sends `begin` before entering the try/finally that releases it. A
 * rejected `begin` (the connection died between checkout and the first query,
 * as in a Cloud SQL failover) therefore never returns the client, and that
 * pool slot is lost until the process restarts.
 *
 * Promise-style checkouts are wrapped: when the first query of the checkout is
 * `begin` and it rejects, the client is released with the error (pg-pool
 * discards it), and any later release for the same checkout is a no-op instead
 * of pg-pool's "already been released" throw. Callback checkouts
 * (`pool.query`) release themselves and are left alone.
 */
export function releaseClientOnFailedTransactionBegin(
  pool: Pick<Pool, 'connect'>,
): void {
  const connect = pool.connect.bind(pool) as (
    callback?: (...args: unknown[]) => void,
  ) => Promise<PoolClient> | void;

  (pool as { connect: unknown }).connect = (callback?: (...args: unknown[]) => void) => {
    if (callback) {
      return connect(callback);
    }
    return (connect() as Promise<PoolClient>).then(guardCheckout);
  };
}

function guardCheckout(client: PoolClient): PoolClient {
  const originalQuery = client.query as unknown as QueryFunction;
  const poolRelease = client.release;
  let released = false;
  let firstQuery = true;

  const release = (error?: Error | boolean) => {
    if (released) return;
    released = true;
    // The client object is reused by later checkouts; hand it back unwrapped.
    (client as { query: unknown }).query = originalQuery;
    poolRelease.call(client, error);
  };
  client.release = release;

  (client as { query: unknown }).query = (...args: unknown[]) => {
    const isBegin = firstQuery && isBeginStatement(args[0]);
    firstQuery = false;
    const result = originalQuery.apply(client, args);
    if (!isBegin || !(result instanceof Promise)) {
      return result;
    }
    return result.catch((error: unknown) => {
      release(error instanceof Error ? error : true);
      throw error;
    });
  };

  return client;
}

export const drizzleProvider = {
  provide: DRIZZLE,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const pool = new Pool(buildDatabasePoolConfig(config));
    attachDatabasePoolErrorListener(pool, 'application');
    releaseClientOnFailedTransactionBegin(pool);
    return drizzle(pool, { schema });
  },
};
