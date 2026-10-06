import { Agent } from 'node:http';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { FactoryProvider, INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { HealthCheckService, HealthIndicatorService, TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import type IORedis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

import { createGlobalExceptionFilters } from '../../common/filters/global-exception-filters.js';
import { REDIS_CLIENT, redisProvider } from '../../modules/booking/providers/redis.provider.js';
import { HealthController } from '../health.controller.js';
import { RedisHealthIndicator } from '../redis.health.indicator.js';

async function reserveClosedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * PR #235 review: the API liveness probe called `/api/v1/health`, which pings
 * Valkey, so a Valkey outage or reconnect window failed liveness on every
 * healthy instance and Cloud Run restarted them all. The liveness route must
 * stay up while the provider-built client keeps reconnecting, and fail only
 * once the client is stuck in ioredis' terminal `end` state.
 */
describe('HealthController probes against a provider-built Valkey client during an outage', () => {
  let app: INestApplication;
  let agent: Agent;
  let redis: IORedis;

  beforeAll(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = await reserveClosedPort();
    const config = {
      get: vi.fn((key: string, defaultValue?: string) => {
        if (key === 'redis.url') return `redis://127.0.0.1:${port}`;
        if (key === 'redis.mode') return 'standalone';
        return defaultValue ?? '';
      }),
    } as unknown as ConfigService;
    // Valkey is down: the port refuses every connection.
    redis = (redisProvider as FactoryProvider).useFactory(config) as IORedis;

    // Vitest (esbuild) emits no decorator metadata.
    Reflect.defineMetadata('design:paramtypes', [HealthCheckService, RedisHealthIndicator], HealthController);
    Reflect.defineMetadata('design:paramtypes', [HealthIndicatorService, Object], RedisHealthIndicator);
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule.forRoot({ logger: false })],
      controllers: [HealthController],
      providers: [RedisHealthIndicator, { provide: REDIS_CLIENT, useValue: redis }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalFilters(...createGlobalExceptionFilters());
    await app.init();
    await app.listen(0, '127.0.0.1');
    agent = new Agent({ keepAlive: true, maxSockets: 1 });
  });

  afterAll(async () => {
    agent?.destroy();
    await app?.close();
    redis?.disconnect();
    vi.restoreAllMocks();
  });

  function get(path: string) {
    return request(app.getHttpServer()).get(path).agent(agent);
  }

  it('keeps liveness up while the client reconnects, and fails the PING route', async () => {
    const live = await get('/health/live');
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({
      status: 'ok',
      info: { redis: { status: 'up', mode: 'standalone', client: 'ioredis-standalone' } },
    });
    expect(['connecting', 'reconnecting', 'close']).toContain(redis.status);

    const health = await get('/health');
    expect(health.status).toBe(503);
    expect(health.body).toMatchObject({ status: 'error', error: { redis: { status: 'down' } } });

    // Still reconnecting after the failed ping: liveness is unchanged.
    expect(redis.status).not.toBe('end');
    expect((await get('/health/live')).status).toBe(200);
  });

  it('fails liveness once the client stops reconnecting and sits in the terminal end state', async () => {
    // The audit #7 failure mode: a reconnect strategy that gives up moves
    // ioredis to `end` (ioredis reads the strategy at each failed attempt).
    const ended = new Promise<void>((resolve) => redis.once('end', () => resolve()));
    redis.options.retryStrategy = () => null;
    await ended;
    expect(redis.status).toBe('end');

    const live = await get('/health/live');

    expect(live.status).toBe(503);
    expect(live.body).toMatchObject({
      status: 'error',
      error: {
        redis: {
          status: 'down',
          endedClients: expect.arrayContaining(['standalone client']),
          message: 'redis client stopped reconnecting (end state)',
        },
      },
    });
  });
});
