# Phase 20: valkey-production-connectivity-contract - Pattern Map

**Mapped:** 2026-04-30  
**Files analyzed:** 20  
**Analogs found:** 20 / 20  

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/api/src/config/redis.config.ts` | config | transform | `apps/api/src/config/auth.config.ts` + current file | exact |
| `apps/api/src/modules/booking/providers/redis.provider.ts` | provider | request-response, pub-sub | same file | exact |
| `apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts` | test | request-response, transform | same file | exact |
| `apps/api/src/health/redis.health.indicator.ts` | service | request-response | same file | exact |
| `apps/api/src/health/health.controller.ts` | controller | request-response | same file | exact |
| `apps/api/src/health/__tests__/redis.health.indicator.spec.ts` | test | request-response | same file | exact |
| `apps/api/src/modules/booking/providers/redis-io.adapter.ts` | provider | event-driven, pub-sub | same file | exact |
| `apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts` | test | event-driven, pub-sub | same file | exact |
| `apps/api/src/main.ts` | config | bootstrap, request-response | same file | exact |
| `apps/api/src/modules/booking/booking.service.ts` | service | CRUD, atomic Lua | same file | exact |
| `apps/api/src/modules/booking/booking.gateway.ts` | provider | event-driven, pub-sub | same file | exact |
| `apps/api/src/modules/booking/booking.controller.ts` | controller | CRUD, request-response | same file | exact |
| `apps/api/test/booking-cluster-lua.integration.spec.ts` | test | CRUD, cluster Lua | `apps/api/test/sms-cluster-crossslot.integration.spec.ts` + booking integration spec | partial |
| `.github/workflows/deploy.yml` | config | batch, deploy | same file | exact |
| `.github/workflows/ci.yml` | config | batch, test orchestration | same file | exact |
| `scripts/provision-valkey.sh` | utility | batch, infra | same file | exact |
| `scripts/smoke-valkey-production.mjs` | utility | request-response, event-driven, file-I/O | `apps/api/src/database/seed.mjs`, `apps/web/lib/socket-client.ts`, `18-HUMAN-UAT.md` | partial |
| `.planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md` | test artifact | smoke/UAT | `18-HUMAN-UAT.md` + `14-HUMAN-UAT.md` + `07-HUMAN-UAT.md` | role-match |
| `.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md` | test artifact | verification report | `14-VERIFICATION.md` + `17-VERIFICATION.md` | role-match |
| `apps/api/package.json` | config | dependency/config | same file | exact |

## Pattern Assignments

### `apps/api/src/config/redis.config.ts` (config, transform)

**Analog:** `apps/api/src/config/redis.config.ts`, `apps/api/src/config/auth.config.ts`

**Imports and namespace pattern** (`redis.config.ts` lines 1-5):
```typescript
import { registerAs } from '@nestjs/config';

export const redisConfig = registerAs('redis', () => ({
  url: process.env['REDIS_URL'] ?? '',
}));
```

**Peer config shape** (`auth.config.ts` lines 1-8):
```typescript
import { registerAs } from '@nestjs/config';

export const authConfig = registerAs('auth', () => ({
  jwtSecret: process.env['JWT_SECRET'],
  jwtRefreshSecret: process.env['JWT_REFRESH_SECRET'],
  jwtExpiresIn: '15m',
  jwtRefreshExpiresIn: '7d',
}));
```

**Apply:** extend the existing `redis` namespace with an explicit mode field, e.g. `mode: process.env['VALKEY_MODE'] ?? ''`. Keep access through `ConfigService.get('redis.mode')`; do not read unrelated env in services.

---

### `apps/api/src/modules/booking/providers/redis.provider.ts` (provider, request-response/pub-sub)

**Analog:** same file

**Imports/injection token pattern** (lines 1-5):
```typescript
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
```

**Production fail-closed + local fallback pattern** (lines 488-511):
```typescript
export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IORedis | InMemoryRedis => {
    const url = config.get<string>('redis.url', '');

    if (!url) {
      if (process.env['NODE_ENV'] === 'production') {
        throw new Error(
          '[redis] REDIS_URL is required in production environment. ' +
            'Silent InMemoryRedis fallback is disabled to prevent duplicate bookings from instance-isolated seat locking. ' +
            'Check Cloud Run secret binding for redis-url.',
        );
      }
      console.warn(
        '[redis] No REDIS_URL — using in-memory mock. Seat locking works but is not persistent. ' +
          '(Development/test only — production now hard-fails.)',
      );
      return new InMemoryRedis() as unknown as IORedis;
    }
```

**Existing ioredis client pattern** (lines 513-534):
```typescript
const client = new IORedis(url, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  retryStrategy: (times: number) => {
    if (times > 5) return null;
    return Math.min(times * 500, 5000);
  },
});

client.on('error', (err: Error) => {
  if (err.message.includes('ECONNREFUSED')) {
    if (!redisWarned) {
      redisWarned = true;
      console.warn('[redis] Redis unavailable — seat locking will fail. This is fine for local dev without REDIS_URL.');
    }
  } else {
    console.error('[redis] Error:', err.message);
  }
});

