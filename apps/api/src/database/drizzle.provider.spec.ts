import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation((config: Record<string, unknown>) => ({
    config,
  })),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockImplementation((pool: unknown) => ({ pool })),
}));

import { Pool } from 'pg';
import { drizzleProvider } from './drizzle.provider.js';

function createConfig(values: Record<string, string | undefined>) {
  return {
    get: vi.fn((key: string) => values[key]),
  };
}

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

    drizzleProvider.useFactory(
      config as unknown as Parameters<typeof drizzleProvider.useFactory>[0],
    );

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

    drizzleProvider.useFactory(
      config as unknown as Parameters<typeof drizzleProvider.useFactory>[0],
    );

    expect(Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }),
    );
  });

  it('rejects invalid DB pool env values at startup', () => {
    const config = createConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/grabit',
      DB_POOL_MAX: '0',
    });

    expect(() =>
      drizzleProvider.useFactory(
        config as unknown as Parameters<typeof drizzleProvider.useFactory>[0],
      ),
    ).toThrow(/DB_POOL_MAX must be a positive integer/);
  });
});

