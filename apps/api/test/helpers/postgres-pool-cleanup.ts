import type { Pool, PoolClient } from 'pg';

/** Register before the first query; await every socket close before stopping Postgres. */
export function createPostgresPoolCleanup(pool: Pool): () => Promise<void> {
  const pendingClosures = new Set<Promise<void>>();
  pool.on('connect', (client: PoolClient) => {
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
    pendingClosures.add(closed);
    client.once('end', () => {
      pendingClosures.delete(closed);
      resolveClosed();
    });
  });

  return async () => {
    // pg-pool removes idle clients before their asynchronous end callbacks run.
    await pool.end();
    await Promise.all(pendingClosures);
  };
}