client.connect().catch(() => {});
return client;
```

**Testing analog** (`redis.provider.spec.ts` lines 57-99):
```typescript
it('throws when NODE_ENV=production and REDIS_URL is empty (hard-fail guard)', () => {
  process.env['NODE_ENV'] = 'production';
  const config = createMockConfig('');

  expect(() => useFactory(config)).toThrowError(/REDIS_URL is required in production/);
});

it('returns a real ioredis instance when REDIS_URL is set (production)', () => {
  process.env['NODE_ENV'] = 'production';
  const config = createMockConfig('redis://localhost:6379');

  const client = useFactory(config);

  expect(typeof (client as IORedis).duplicate).toBe('function');

  (client as IORedis).disconnect();
});
```

**Apply:** keep the mode/client switch inside this provider. Import `Cluster` from `ioredis` here if needed; do not spread cluster-mode decisions into booking/cache/health services. Any error message that mentions config must redact `REDIS_URL`.

---

### `apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts` (test, request-response/transform)

**Analog:** same file

**Mock config helper pattern** (lines 31-37):
```typescript
function createMockConfig(url: string): ConfigService {
  return {
    get: vi.fn().mockImplementation((_key: string, defaultValue?: string) => {
      if (url === '') return defaultValue ?? '';
      return url;
    }),
  } as unknown as ConfigService;
}
```

**Local fallback coverage pattern** (lines 64-86):
```typescript
it('returns InMemoryRedis mock when NODE_ENV=development and REDIS_URL is empty', () => {
  process.env['NODE_ENV'] = 'development';
  const config = createMockConfig('');
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const client = useFactory(config) as unknown as { set: unknown; get: unknown; eval: unknown };

  expect(typeof client.set).toBe('function');
  expect(typeof client.get).toBe('function');
  expect(typeof client.eval).toBe('function');
  expect(warnSpy).toHaveBeenCalled();
  warnSpy.mockRestore();
});
```

**Apply:** replace or extend `createMockConfig` so it can return values by key (`redis.url`, `redis.mode`). Add tests for `VALKEY_MODE=cluster`, invalid mode, production missing explicit mode, cluster client construction, and no secret leakage in thrown errors.

---

### `apps/api/src/health/redis.health.indicator.ts` (service, request-response)

**Analog:** same file

**Imports and DI pattern** (lines 1-6, 22-27):
```typescript
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import type IORedis from 'ioredis';

import { REDIS_CLIENT } from '../modules/booking/providers/redis.provider.js';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {}
```

**Core health/error pattern** (lines 29-47):
```typescript
async isHealthy(key: string): Promise<HealthIndicatorResult> {
  const indicator = this.healthIndicatorService.check(key);
  const maybeRedis = this.redis as { ping?: () => Promise<string> | string };

  if (typeof maybeRedis.ping !== 'function') {
    return indicator.up({
      message: 'ping unavailable; assuming local in-memory Redis mock',
    });
  }

  try {
    const pong = await maybeRedis.ping();
    if (pong !== 'PONG') {
      return indicator.down({ message: `unexpected ping response: ${String(pong)}` });
    }
    return indicator.up();
  } catch (err) {
    return indicator.down({ message: (err as Error).message });
  }
}
```

**Apply:** add sanitized mode/client metadata to `indicator.up()` and down paths. The metadata may include `mode`, `client`, or `configured: true`, but must not include `redis://`, host credentials, raw host/IP, auth headers, JWT, or cookies.

---

### `apps/api/src/health/health.controller.ts` (controller, request-response)

**Analog:** same file

**Public health endpoint pattern** (lines 1-19):
```typescript
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator.js';
import { RedisHealthIndicator } from './redis.health.indicator.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redisIndicator: RedisHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.redisIndicator.isHealthy('redis'),
    ]);
  }
}
```

**Apply:** keep `/api/v1/health` as the smoke surface. Prefer putting Valkey metadata inside `RedisHealthIndicator`, not a custom controller response wrapper.

---

### `apps/api/src/health/__tests__/redis.health.indicator.spec.ts` (test, request-response)

**Analog:** same file

**Mock Terminus session pattern** (lines 18-28):
```typescript
function createMockHealthService() {
  return {
    check: vi.fn((key: string) => ({
      up: vi.fn((data?: unknown) => ({
        [key]: { status: 'up' as const, ...(data as Record<string, unknown> | undefined) },
      })),
      down: vi.fn((data?: unknown) => ({
        [key]: { status: 'down' as const, ...(data as Record<string, unknown> | undefined) },
      })),
    })),
  };
}
```

