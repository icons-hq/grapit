import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import IORedis, { Cluster } from 'ioredis';
import { QueueService } from '../src/modules/queue/queue.service.js';
import {
  COUNT_VALID_LOCKED_SEATS_LUA,
  QUEUE_SESSION_TRANSITION_LUA,
} from '../src/modules/queue/queue-redis-scripts.js';
import { performances } from '../src/database/schema/performances.js';
import { reservations } from '../src/database/schema/reservations.js';
import { seatInventories } from '../src/database/schema/seat-inventories.js';
import { seatMaps } from '../src/database/schema/seat-maps.js';
import { showtimes } from '../src/database/schema/showtimes.js';

/**
 * Audit #4/#6/#26/#89: queue session transitions are Lua scripts on the
 * `{queue:<performanceId>}` slot. Unit tests run the JavaScript mirror; this
 * spec runs the real scripts on a single-shard Valkey Cluster so cjson,
 * ZADD NX, PTTL and CROSSSLOT behaviour are proven against the server.
 *
 * pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts test/queue-session-cluster.integration.spec.ts
 */

type ClusterSlotTuple = [
  number,
  number,
  [string, number, string],
  ...[string, number, string][],
];

function buildNatMap(
  slots: ClusterSlotTuple[],
  host: string,
  port: number,
): Record<string, { host: string; port: number }> {
  const natMap: Record<string, { host: string; port: number }> = {};
  for (const slot of slots) {
    for (let i = 2; i < slot.length; i++) {
      const node = slot[i] as [string, number, string];
      natMap[`${node[0]}:${node[1]}`] = { host, port };
    }
  }
  if (Object.keys(natMap).length === 0) {
    throw new Error('CLUSTER SLOTS returned no usable ip:port tuples');
  }
  natMap[`${host}:6379`] = { host, port };
  return natMap;
}

type DbState = {
  performanceId: string;
  totalSeats: number;
  showtimeIds: string[];
  soldCount: number;
};

