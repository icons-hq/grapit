import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  buildPgBossOptions,
  bootstrapPgBossQueues,
  DEFAULT_PGBOSS_POOL_MAX_PROCESSING,
  DEFAULT_PGBOSS_POOL_MAX_PRODUCER,
  initializePgBoss,
  isBackgroundProcessingEnabled,
  isPgBossRequired,
  loadPgBossConstructor,
  markBossAvailable,
  PG_BOSS_QUEUE_NAMES,
  PgBossInitializationError,
  pgbossProvider,
  PGBOSS_SHUTDOWN_TIMEOUT_MS,
  resolvePgBossConstructor,
  resolvePgBossPoolMax,
  stopPgBossForShutdown,
  type PgBossContract,
  type StartablePgBoss,
} from './pgboss.provider.js';

class FakeBoss implements PgBossContract {
  isAvailable = false;

  async start() {
    return undefined;
  }

  async send() {
    return 'job-1';
  }

  async work() {
    return undefined;
  }

  async createQueue() {
    return undefined;
  }

  async stop() {
    return undefined;
  }
}

describe('pgbossProvider helpers', () => {
  it('loads the named PgBoss export from the installed pg-boss package', () => {
    const Constructor = loadPgBossConstructor();

    expect(typeof Constructor).toBe('function');
    expect(Constructor.name).toBe('PgBoss');
  });

  it('resolves named, default, and direct constructor export shapes', () => {
    expect(resolvePgBossConstructor({ PgBoss: FakeBoss })).toBe(FakeBoss);
    expect(resolvePgBossConstructor({ default: FakeBoss })).toBe(FakeBoss);
    expect(resolvePgBossConstructor(FakeBoss)).toBe(FakeBoss);
  });

  it('marks a boss instance available without dropping prototype methods', () => {
    const boss = new FakeBoss();
    const availableBoss = markBossAvailable(boss);

    expect(availableBoss.isAvailable).toBe(true);
    expect(availableBoss.processesJobs).toBe(true);
    expect(availableBoss.send).toBe(FakeBoss.prototype.send);
    expect(availableBoss.work).toBe(FakeBoss.prototype.work);
    expect(availableBoss.stop).toBe(FakeBoss.prototype.stop);
  });

  it('disables pg-boss timers while retaining producer access in managed-demo mode', () => {
    expect(buildPgBossOptions('postgresql://example', false)).toEqual({
      connectionString: 'postgresql://example',
      max: DEFAULT_PGBOSS_POOL_MAX_PRODUCER,
      application_name: 'grabit-api-pgboss',
      schedule: false,
      supervise: false,
      migrate: false,
      queueCacheIntervalSeconds: 86_400,
    });
    expect(
      isBackgroundProcessingEnabled({ get: () => 'false' }),
    ).toBe(false);
    expect(
      isBackgroundProcessingEnabled({ get: () => undefined }),
    ).toBe(true);
  });

  it('bootstraps every exported application queue before workers use pg-boss', async () => {
    const createdQueues: string[] = [];
    const boss = {
      createQueue: async (name: string) => {
        createdQueues.push(name);
      },
    };

    await bootstrapPgBossQueues(boss);

    expect(createdQueues.sort()).toEqual([...PG_BOSS_QUEUE_NAMES].sort());
    expect(createdQueues).toContain('release-cancelled-seat');
    expect(createdQueues).toContain('refund-cancel-retry');
    expect(createdQueues).toContain('qr-ticket-email-resend');
  });
});

function config(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] };
}

class ScriptedBoss implements StartablePgBoss {
  isAvailable = false;
  processesJobs?: boolean;
  readonly db = { opened: false, close: vi.fn(async () => { this.db.opened = false; }) };
  readonly stop = vi.fn(async () => undefined);
  readonly send = vi.fn(async () => 'job-1');
  readonly work = vi.fn(async () => undefined);
  readonly createQueue = vi.fn(async () => undefined);
  readonly on = vi.fn();

  constructor(private readonly startError?: Error) {}

  async start() {
    this.db.opened = true;
    if (this.startError) {
      throw this.startError;
    }
    return this;
  }