**Ping assertions pattern** (lines 46-81):
```typescript
it('reports up when redis.ping() returns PONG', async () => {
  mockRedis.ping.mockResolvedValueOnce('PONG');

  const result = (await indicator.isHealthy('redis')) as IndicatorResult;

  expect(mockRedis.ping).toHaveBeenCalledOnce();
  expect(result['redis']?.status).toBe('up');
});

it('reports down when redis.ping() rejects with error', async () => {
  mockRedis.ping.mockRejectedValueOnce(new Error('ECONNREFUSED'));

  const result = (await indicator.isHealthy('redis')) as IndicatorResult;

  expect(result['redis']?.status).toBe('down');
  expect(result['redis']?.message).toContain('ECONNREFUSED');
});
```

**Apply:** add tests that health output includes mode/client metadata and `JSON.stringify(result)` does not contain forbidden patterns such as `redis://`, `Authorization`, `Cookie`, `JWT`, or full secret-like values.

---

### `apps/api/src/modules/booking/providers/redis-io.adapter.ts` (provider, event-driven/pub-sub)

**Analog:** same file

**Adapter import and duplicate pattern** (lines 1-28):
```typescript
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type IORedis from 'ioredis';
import type { ServerOptions } from 'socket.io';

export function createSocketIoRedisAdapter(
  ioredisClient: IORedis,
): ReturnType<typeof createAdapter> {
  const pubClient = ioredisClient;
  const subClient = pubClient.duplicate({
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  return createAdapter(pubClient, subClient);
}
```

**Fallback and visibility pattern** (lines 73-94):
```typescript
connectToRedis(): boolean {
  const maybeClient = this.redisClient as { duplicate?: (opts?: unknown) => IORedis };
  if (typeof maybeClient.duplicate !== 'function') {
    this.logger.warn(
      'REDIS_CLIENT has no duplicate() — assuming InMemoryRedis mock. Multi-instance Socket.IO pub/sub DISABLED. Set REDIS_URL to enable.',
    );
    return false;
  }
  const pubClient = this.redisClient as IORedis;
  const subClient = pubClient.duplicate({
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  this.adapterConstructor = createAdapter(pubClient, subClient);
  this.logger.log('Socket.IO Redis adapter wired (pub/sub via duplicated ioredis client with null retries on sub)');
  return true;
}
```

**Apply:** preserve local `false` fallback, but make production adapter failure visible to `main.ts`. If production has `REDIS_URL`/`VALKEY_MODE`, startup must not silently continue with in-process pub/sub.

---

### `apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts` (test, event-driven/pub-sub)

**Analog:** same file

**Adapter wiring test pattern** (lines 21-37):
```typescript
it('wires the Redis adapter when the injected client exposes duplicate()', () => {
  const subClient = { on: vi.fn(), subscribe: vi.fn() };
  const duplicate = vi.fn().mockReturnValue(subClient);
  const pubClient = { duplicate } as unknown as IORedis;

  const adapter = new RedisIoAdapter(mockApp, pubClient);
  const wired = adapter.connectToRedis();

  expect(wired).toBe(true);
  expect(duplicate).toHaveBeenCalledTimes(1);
  expect(duplicate).toHaveBeenCalledWith({
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
});
```

**Fallback test pattern** (lines 39-47):
```typescript
it('falls back gracefully when the client has no duplicate() method', () => {
  const inMemoryMock = { set: vi.fn(), get: vi.fn() } as unknown as IORedis;

  const adapter = new RedisIoAdapter(mockApp, inMemoryMock);
  const wired = adapter.connectToRedis();

  expect(wired).toBe(false);
});
```

**Apply:** add a production visibility test around the boolean contract, or around a new explicit error helper if added. Keep tests branch-focused; do not boot a real Socket.IO server here.

---

### `apps/api/src/main.ts` (bootstrap config, request-response/event-driven)

**Analog:** same file

**Production hard-fail pattern** (lines 28-43):
```typescript
if (process.env['NODE_ENV'] === 'production') {
  if (frontendOrigins.length === 0) {
    console.error(
      `[bootstrap] FRONTEND_URL must be set in production. ` +
        `Reset links and email deliverability depend on this. Aborting startup.`,
    );
    process.exit(1);
  }
  const nonHttps = frontendOrigins.filter((o) => !o.startsWith('https://'));
  if (nonHttps.length > 0) {
    console.error(
      `[bootstrap] All FRONTEND_URL origins must be https in production. ` +
        `Received non-https: ${nonHttps.join(', ')}. Aborting startup.`,
    );
    process.exit(1);
  }
}
```

**Current adapter wiring pattern** (lines 48-54):
```typescript
const redisClient = app.get<IORedis>(REDIS_CLIENT);
const redisIoAdapter = new RedisIoAdapter(app, redisClient);
redisIoAdapter.connectToRedis();
app.useWebSocketAdapter(redisIoAdapter);
```

**Fatal startup catch pattern** (lines 81-87):
```typescript
bootstrap().catch((err) => {
  console.error('[bootstrap] Fatal startup error:', err);
  process.exit(1);
});
```

**Apply:** capture `const redisPubSubReady = redisIoAdapter.connectToRedis();` and fail in production if false. Use the existing fail-closed style (`console.error` + `process.exit(1)` or throwing into the bootstrap catch).

---

### `apps/api/src/modules/booking/booking.service.ts` (service, CRUD/atomic Lua)

