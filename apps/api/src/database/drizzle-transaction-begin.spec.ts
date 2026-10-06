import { EventEmitter } from 'node:events';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { releaseClientOnFailedTransactionBegin } from './drizzle.provider.js';

/**
 * A pg Client double for the real pg-pool and the real drizzle transaction():
 * the first `begin` fails as if the connection died right after checkout.
 */
function fakeClientClass(state: { failNextBegin: boolean; queries: string[] }) {
  return class FakeClient extends EventEmitter {
    _queryable = true;
    _ending = false;

    connect(callback?: (error?: Error) => void) {
      if (callback) {
        callback();
        return undefined;
      }
      return Promise.resolve();
    }

    query(config: string | { text: string }) {
      const text = typeof config === 'string' ? config : config.text;
      state.queries.push(text);
      if (/^begin/i.test(text) && state.failNextBegin) {
        state.failNextBegin = false;
        this._queryable = false;
        return Promise.reject(new Error('Connection terminated unexpectedly'));
      }
      return Promise.resolve({ rows: [], rowCount: 0, fields: [], command: text.split(' ')[0] });
    }

    end(callback?: () => void) {
      this._ending = true;
      callback?.();
      return Promise.resolve();
    }
  };
}

function createPool(guarded: boolean) {
  const state = { failNextBegin: true, queries: [] as string[] };
  const pool = new Pool({ max: 1, Client: fakeClientClass(state) as never });
  if (guarded) {
    releaseClientOnFailedTransactionBegin(pool);
  }
  return { pool, state, db: drizzle(pool) };
}

describe('drizzle transaction begin failure (u18a review: pool slot leak)', () => {
  it('control: without the guard a failed begin keeps the only pool slot checked out', async () => {
    const { pool, db } = createPool(false);
    try {
      await expect(db.transaction(async (tx) => tx.execute(sql`select 1`)))
        .rejects.toThrow(/Failed query: begin/);
      // drizzle never released the client: the pool is exhausted.
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(0);
    } finally {
      pool.removeAllListeners();
    }
  });

  it('releases (and discards) the client when begin fails, so the next transaction runs', async () => {
    const { pool, state, db } = createPool(true);
    try {
      await expect(db.transaction(async (tx) => tx.execute(sql`select 1`)))
        .rejects.toThrow(/Failed query: begin/);
      expect(pool.totalCount).toBe(0);

      await expect(db.transaction(async (tx) => {
        await tx.execute(sql`select 2`);
        return 'committed';
      })).resolves.toBe('committed');
      expect(state.queries.slice(-3)).toEqual(['begin', 'select 2', 'commit']);
      // The successful checkout went back to the pool once, unwrapped.
      expect(pool.idleCount).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