function createQueueDb(state: DbState) {
  return {
    select: (selection: Record<string, unknown> = {}) => ({
      from: (table: unknown) => {
        const rows = (): unknown[] => {
          if (table === seatMaps) return [{ totalSeats: state.totalSeats }];
          if (table === seatInventories) return [{ total: state.soldCount }];
          if (table === reservations) return [];
          if (table === performances) {
            // Queue entry gate row: a published, selling performance with a
            // showtime that has not started yet.
            return [{
              status: 'selling',
              publishState: 'published',
              bookingStartsAt: null,
              showtimeCount: state.showtimeIds.length,
              sellableShowtimeCount: state.showtimeIds.length,
            }];
          }
          if (table === showtimes) {
            return 'performanceId' in selection
              ? [{ performanceId: state.performanceId }]
              : state.showtimeIds.map((id) => ({ id }));
          }
          return [];
        };
        const chain = {
          where: async () => rows(),
          innerJoin: () => chain,
          leftJoin: () => chain,
        };
        return chain;
      },
    }),
  };
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

describe('QueueService Redis scripts — Valkey Cluster mode', () => {
  let container: StartedTestContainer;
  let cluster: Cluster;
  let service: QueueService;
  let dbState: DbState;
  const gateway = {
    emitAdmitted: vi.fn(),
    emitExpired: vi.fn(),
    emitPosition: vi.fn(),
  };

  const performanceId = '9a1d2f33-0000-4000-8000-00000000aaaa';
  const showtimeId = '9a1d2f33-0000-4000-8000-00000000bbbb';
  const browserA = { userId: 'user-a', refreshTokenFamilyId: 'family-a', deviceSlotId: 'family-a' };
  const browserB = { userId: 'user-b', refreshTokenFamilyId: 'family-b', deviceSlotId: 'family-b' };
  const waitingKey = `{queue:${performanceId}}:waiting`;
  const activeKey = `{queue:${performanceId}}:active`;
  const sessionKey = (id: string) => `{queue:${performanceId}}:session:${id}`;
  const readRecord = async (id: string) =>
    JSON.parse((await cluster.get(sessionKey(id))) ?? 'null') as Record<string, unknown> | null;
  const clearReconcileThrottle = () =>
    cluster.del(`{queue:${performanceId}}:reconcile-throttle`);

  beforeAll(async () => {
    container = await new GenericContainer('valkey/valkey:8')
      .withExposedPorts(6379)
      .withCommand([
        'valkey-server',
        '--port',
        '6379',
        '--cluster-enabled',
        'yes',
        '--cluster-config-file',
        'nodes.conf',
        '--cluster-node-timeout',
        '5000',
        '--appendonly',
        'no',
        '--cluster-require-full-coverage',
        'no',
      ])
      .start();

    const host = container.getHost();
    const port = container.getMappedPort(6379);
    const boot = new IORedis(`redis://${host}:${port}`, { maxRetriesPerRequest: 3 });
    await boot.call('CONFIG', 'SET', 'cluster-announce-ip', host);
    await boot.call('CONFIG', 'SET', 'cluster-announce-port', String(port));
    await boot.call('CLUSTER', 'ADDSLOTSRANGE', '0', '16383');
    for (let i = 0; i < 24; i++) {
      const info = (await boot.call('CLUSTER', 'INFO')) as string;
      if (info.includes('cluster_state:ok')) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    const slots = (await boot.call('CLUSTER', 'SLOTS')) as ClusterSlotTuple[];
    const natMap = buildNatMap(slots, host, port);
    await boot.quit();

    cluster = new IORedis.Cluster([{ host, port }], {
      natMap,
      lazyConnect: true,
      scaleReads: 'master',
      enableReadyCheck: true,
      redisOptions: { maxRetriesPerRequest: 3 },
    });
    await cluster.connect();
  }, 180_000);

  afterAll(async () => {
    await cluster?.quit();
    await container?.stop();
  });

  beforeEach(async () => {
    await cluster.flushdb();
    vi.clearAllMocks();
    dbState = { performanceId, totalSeats: 0, showtimeIds: [showtimeId], soldCount: 0 };
    service = new QueueService(
      cluster as unknown as IORedis,
      createQueueDb(dbState) as never,
      gateway as never,
    );
  });

  it('keeps every queue script key on one cluster slot', async () => {
    const lease = await service.ensureQueueSession({ performanceId, identity: browserA });
    const slots = await Promise.all([
      sessionKey(lease.queueSessionId),
      waitingKey,
      activeKey,
      `{queue:${performanceId}}:identity:user-a:family-a:family-a`,
    ].map((key) => cluster.call('CLUSTER', 'KEYSLOT', key)));

    expect(new Set(slots).size).toBe(1);
  });

  it('creates exactly one queue position for concurrent first entries (#26)', async () => {
    const leases = await Promise.all(
      Array.from({ length: 8 }, () => service.ensureQueueSession({ performanceId, identity: browserA })),
    );

    expect(new Set(leases.map((lease) => lease.queueSessionId)).size).toBe(1);
    expect(await cluster.zcard(waitingKey)).toBe(1);
    const record = await readRecord(leases[0]!.queueSessionId);
    expect(leases.map((lease) => hashToken(lease.admissionToken)))
      .toContain(record?.['admissionTokenHash']);
    expect(await cluster.get(`{queue:admission}:${String(record?.['admissionTokenHash'])}`))
      .toBe(leases[0]!.queueSessionId);
  });

  it('never writes a stale WAITING copy over a concurrent admission (#26)', async () => {
    dbState.totalSeats = 10;
    const lease = await service.ensureQueueSession({ performanceId, identity: browserA });
    const staleWaiting = await readRecord(lease.queueSessionId);

    // reconcile admits the session...
    await (service as unknown as {
      admitQueueSession: (performanceId: string, id: string) => Promise<void>;
    }).admitQueueSession(performanceId, lease.queueSessionId);
    // ...then a re-entry that read the WAITING record earlier rotates the token
    const reply = (await cluster.eval(
      QUEUE_SESSION_TRANSITION_LUA,
      4,
      sessionKey(lease.queueSessionId),
      waitingKey,
      activeKey,
      `{queue:${performanceId}}:identity:user-a:family-a:family-a`,
      lease.queueSessionId,
      'touch',
      'rotated-hash',
      new Date(Date.now() + 1_800_000).toISOString(),
      '1800000',
      String(Date.parse(String(staleWaiting?.['enteredAt']))),
    )) as [number, string, string, string, number];

    expect(reply[0]).toBe(1);
    expect(reply[1]).toBe('ADMITTED');
    expect(reply[3]).toBe(staleWaiting?.['admissionTokenHash']);
    expect(await readRecord(lease.queueSessionId)).toMatchObject({
      state: 'ADMITTED',
      admissionTokenHash: 'rotated-hash',
      paymentRecoveryUntilAt: null,
    });
    expect(await cluster.sismember(activeKey, lease.queueSessionId)).toBe(1);
    expect(await cluster.zscore(waitingKey, lease.queueSessionId)).toBeNull();
  });

  it('admits through the capacity check without jumping earlier waiting sessions (#89)', async () => {
    const first = await service.ensureQueueSession({ performanceId, identity: browserA });
    const second = await service.ensureQueueSession({ performanceId, identity: browserB });
    const record = await readRecord(second.queueSessionId);
    const admit = (capacity: string) => cluster.eval(
      QUEUE_SESSION_TRANSITION_LUA,
      4,
      sessionKey(second.queueSessionId),
      waitingKey,
      activeKey,
      `{queue:${performanceId}}:identity:user-b:family-b:family-b`,
      second.queueSessionId,
      'admit',
      new Date().toISOString(),
      new Date(Date.now() + 600_000).toISOString(),
      new Date(Date.now() + 780_000).toISOString(),
      new Date(Date.now() + 1_080_000).toISOString(),
      '1080000',
      capacity,
    ) as Promise<[number, string]>;

    await expect(admit('1')).resolves.toEqual(expect.arrayContaining([0, 'NO_CAPACITY']));
    expect(await readRecord(second.queueSessionId)).toMatchObject({ state: record?.['state'] });

    const [applied, state] = await admit('2');
    expect([applied, state]).toEqual([1, 'ADMITTED']);
    expect(await cluster.zrank(waitingKey, first.queueSessionId)).toBe(0);
    expect(await cluster.sismember(activeKey, second.queueSessionId)).toBe(1);
  });

  it('slides the WAITING expiry on status polls and keeps the indexes alive (#4)', async () => {
    const lease = await service.ensureQueueSession({ performanceId, identity: browserA });
    const record = await readRecord(lease.queueSessionId);
    const shortExpiry = new Date(Date.now() + 60_000).toISOString();
    await cluster.set(
      sessionKey(lease.queueSessionId),
      JSON.stringify({ ...record, expiresAt: shortExpiry }),
      'PX',
      60_000,
    );
    await cluster.pexpire(`{queue:session-ref}:${lease.queueSessionId}`, 60_000);
    await cluster.pexpire(`{queue:admission}:${hashToken(lease.admissionToken)}`, 60_000);

    await expect(service.getQueueSessionStatus({
      queueSessionId: lease.queueSessionId,
      identity: browserA,
      admissionToken: lease.admissionToken,
    })).resolves.toMatchObject({ state: 'WAITING', position: 1 });

    const minTtl = 1_790_000;
    expect(await cluster.pttl(sessionKey(lease.queueSessionId))).toBeGreaterThan(minTtl);
    expect(await cluster.pttl(`{queue:session-ref}:${lease.queueSessionId}`)).toBeGreaterThan(minTtl);
    expect(await cluster.pttl(`{queue:admission}:${hashToken(lease.admissionToken)}`))
      .toBeGreaterThan(minTtl - 1_000);
    expect(await cluster.zscore(waitingKey, lease.queueSessionId))
      .toBe(String(Date.parse(String(record?.['enteredAt']))));
  });

  it('returns the active slot right after a purchase and admits the next buyer (#4)', async () => {
    dbState.totalSeats = 1;
    const buyer = await service.enterPerformanceQueue({ performanceId, identity: browserA });
    expect(buyer.state).toBe('ADMITTED');
    await clearReconcileThrottle();
    const next = await service.enterPerformanceQueue({ performanceId, identity: browserB });
    expect(next.state).toBe('WAITING');

    await expect(service.releaseAdmissionAfterPurchase(buyer.queueSessionId)).resolves.toBe(true);
    expect(await cluster.sismember(activeKey, buyer.queueSessionId)).toBe(0);
    expect(await readRecord(buyer.queueSessionId)).toMatchObject({ state: 'EXPIRED' });
    expect(await cluster.pttl(sessionKey(buyer.queueSessionId))).toBeLessThanOrEqual(300_000);

    await clearReconcileThrottle();
    await expect(service.getQueueSessionStatus({
      queueSessionId: next.queueSessionId,
      identity: browserB,
      admissionToken: next.admissionToken,
    })).resolves.toMatchObject({ state: 'ADMITTED' });
  });

  it('counts only live seat locks and removes expired locked-seats members (#6)', async () => {
    const lockedSeatsKey = `{${showtimeId}}:locked-seats`;
    await cluster.set(`{${showtimeId}}:seat:A-1`, 'buyer-1', 'PX', 50);
    await cluster.set(`{${showtimeId}}:seat:A-2`, 'buyer-2', 'PX', 600_000);
    await cluster.sadd(lockedSeatsKey, 'A-1', 'A-2', 'A-3');
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));

    await expect(cluster.eval(
      COUNT_VALID_LOCKED_SEATS_LUA,
      1,
      lockedSeatsKey,
      `{${showtimeId}}:seat:`,
    )).resolves.toBe(1);
    expect((await cluster.smembers(lockedSeatsKey)).sort()).toEqual(['A-2']);

    dbState.totalSeats = 3;
    const lease = await service.enterPerformanceQueue({ performanceId, identity: browserA });
    expect(lease).toMatchObject({ state: 'ADMITTED', remainingSeats: 2 });
  });

  it('expires only the authority window it inspected', async () => {
    dbState.totalSeats = 10;
    const lease = await service.enterPerformanceQueue({ performanceId, identity: browserA });
    const record = await readRecord(lease.queueSessionId);
    const expire = (fingerprint: string) => cluster.eval(
      QUEUE_SESSION_TRANSITION_LUA,
      4,
      sessionKey(lease.queueSessionId),
      waitingKey,
      activeKey,
      `{queue:${performanceId}}:identity:user-a:family-a:family-a`,
      lease.queueSessionId,
      'expire',
      fingerprint,
      new Date(Date.now() + 300_000).toISOString(),
      '300000',
    ) as Promise<[number, string]>;

    await expect(expire('ADMITTED|stale|')).resolves.toEqual(expect.arrayContaining([0, 'CHANGED']));
    expect(await cluster.sismember(activeKey, lease.queueSessionId)).toBe(1);

    const [applied, state] = await expire(`ADMITTED|${String(record?.['activeUntilAt'])}|`);
    expect([applied, state]).toEqual([1, 'EXPIRED']);
    expect(await cluster.sismember(activeKey, lease.queueSessionId)).toBe(0);
  });
});