**Analog:** same file

**Hash-tag Lua key contract** (lines 24-39):
```typescript
/**
 * Lua script for atomic seat locking.
 *
 * KEYS[1] = {showtimeId}:user-seats:{userId}
 * KEYS[2] = {showtimeId}:seat:{seatId}
 * KEYS[3] = {showtimeId}:locked-seats
 *
 * Hash tag {showtimeId} ensures all keys hash to the same Redis Cluster slot.
 */
const LOCK_SEAT_LUA = `
```

**Lock path to use for production smoke** (lines 251-267):
```typescript
const userSeatsKey = `{${showtimeId}}:user-seats:${userId}`;
const lockKey = `{${showtimeId}}:seat:${seatId}`;
const lockedSeatsKey = `{${showtimeId}}:locked-seats`;
const keyPrefix = `{${showtimeId}}:seat:`;

const result = (await this.redis.eval(
  LOCK_SEAT_LUA,
  3,
  userSeatsKey,
  lockKey,
  lockedSeatsKey,
  userId,
  String(LOCK_TTL),
  String(MAX_SEATS),
  seatId,
  keyPrefix,
)) as [number, string, string?];
```

**Unlock path to use for production cleanup** (lines 293-313):
```typescript
async unlockSeat(userId: string, showtimeId: string, seatId: string): Promise<boolean> {
  const lockKey = `{${showtimeId}}:seat:${seatId}`;
  const userSeatsKey = `{${showtimeId}}:user-seats:${userId}`;
  const lockedSeatsKey = `{${showtimeId}}:locked-seats`;

  const result = (await this.redis.eval(
    UNLOCK_SEAT_LUA,
    3,
    lockKey,
    userSeatsKey,
    lockedSeatsKey,
    userId,
    seatId,
  )) as number;
```

**Seat status smoke path** (lines 482-491):
```typescript
async getSeatStatus(showtimeId: string): Promise<SeatStatusResponse> {
  const lockedSeatsKey = `{${showtimeId}}:locked-seats`;
  const keyPrefix = `{${showtimeId}}:seat:`;
  const lockedSeats = (await this.redis.eval(
    GET_VALID_LOCKED_SEATS_LUA,
    1,
    lockedSeatsKey,
    keyPrefix,
  )) as string[];
```

**Apply:** do not rewrite service ownership behavior. New cluster tests and production smoke should call the existing lock/status/unlock paths and verify they keep same-slot hash tags.

---

### `apps/api/src/modules/booking/booking.gateway.ts` (provider, event-driven/pub-sub)

**Analog:** same file

**Namespace and CORS pattern** (lines 14-35):
```typescript
@WebSocketGateway({
  namespace: '/booking',
  cors: {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      const allowedOrigin =
        process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
      if (
        process.env['NODE_ENV'] !== 'production' ||
        !origin ||
        origin === allowedOrigin
      ) {
        callback(null, true);
      } else {
        callback(new Error('CORS not allowed'));
      }
    },
    credentials: true,
  },
})
```

**Room join and broadcast path** (lines 51-65, 80-86):
```typescript
@SubscribeMessage('join-showtime')
handleJoinShowtime(
  @ConnectedSocket() client: Socket,
  @MessageBody() showtimeId: string,
): { event: string; data: string } {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(showtimeId)) {
    this.logger.warn(`Invalid showtime ID from client ${client.id}: ${showtimeId}`);
    return { event: 'error', data: 'Invalid showtime ID' };
  }

  void client.join(`showtime:${showtimeId}`);
  this.logger.log(`Client ${client.id} joined showtime:${showtimeId}`);
  return { event: 'joined', data: showtimeId };
}

broadcastSeatUpdate(showtimeId: string, seatId: string, status: SeatState, userId?: string): void {
  this.server.to(`showtime:${showtimeId}`).emit('seat-update', {
    seatId,
    status,
    userId,
  });
}
```

**Apply:** production socket smoke should connect to `/booking`, emit `join-showtime` with a UUID showtime, trigger lock/unlock through HTTP, and observe `seat-update`.

---

### `apps/api/src/modules/booking/booking.controller.ts` (controller, CRUD/request-response)

**Analog:** same file

**Authenticated lock/unlock API pattern** (lines 26-49):
```typescript
@Post('seats/lock')
@HttpCode(HttpStatus.CREATED)
async lockSeat(
  @Body(new ZodValidationPipe(lockSeatSchema)) body: LockSeatBody,
  @Req() req: Request,
) {
  const user = req.user as { id: string };
  return this.bookingService.lockSeat(user.id, body.showtimeId, body.seatId);
}

