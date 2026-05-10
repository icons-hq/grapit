import { describe, expect, it } from 'vitest';
import {
  loadPgBossConstructor,
  markBossAvailable,
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
    expect(availableBoss.send).toBe(FakeBoss.prototype.send);
    expect(availableBoss.work).toBe(FakeBoss.prototype.work);
    expect(availableBoss.stop).toBe(FakeBoss.prototype.stop);
  });
});