  getDb() {
    return this.db;
  }
}

describe('pg-boss connection budget', () => {
  it('caps the pg-boss pool instead of inheriting the node-postgres default of 10', () => {
    expect(buildPgBossOptions('postgresql://example', true)).toEqual({
      connectionString: 'postgresql://example',
      max: DEFAULT_PGBOSS_POOL_MAX_PROCESSING,
      application_name: 'grabit-api-pgboss',
    });
    expect(DEFAULT_PGBOSS_POOL_MAX_PROCESSING).toBeLessThan(10);
    expect(
      buildPgBossOptions('postgresql://example', true, {
        max: 5,
        applicationName: 'grabit-background-worker-pgboss',
      }),
    ).toEqual(
      expect.objectContaining({ max: 5, application_name: 'grabit-background-worker-pgboss' }),
    );
  });

  it('reads PGBOSS_POOL_MAX with mode-specific defaults and rejects invalid values', () => {
    expect(resolvePgBossPoolMax(config({}), true)).toBe(3);
    expect(resolvePgBossPoolMax(config({}), false)).toBe(1);
    expect(resolvePgBossPoolMax(config({ PGBOSS_POOL_MAX: '4' }), true)).toBe(4);
    expect(() => resolvePgBossPoolMax(config({ PGBOSS_POOL_MAX: '0' }), true)).toThrow(
      /PGBOSS_POOL_MAX must be a positive integer/,
    );
  });
});