@Delete('seats/lock/:showtimeId/:seatId')
@HttpCode(HttpStatus.NO_CONTENT)
async unlockSeat(
  @Param('showtimeId') showtimeId: string,
  @Param('seatId') seatId: string,
  @Req() req: Request,
) {
  const user = req.user as { id: string };
  await this.bookingService.unlockSeat(user.id, showtimeId, seatId);
}
```

**Public status API pattern** (lines 79-87):
```typescript
@Public()
@Get('schedules/:showtimeId/seats')
async getSeatStatus(@Param('showtimeId') showtimeId: string) {
  return this.bookingService.getSeatStatus(showtimeId);
}
```

**Apply:** smoke harness must pass auth for lock/unlock and can use public status for readback. Do not add unauthenticated production mutation endpoints.

---

### `apps/api/test/booking-cluster-lua.integration.spec.ts` (test, CRUD/cluster Lua)

**Analog:** `apps/api/test/sms-cluster-crossslot.integration.spec.ts`, `apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts`

**Cluster bootstrap pattern** (`sms-cluster-crossslot.integration.spec.ts` lines 76-144):
```typescript
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

const boot = new IORedis(`redis://${host}:${port}`, {
  maxRetriesPerRequest: 3,
});

await boot.call('CONFIG', 'SET', 'cluster-announce-ip', host);
await boot.call('CONFIG', 'SET', 'cluster-announce-port', String(port));
await boot.call('CLUSTER', 'ADDSLOTSRANGE', '0', '16383');

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
```

**Negative CROSSSLOT guard pattern** (lines 160-175):
```typescript
describe('과거 스킴 (hash-tag 없음) 은 cluster-mode 에서 CROSSSLOT 을 던진다', () => {
  it('rejects with CROSSSLOT reply error', async () => {
    await expect(
      cluster.eval(
        VERIFY_AND_INCREMENT_LUA,
        3,
        `sms:otp:${PHONE}`,
        `sms:attempts:${PHONE}`,
        `sms:verified:${PHONE}`,
        '123456',
        '5',
        '600',
      ),
    ).rejects.toThrow(/CROSSSLOT/);
  });
});
```

**Booking service factory pattern** (`booking.service.integration.spec.ts` lines 29-40):
```typescript
function createBookingService(redis: IORedis): BookingService {
  const mockDb = {
    select: () => ({
      from: () => ({
        where: async () => [],
      }),
    }),
  };
  const mockGateway = {
    broadcastSeatUpdate: () => {},
  };
  return new BookingService(redis, mockDb as any, mockGateway as any);
}
```

**Booking Lua assertions to port** (`booking.service.integration.spec.ts` lines 87-157):
```typescript
it('locks a seat through BookingService.lockSeat on real Valkey', async () => {
  const service = createBookingService(redis);

  await expect(service.lockSeat(userId, showtimeId, seatId))
    .resolves
    .toMatchObject({
      success: true,
      lockId: lockKey,
      seatId,
    });

  const owner = await redis.get(lockKey);
  expect(owner).toBe(userId);

  const ttl = await redis.ttl(lockKey);
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(LOCK_TTL);
});
```

**Apply:** create the new integration spec under `apps/api/test/` so `vitest.integration.config.ts` includes it. Use `Cluster` as the injected Redis client and verify lock/status/unlock plus `CLUSTER KEYSLOT` equality for `{showtimeId}` keys.

---

### `.github/workflows/deploy.yml` (config, batch/deploy)

**Analog:** same file

**Production origin validation pattern** (lines 32-63):
```yaml
- name: Validate production origins
  run: |
    node - <<'NODE'
    const values = {
      CLOUD_RUN_API_URL: process.env.CLOUD_RUN_API_URL,
      CLOUD_RUN_WEB_URL: process.env.CLOUD_RUN_WEB_URL,
    };
    const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
    // validate each configured origin before deploy
    NODE
  env:
    CLOUD_RUN_API_URL: ${{ vars.CLOUD_RUN_API_URL }}
    CLOUD_RUN_WEB_URL: ${{ vars.CLOUD_RUN_WEB_URL }}
```

**Cloud Run VPC/secret wiring pattern** (lines 115-148):
```yaml
flags: >-
  --service-account=grapit-cloudrun@${{ env.GCP_PROJECT_ID }}.iam.gserviceaccount.com
  --add-cloudsql-instances=${{ secrets.CLOUD_SQL_CONNECTION_NAME }}
  --min-instances=0
  --max-instances=5
  --memory=512Mi
  --cpu=1
  --port=8080
  --no-cpu-throttling
  --session-affinity
  --allow-unauthenticated
  --network=default
  --subnet=default
  --vpc-egress=private-ranges-only
env_vars: |
  NODE_ENV=production
  FRONTEND_URL=${{ vars.CLOUD_RUN_WEB_URL }}
secrets: |
  DATABASE_URL=database-url:latest
  JWT_SECRET=jwt-secret:latest
  JWT_REFRESH_SECRET=jwt-refresh-secret:latest
  REDIS_URL=redis-url:latest
