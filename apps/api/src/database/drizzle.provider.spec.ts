import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('pg', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    Pool: vi.fn().mockImplementation((config: Record<string, unknown>) =>
      Object.assign(new Emitter(), { config }),
    ),
  };
});

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockImplementation((pool: unknown) => ({ pool })),
}));

import { Pool } from 'pg';
import {
  attachDatabasePoolErrorListener,
  buildDatabasePoolConfig,
  drizzleProvider,
} from './drizzle.provider.js';

function createConfig(values: Record<string, string | undefined>) {
  return {
    get: vi.fn((key: string) => values[key]),
  };
}

type FactoryConfig = Parameters<typeof drizzleProvider.useFactory>[0];

describe('drizzleProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses explicit DB pool settings when provided', () => {
    const config = createConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/grabit',
      DB_POOL_MAX: '3',
      DB_POOL_IDLE_TIMEOUT_MS: '30000',
      DB_POOL_CONNECTION_TIMEOUT_MS: '5000',
    });

    drizzleProvider.useFactory(config as unknown as FactoryConfig);

    expect(Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgresql://user:pass@localhost:5432/grabit',
        max: 3,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }),
    );
  });

  it('keeps conservative defaults when DB pool env is absent', () => {
    const config = createConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/grabit',
    });

    drizzleProvider.useFactory(config as unknown as FactoryConfig);

    expect(Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        application_name: 'grabit-api',
      }),
    );
  });

  it('rejects invalid DB pool env values at startup', () => {
    const config = createConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/grabit',
      DB_POOL_MAX: '0',
    });

    expect(() =>
      drizzleProvider.useFactory(config as unknown as FactoryConfig),
    ).toThrow(/DB_POOL_MAX must be a positive integer/);
  });

  it('registers an error listener so an idle client failure cannot crash the process', () => {
    const config = createConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/grabit',
    });

    const db = drizzleProvider.useFactory(config as unknown as FactoryConfig) as unknown as {
      pool: EventEmitter;
    };

    expect(db.pool.listenerCount('error')).toBeGreaterThanOrEqual(1);
    expect(() =>
      db.pool.emit(
        'error',
        new Error('terminating connection due to administrator command'),
      ),
    ).not.toThrow();
  });

  it('absorbs pg-pool idle client errors on a real pool instance', async () => {
    const { Pool: RealPool } = await vi.importActual<typeof import('pg')>('pg');
    const unprotected = new RealPool({ max: 1 });
    const protectedPool = new RealPool({ max: 1 });
    attachDatabasePoolErrorListener(protectedPool, 'test');

    try {
      // Control: node EventEmitter rethrows an unobserved `error` event, which in
      // production surfaces as an uncaught exception from the socket callback.
      expect(() =>
        unprotected.emit('error', new Error('Connection terminated unexpectedly')),
      ).toThrow(/Connection terminated unexpectedly/);
      expect(() =>
        protectedPool.emit('error', new Error('Connection terminated unexpectedly')),
      ).not.toThrow();
    } finally {
      await unprotected.end();
      await protectedPool.end();
    }
  });

  it('labels connections and keeps session timeouts opt-in', () => {
    expect(
      buildDatabasePoolConfig(createConfig({ DATABASE_URL: 'postgresql://x' })),
    ).not.toHaveProperty('statement_timeout');
    expect(
      buildDatabasePoolConfig(createConfig({ DATABASE_URL: 'postgresql://x' })),
    ).not.toHaveProperty('idle_in_transaction_session_timeout');

    expect(
      buildDatabasePoolConfig(
        createConfig({
          DATABASE_URL: 'postgresql://x',
          DB_APPLICATION_NAME: 'grabit-background-worker',
          DB_STATEMENT_TIMEOUT_MS: '15000',
          DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS: '120000',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        application_name: 'grabit-background-worker',
        statement_timeout: 15000,
        idle_in_transaction_session_timeout: 120000,
      }),
    );

    expect(() =>
      buildDatabasePoolConfig(
        createConfig({
          DATABASE_URL: 'postgresql://x',
          DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS: '-1',
        }),
      ),
    ).toThrow(/DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS must be a positive integer/);
  });
});