describe('initializePgBoss', () => {
  it('retries a failed start with a fresh instance and closes the failed pool', async () => {
    const failed = new ScriptedBoss(new Error('connection timeout'));
    const healthy = new ScriptedBoss();
    const created = [failed, healthy];
    const sleep = vi.fn(async () => undefined);

    const boss = await initializePgBoss({
      createBoss: () => created.shift()!,
      processesJobs: true,
      maxAttempts: 3,
      required: true,
      sleep,
    });

    expect(boss).toBe(healthy);
    expect(boss.isAvailable).toBe(true);
    expect(boss.processesJobs).toBe(true);
    expect(failed.db.close).toHaveBeenCalledTimes(1);
    expect(failed.db.opened).toBe(false);
    expect(healthy.createQueue).toHaveBeenCalledTimes(PG_BOSS_QUEUE_NAMES.length);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('stops a started instance when queue bootstrap fails before retrying', async () => {
    const started = new ScriptedBoss();
    started.createQueue.mockRejectedValueOnce(new Error('createQueue failed'));
    const healthy = new ScriptedBoss();
    const created = [started, healthy];

    const boss = await initializePgBoss({
      createBoss: () => created.shift()!,
      processesJobs: false,
      maxAttempts: 2,
      required: true,
      sleep: async () => undefined,
    });

    expect(started.stop).toHaveBeenCalledWith({ graceful: false, close: true });
    expect(boss).toBe(healthy);
    expect(boss.processesJobs).toBe(false);
  });

  it('mutes a discarded instance whose leaked pg-boss timers keep emitting errors', async () => {
    // pg-boss cannot stop() after a failed start(), so timers started before
    // the failure keep running against the closed pool and emit `error`.
    class LeakyFailedBoss extends EventEmitter {
      isAvailable = false;
      readonly stop = vi.fn(async () => undefined);
      readonly send = vi.fn(async () => null);
      readonly work = vi.fn(async () => undefined);
      readonly createQueue = vi.fn(async () => undefined);

      async start(): Promise<unknown> {
        throw new Error('createQueue failed after the queue cache timer started');
      }
    }
    const failed = new LeakyFailedBoss();
    const healthy = new ScriptedBoss();
    const created: StartablePgBoss[] = [failed, healthy];
    const loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    try {
      await initializePgBoss({
        createBoss: () => created.shift()!,
        processesJobs: true,
        maxAttempts: 2,
        required: true,
        sleep: async () => undefined,
      });
      loggerError.mockClear();

      expect(() =>
        failed.emit('error', { message: 'Database not opened. Call open() before executing SQL.' }),
      ).not.toThrow();
      expect(loggerError).not.toHaveBeenCalled();
      expect(failed.listenerCount('warning')).toBe(0);
    } finally {
      loggerError.mockRestore();
    }
  });

  it('fails startup in production instead of serving with a permanently unavailable boss', async () => {
    const createBoss = vi.fn(() => new ScriptedBoss(new Error('remaining connection slots are reserved')));

    await expect(
      initializePgBoss({
        createBoss,
        processesJobs: true,
        maxAttempts: 3,
        required: true,
        sleep: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(PgBossInitializationError);
    expect(createBoss).toHaveBeenCalledTimes(3);
  });

  it('keeps the degraded fallback outside production', async () => {
    const boss = await initializePgBoss({
      createBoss: () => new ScriptedBoss(new Error('ECONNREFUSED')),
      processesJobs: true,
      maxAttempts: 2,
      required: false,
      sleep: async () => undefined,
    });

    expect(boss.isAvailable).toBe(false);
    await expect(boss.send('refund-cancel-retry', {})).resolves.toBeNull();
  });

  it('treats only production as required', async () => {
    expect(isPgBossRequired(config({ NODE_ENV: 'production' }))).toBe(true);
    expect(isPgBossRequired(config({ NODE_ENV: 'test' }))).toBe(false);
    expect(isPgBossRequired(config({}))).toBe(false);

    await expect(
      pgbossProvider.useFactory(
        config({ NODE_ENV: 'production' }) as unknown as Parameters<
          typeof pgbossProvider.useFactory
        >[0],
      ),
    ).rejects.toThrow(/DATABASE_URL/);
    await expect(
      pgbossProvider.useFactory(
        config({ NODE_ENV: 'development' }) as unknown as Parameters<
          typeof pgbossProvider.useFactory
        >[0],
      ),
    ).resolves.toEqual(expect.objectContaining({ isAvailable: false }));
  });
});

function availableScriptedBoss(): ScriptedBoss {
  const boss = new ScriptedBoss();
  markBossAvailable(boss);
  return boss;
}

describe('stopPgBossForShutdown', () => {
  it('stops gracefully within the Cloud Run grace period, then marks the boss unavailable before closing its pool', async () => {
    const boss = availableScriptedBoss();
    boss.db.opened = true;
    let availableWhenPoolClosed: boolean | undefined;
    boss.db.close.mockImplementationOnce(async () => {
      availableWhenPoolClosed = boss.isAvailable;
      boss.db.opened = false;
    });

    await stopPgBossForShutdown(boss);

    // close:false keeps the pool open while workers drain and failWip runs.
    expect(boss.stop).toHaveBeenCalledWith({
      graceful: true,
      timeout: PGBOSS_SHUTDOWN_TIMEOUT_MS,
      close: false,
    });
    expect(PGBOSS_SHUTDOWN_TIMEOUT_MS).toBeLessThan(10_000);
    expect(boss.db.close).toHaveBeenCalledTimes(1);
    expect(availableWhenPoolClosed).toBe(false);
    expect(boss.isAvailable).toBe(false);
  });

  it('does not throw from a shutdown hook when stop fails, and still closes the pool', async () => {
    const boss = availableScriptedBoss();
    boss.db.opened = true;
    vi.mocked(boss.stop).mockRejectedValueOnce(new Error('failWip failed'));

    await expect(stopPgBossForShutdown(boss)).resolves.toBeUndefined();
    expect(boss.isAvailable).toBe(false);
    expect(boss.db.close).toHaveBeenCalledTimes(1);
  });

  it('does not close a pool that an explicit stop already closed (bounded worker path)', async () => {
    const boss = availableScriptedBoss();
    boss.db.opened = false;

    await stopPgBossForShutdown(boss);

    expect(boss.db.close).not.toHaveBeenCalled();
    expect(boss.isAvailable).toBe(false);
  });

  it('skips an unavailable boss', async () => {
    const boss = new ScriptedBoss();

    await stopPgBossForShutdown(boss);

    expect(boss.stop).not.toHaveBeenCalled();
  });
});
