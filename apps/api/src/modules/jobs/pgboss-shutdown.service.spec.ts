import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { PgbossModule } from './pgboss.module.js';
import {
  PG_BOSS,
  PGBOSS_SHUTDOWN_TIMEOUT_MS,
  type PgBossContract,
} from './pgboss.provider.js';

function createBoss(): PgBossContract {
  return {
    isAvailable: true,
    processesJobs: true,
    createQueue: vi.fn(async () => undefined),
    send: vi.fn(async () => 'job-1'),
    work: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
}

async function compileWith(boss: PgBossContract) {
  const moduleRef = await Test.createTestingModule({ imports: [PgbossModule] })
    .overrideProvider(PG_BOSS)
    .useValue(boss)
    .compile();
  await moduleRef.init();
  return moduleRef;
}

describe('PgBossShutdownService', () => {
  it('stops pg-boss gracefully when the Nest application shuts down', async () => {
    const boss = createBoss();
    const moduleRef = await compileWith(boss);

    await moduleRef.close();

    expect(boss.stop).toHaveBeenCalledTimes(1);
    expect(boss.stop).toHaveBeenCalledWith({
      graceful: true,
      timeout: PGBOSS_SHUTDOWN_TIMEOUT_MS,
    });
    expect(boss.isAvailable).toBe(false);
  });

  it('tolerates an explicit stop before close (bounded worker path)', async () => {
    const boss = createBoss();
    const moduleRef = await compileWith(boss);

    await boss.stop();
    await expect(moduleRef.close()).resolves.toBeUndefined();

    // pg-boss itself ignores a second stop(); the hook must not throw either.
    expect(boss.stop).toHaveBeenCalledTimes(2);
  });

  it('enables Nest shutdown hooks in the API entrypoint before listening', async () => {
    const source = await readFile(resolve(__dirname, '../../main.ts'), 'utf8');
    const hookIndex = source.indexOf('app.enableShutdownHooks()');
    const listenIndex = source.indexOf('await app.listen(');

    expect(hookIndex).toBeGreaterThan(-1);
    expect(listenIndex).toBeGreaterThan(hookIndex);
  });
});