```

**Apply:** add the explicit production mode contract to `env_vars`, likely `VALKEY_MODE=cluster`. Do not alter `min-instances=0` permanently for the smoke.

---

### `.github/workflows/ci.yml` (config, batch/test orchestration)

**Analog:** same file

**Integration test step pattern** (lines 52-59):
```yaml
# [Phase 14 / SC-2 / REVIEWS.md HIGH#1] Integration tests — testcontainers-based
# Valkey Cluster + Postgres smokes. Docker daemon on ubuntu-latest is sufficient
# (testcontainers uses /var/run/docker.sock). This step makes SC-2 "CI 편입" 실체화:
# sms-cluster-crossslot.integration.spec.ts 가 PR/push 에서 자동 실행되어 cluster
# CROSSSLOT 회귀를 영구 차단.
- name: Integration tests (testcontainers — SC-2 Valkey Cluster CROSSSLOT guard)
  run: pnpm --filter @grabit/api test:integration
```

**Apply:** the new booking cluster Lua spec will be picked up automatically by `test:integration` if placed under `apps/api/test/*.integration.spec.ts`. Rename the step only if planner wants it to mention booking as well.

---

### `scripts/provision-valkey.sh` (utility, batch/infra)

**Analog:** same file

**Provisioning command pattern** (lines 59-78):
```bash
echo "=== Step 3: Create Memorystore for Valkey instance ==="
echo "Instance: $INSTANCE_NAME"
echo "Region:   $REGION"
echo "Node:     shared-core-nano (1 shard, 0 replicas, VALKEY_8_0)"
echo ""
gcloud memorystore instances create "$INSTANCE_NAME" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --node-type=shared-core-nano \
  --shard-count=1 \
  --replica-count=0 \
  --engine-version=VALKEY_8_0 \
  --endpoints="[{\"connections\": [{\"pscAutoConnection\": {\"network\": \"projects/$PROJECT_ID/global/networks/$NETWORK\", \"projectId\": \"$PROJECT_ID\"}}]}]"

echo ""
echo "=== Step 4: Describe instance (get discoveryEndpoints) ==="
gcloud memorystore instances describe "$INSTANCE_NAME" \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --format="yaml(discoveryEndpoints,state)"
```

**Secret wiring notes pattern** (lines 83-95):
```bash
echo "Next steps (run manually):"
echo "  1. Copy the discoveryEndpoints address:port from above."
echo "  2. Register the Secret Manager secret:"
echo "       echo -n 'redis://<IP>:<PORT>' | \\"
echo "         gcloud secrets create redis-url --data-file=- --project=$PROJECT_ID"
echo "  3. Grant Cloud Run service account access:"
echo "       gcloud secrets add-iam-policy-binding redis-url \\"
echo "         --member='serviceAccount:grapit-cloudrun@$PROJECT_ID.iam.gserviceaccount.com' \\"
echo "         --role='roles/secretmanager.secretAccessor' \\"
echo "         --project=$PROJECT_ID"
echo ""
echo "Cloud Run deploy.yml already includes --vpc-egress=private-ranges-only"
echo "and REDIS_URL=redis-url:latest, so the next deploy will wire everything up."
```

**Apply:** if modifying this file, add mode/discovery evidence instructions only. Do not re-provision or rename the existing instance.

---

### `scripts/smoke-valkey-production.mjs` (utility, request-response/event-driven/file-I/O)

**Analogs:** `apps/api/src/database/seed.mjs`, `apps/web/lib/socket-client.ts`, `apps/api/src/modules/payment/toss-payments.client.ts`, `18-HUMAN-UAT.md`

**Node script fail-fast env pattern** (`seed.mjs` lines 1-10):
```javascript
import pg from 'pg';
import argon2 from 'argon2';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
```

**Node script cleanup/error pattern** (`seed.mjs` lines 294-304):
```javascript
} catch (err) {
  await client.query('ROLLBACK');
  console.error('Seed failed:', err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}

seed();
```

**Socket client pattern** (`apps/web/lib/socket-client.ts` lines 1-14):
```typescript
import { io, type Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || '';

export function createBookingSocket(): Socket {
  return io(`${WS_URL}/booking`, {
    transports: ['websocket', 'polling'],
    withCredentials: true,
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
}
```

**HTTP fetch/error pattern** (`toss-payments.client.ts` lines 46-67):
```typescript
const response = await fetch(`${this.baseUrl}/payments/confirm`, {
  method: 'POST',
  headers: {
    Authorization: this.getAuthHeader(),
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    paymentKey: params.paymentKey,
    orderId: params.orderId,
    amount: params.amount,
  }),
});

const data: unknown = await response.json();

if (!response.ok) {
  const errorBody = data as Record<string, unknown>;
  throw new TossPaymentError(
    typeof errorBody.code === 'string' ? errorBody.code : 'UNKNOWN_ERROR',
    typeof errorBody.message === 'string' ? errorBody.message : '결제 승인에 실패했습니다',
  );
}
```

**Evidence artifact fields pattern** (`18-HUMAN-UAT.md` lines 77-100):
~~~markdown
## Deployment Revision Evidence

Pin the exact Cloud Run revisions or image identifiers that served the production smoke before marking SC-4 PASS.

**Commands:**

```bash
gcloud run services describe grabit-web --region=asia-northeast3 --project=grapit-491806 --format='value(status.latestReadyRevisionName)'
gcloud run services describe grabit-api --region=asia-northeast3 --project=grapit-491806 --format='value(status.latestReadyRevisionName)'
```

**Fields:**

- [x] UAT timestamp (UTC): ...
- [x] grabit-web latestReadyRevisionName: `...`
- [x] grabit-api latestReadyRevisionName: `...`
~~~

**Apply:** if implemented as a script, produce sanitized structured output/artifact. Inputs should include API URL, auth token/cookie source, safe showtime ID, safe seat ID, and artifact path. Never print raw auth, `REDIS_URL`, cookies, JWTs, phone numbers, payment data, or customer payloads.

---

### `.planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md` (test artifact, smoke/UAT)

**Analogs:** `18-HUMAN-UAT.md`, `14-HUMAN-UAT.md`, `07-HUMAN-UAT.md`

**Production evidence section pattern** (`18-HUMAN-UAT.md` lines 36-74):
```markdown
## Automated Gate

Record automated regression commands here. Keep output summaries short; do not paste large logs.

### Fast focused smoke

- [x] command: `...`
- [x] timestamp (UTC): ...
- [x] exit code: 0
- [x] summary: ...

### Deploy workflow contract

- [x] `.github/workflows/deploy.yml` contains ...
```

**Redaction rules pattern** (`18-HUMAN-UAT.md` lines 188-203):
```markdown
## PII and Token Redaction Rules

Reset tokens MUST NOT be recorded.

Do not record full email addresses except the allowed sender `no-reply@heygrabit.com`. Do not record reset tokens, reset-link or screenshot URLs containing token query parameters, raw Resend API keys, authorization headers, bearer token values, JWTs, cookies, raw passwords, or secret values.

Allowed evidence:

- HTTP status code and pass/fail notes without PII.
- Cloud Run revision names and image digest or Git SHA tag.
- Sentry zero-count statement or redacted event id.
```

**Valkey runtime human-needed pattern** (`07-VERIFICATION.md` lines 237-265):
```markdown
#### 2. Cloud Run → Valkey VPC 연결 안정성 (/health redis 키 확인 포함)

**Test:** 배포 완료 후 `GET /api/v1/health` 엔드포인트 호출 및 Cloud Run 로그 모니터링
**Expected:** 응답 JSON에 `"redis": { "status": "up" }` 포함. 30분 idle 후 재연결 시에도 에러 없음
**Why human:** Plan 05에서 RedisHealthIndicator가 /health에 추가됨. 실제 Valkey ping 응답 및 VPC Direct Egress 네트워킹은 배포 후에만 검증 가능

#### 5. Socket.IO Redis adapter 다중 인스턴스 pub/sub 전파 (Plan 04 옵션 적용 후)

**Test:** Cloud Run 2개 인스턴스에서 좌석 잠금 이벤트 전파 확인
**Expected:** 인스턴스 A에서 lockSeat → 인스턴스 B에 연결된 클라이언트가 seat-update 이벤트 수신.
```

**Rollback pattern** (`14-HUMAN-UAT.md` lines 88-90):
```markdown
**Rollback 기준:**
- SC-1 실패 (...) → 즉시 이전 revision 으로 롤백 (`gcloud run services update-traffic grabit-api --to-revisions=<previous>=100`)
- D-17 중 (...) CROSSSLOT 1건 이상 발생 → 원인 조사 후 롤백 여부 결정
```

**Apply:** require fields for command, timestamp, Cloud Run service/revision, target URL, sanitized output, PASS/FAIL, scale pre-state/restore, idle interval, and log/Sentry keyword results.

---

### `.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md` (test artifact, verification report)

**Analogs:** `14-VERIFICATION.md`, `17-VERIFICATION.md`

**Verification frontmatter pattern** (`17-VERIFICATION.md` lines 1-8):
```markdown
---
phase: 17-local-dev-health-indicator-fix-inmemoryredis-ping-capability
status: passed
verified: 2026-04-28
plans_verified: [17-01, 17-02]
gaps_found: 0
human_needed: false
---
```

**Observable truths table pattern** (`14-VERIFICATION.md` lines 30-44):
```markdown
### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 5 | apps/api/test/sms-cluster-crossslot.integration.spec.ts 가 5 시나리오(...)를 포함한 311줄 파일로 존재함 (SC-2) | VERIFIED | 파일 존재 311줄, CROSSSLOT negative guard (L174), ADDSLOTSRANGE, buildNatMap, ... |
```

**Automated checks pattern** (`17-VERIFICATION.md` lines 51-78):
~~~markdown
## Automated Checks

```bash
pnpm --filter @grabit/api exec vitest run \
  src/modules/booking/providers/__tests__/redis.provider.spec.ts \
  src/health/__tests__/redis.health.indicator.spec.ts \
  --reporter=verbose
```

Result: 15/15 passed.
~~~

**Apply:** split code-level verification from production smoke. Mark `human_needed` until `20-HUMAN-UAT.md` has real revision-scoped evidence.

---

### `apps/api/package.json` (config, dependency/config)

**Analog:** same file

**Script/dependency pattern** (lines 5-14, 16-39, 55-79):
```json
{
  "scripts": {
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  },
  "dependencies": {
    "@socket.io/redis-adapter": "^8.3.0",
    "ioredis": "^5.10.1",
    "socket.io": "^4.8.3"
  },
  "devDependencies": {
    "testcontainers": "^11.14.0",
    "vitest": "^3.2.0"
  }
}
```

**Apply:** only add `socket.io-client` to `apps/api` if a Phase 20 API-owned Node smoke imports it directly. The package already exists in `apps/web/package.json`; planner may choose a run command that uses the web package instead to avoid dependency churn.

## Shared Patterns

### Production Fail Closed

**Source:** `apps/api/src/modules/booking/providers/redis.provider.ts` lines 494-504 and `apps/api/src/main.ts` lines 28-43  
**Apply to:** `redis.provider.ts`, `main.ts`, deploy contract

```typescript
if (process.env['NODE_ENV'] === 'production') {
  throw new Error(
    '[redis] REDIS_URL is required in production environment. ' +
      'Silent InMemoryRedis fallback is disabled ...',
  );
}
```

Use the same fail-closed behavior for missing/invalid production Valkey mode and production Socket.IO adapter failure.

### Redis Cluster Hash Tags

**Source:** `apps/api/src/modules/booking/booking.service.ts` lines 28-38, 251-267  
**Apply to:** booking Lua integration tests and production smoke

```typescript
const userSeatsKey = `{${showtimeId}}:user-seats:${userId}`;
const lockKey = `{${showtimeId}}:seat:${seatId}`;
const lockedSeatsKey = `{${showtimeId}}:locked-seats`;
const keyPrefix = `{${showtimeId}}:seat:`;
```

Every multi-key Lua path must pass all accessed keys via `KEYS` and share the same `{showtimeId}` hash tag.

### Terminus Health

**Source:** `apps/api/src/health/redis.health.indicator.ts` lines 29-47 and `health.controller.ts` lines 13-19  
**Apply to:** health metadata and smoke `/api/v1/health`

```typescript
return this.health.check([
  () => this.redisIndicator.isHealthy('redis'),
]);
```

Keep the public endpoint stable; add sanitized metadata inside the indicator result.

### Socket.IO Redis Adapter

**Source:** `apps/api/src/modules/booking/providers/redis-io.adapter.ts` lines 88-94  
**Apply to:** adapter production visibility and two-instance smoke

```typescript
const subClient = pubClient.duplicate({
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
this.adapterConstructor = createAdapter(pubClient, subClient);
return true;
```

Production must not silently run without this adapter when Redis is configured.

### Cluster Integration Tests

**Source:** `apps/api/test/sms-cluster-crossslot.integration.spec.ts` lines 76-144  
**Apply to:** `apps/api/test/booking-cluster-lua.integration.spec.ts`

Use `valkey/valkey:8`, `--cluster-enabled yes`, `CLUSTER ADDSLOTSRANGE 0 16383`, dynamic `natMap`, and `new IORedis.Cluster([{ host, port }], ...)`.

### Evidence Redaction

**Source:** `18-HUMAN-UAT.md` lines 188-203 and `20-CONTEXT.md` D-09  
**Apply to:** `scripts/smoke-valkey-production.mjs`, `20-HUMAN-UAT.md`, `20-VERIFICATION.md`

Forbidden in artifacts: full `REDIS_URL`, auth headers, cookies, JWTs, phone numbers, payment data, reset tokens, private customer data, raw credentials. Allowed: command shape, timestamp, revision, image digest/Git SHA, HTTP status, PASS/FAIL, redacted event ID.

### Cloud Run Deployment Contract

**Source:** `.github/workflows/deploy.yml` lines 115-148  
**Apply to:** deploy mode contract and smoke evidence

```yaml
--network=default
--subnet=default
--vpc-egress=private-ranges-only
...
REDIS_URL=redis-url:latest
```

Add explicit `VALKEY_MODE=cluster` in `env_vars`; keep `REDIS_URL` as Secret Manager binding.

## No Single Analog Found

| File | Role | Data Flow | Reason | Partial Sources |
|------|------|-----------|--------|-----------------|
| `scripts/smoke-valkey-production.mjs` | utility | request-response, event-driven, file-I/O | No existing production Node smoke harness combines HTTP, Socket.IO, gcloud evidence, and artifact writing. | `seed.mjs` for Node fail-fast/cleanup, `socket-client.ts` for Socket.IO options, `booking.controller.ts` for HTTP paths, `18-HUMAN-UAT.md` for artifact shape |

## Metadata

**Analog search scope:** `apps/api/src`, `apps/api/test`, `apps/web/lib`, `apps/web/hooks`, `.github/workflows`, `scripts`, prior phase artifacts 07/13/14/17/18  
**Files scanned:** 150+ via `rg --files`; 24 files read for concrete excerpts  
**Pattern extraction date:** 2026-04-30  
