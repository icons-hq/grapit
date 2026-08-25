import { describe, expect, it } from 'vitest';
import {
  buildPgBossOptions,
  bootstrapPgBossQueues,
  isBackgroundProcessingEnabled,
  loadPgBossConstructor,
  markBossAvailable,
  PG_BOSS_QUEUE_NAMES,
  resolvePgBossConstructor,
  type PgBossContract,
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
