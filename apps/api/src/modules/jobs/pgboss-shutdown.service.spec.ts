import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { Controller, Get, Inject, type INestApplication } from '@nestjs/common';
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

/** A boss whose pool and availability behave like the real producer path. */
function createRecordingBoss(events: string[]) {
  const db = {
    opened: true,
    close: vi.fn(async () => {
      events.push('pool.close');
      db.opened = false;
    }),
  };
  const boss = {
    ...createBoss(),
    getDb: () => db,
    stop: vi.fn(async () => {
      events.push('boss.stop');
    }),
    send: vi.fn(async () => {
      // Producers treat an unavailable boss as "not enqueued".
      const jobId = boss.isAvailable && db.opened ? 'job-1' : null;
      events.push(`send:${jobId ?? 'null'}`);
      return jobId;
    }),
  };
  return { boss, db };
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
      close: false,
    });
    expect(boss.isAvailable).toBe(false);
  });

  it('closes the pool only in onApplicationShutdown, after the graceful stop finished', async () => {
    const events: string[] = [];
    const { boss } = createRecordingBoss(events);
    const moduleRef = await compileWith(boss);
    const service = moduleRef.get(
      (await import('./pgboss-shutdown.service.js')).PgBossShutdownService,
    );

    await service.beforeApplicationShutdown();
    expect(boss.isAvailable).toBe(true);
    expect(events).toEqual(['boss.stop']);

    await service.onApplicationShutdown();
    expect(boss.isAvailable).toBe(false);
    expect(events).toEqual(['boss.stop', 'pool.close']);

    await moduleRef.close();
    expect(boss.stop).toHaveBeenCalledTimes(1);
  });

  it('lets a request in flight at SIGTERM enqueue after pg-boss stopped, before its pool closes', async () => {
    const events: string[] = [];
    const { boss } = createRecordingBoss(events);
    let releaseRequest!: () => void;
    const requestGate = new Promise<void>((resolveGate) => {
      releaseRequest = resolveGate;
    });
    let markRequestStarted!: () => void;
    const requestStarted = new Promise<void>((resolveStarted) => {
      markRequestStarted = resolveStarted;
    });

    @Controller('refunds')
    class RefundProbeController {
      constructor(@Inject(PG_BOSS) private readonly pgBoss: PgBossContract) {}

      @Get('retry')
      async scheduleRetry(): Promise<{ jobId: string | null }> {
        markRequestStarted();
        await requestGate;
        return { jobId: await this.pgBoss.send('refund-cancel-retry', { refundId: 'r-1', attempt: 1 }) };
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [PgbossModule],
      controllers: [RefundProbeController],
    })
      .overrideProvider(PG_BOSS)
      .useValue(boss)
      .compile();
    const app: INestApplication = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;

    const response = new Promise<{ status: number; body: string }>((resolveResponse, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/refunds/retry', agent: false }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolveResponse({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end();
    });
    await requestStarted;

    // What Nest runs on SIGTERM.
    const closing = app.close();
    await vi.waitFor(() => expect(events).toContain('boss.stop'));
    releaseRequest();

    await expect(response).resolves.toEqual({ status: 200, body: JSON.stringify({ jobId: 'job-1' }) });
    await closing;
    expect(events).toEqual(['boss.stop', 'send:job-1', 'pool.close']);
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

  it('enables Nest shutdown hooks for termination signals only, before listening', async () => {
    const source = await readFile(resolve(__dirname, '../../main.ts'), 'utf8');
    const deadlineIndex = source.indexOf(
      'installShutdownRunDeadline(process, API_SHUTDOWN_DRAIN_BUDGET_MS)',
    );
    const hookIndex = source.indexOf("app.enableShutdownHooks(['SIGTERM', 'SIGINT'])");
    const listenIndex = source.indexOf('await app.listen(');

    // The no-argument form subscribes Nest's whole ShutdownSignal list,
    // including SIGSEGV/SIGBUS/SIGFPE/SIGILL.
    expect(source).not.toContain('app.enableShutdownHooks()');
    expect(hookIndex).toBeGreaterThan(-1);
    expect(listenIndex).toBeGreaterThan(hookIndex);
    // The drain deadline listener is registered first, so Node runs it before
    // Nest starts the onModuleDestroy drains.
    expect(deadlineIndex).toBeGreaterThan(-1);
    expect(hookIndex).toBeGreaterThan(deadlineIndex);
  });
});
