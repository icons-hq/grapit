import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Test } from '@nestjs/testing';
import { type INestApplication, HttpStatus } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { APP_GUARD } from '@nestjs/core';
import IORedis from 'ioredis';
import request from 'supertest';
import {
  VERIFY_AND_INCREMENT_LUA,
  smsOtpKey,
  smsAttemptsKey,
  smsVerifiedKey,
} from '../src/modules/sms/sms.service.js';

// Phase 10.1: Twilio Verify env(TWILIO_ACCOUNT_SID, API key pair, TWILIO_VERIFY_SERVICE_SID) 체계.
// 레거시 APPLICATION_ID/MESSAGE_ID env는 v3 API 전환으로 제거됨.

/**
 * SMS Throttle Integration Test -- testcontainers Valkey
 *
 * 실제 Valkey 컨테이너를 구동하여 @nestjs/throttler + ThrottlerStorageRedisService가
 * Valkey에서 정확하게 rate limiting을 수행하는지 검증합니다.
 *
 * 실행: pnpm --filter @grabit/api test:integration sms-throttle -- --run
 * Docker가 필수입니다.
 */

// --- Minimal SmsController for isolated throttle testing ---
import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

@Controller('sms')
class TestSmsController {
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Post('send-code')
  sendCode(@Body() body: { phone: string }) {
    return { success: true, message: 'mock', phone: body.phone };
  }

  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Post('verify-code')
  verifyCode(@Body() body: { phone: string; code: string }) {
    return { verified: true, phone: body.phone };
  }
}

@Controller('auth')
class TestAuthController {
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  @Post('password-reset/request')
  passwordResetRequest(@Body() body: { email: string }) {
    return { message: 'ok', email: body.email };
  }
}

describe('SMS Throttle Integration (testcontainers + Valkey)', () => {
  let container: StartedTestContainer;
  let app: INestApplication;
  let redis: IORedis;

  beforeAll(async () => {
    // Start Valkey container
    container = await new GenericContainer('valkey/valkey:8')
      .withExposedPorts(6379)
      .start();

    const host = container.getHost();
    const port = container.getMappedPort(6379);
    const redisUrl = `redis://${host}:${port}`;

    // Create a standalone ioredis client for TTL verification
    redis = new IORedis(redisUrl, { maxRetriesPerRequest: 3 });

    // Build NestJS TestingModule with real Valkey-backed throttler
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }],
          storage: new ThrottlerStorageRedisService(redis),
        }),
      ],
      controllers: [TestSmsController, TestAuthController],
      providers: [
        {
          provide: APP_GUARD,
          useClass: ThrottlerGuard,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await redis?.quit();
    await container?.stop();
  });

  describe('send-code rate limiting', () => {
    it('IP axis: 20/3600s -- 21번째 요청에서 429', async () => {
      // Flush keys to isolate test
      await redis.flushall();

      const server = app.getHttpServer();

      // 20 requests should succeed
      for (let i = 0; i < 20; i++) {
        const res = await request(server)
          .post('/sms/send-code')
          .send({ phone: `+8201000000${String(i).padStart(2, '0')}` })
          .expect(HttpStatus.OK);
        expect(res.body.success).toBe(true);
      }

      // 21st request should be throttled (429)
      const throttled = await request(server)
        .post('/sms/send-code')
        .send({ phone: '+82010000099' });
      expect(throttled.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('phone axis: 동일 phone + 서로 다른 IP axis는 @Throttle default로 동일 IP에서 test', async () => {
      // This test validates that the IP-based default throttle is enforced
      // Phone-axis throttling (5/3600s) is done in SmsService via Lua script,
      // not through @nestjs/throttler. The throttler handles IP-axis only.
      // The SmsService Lua counter is tested in sms.service.spec.ts unit tests.
      await redis.flushall();

      const server = app.getHttpServer();

      // Send 20 requests with same phone (IP axis throttle applies)
      for (let i = 0; i < 20; i++) {
        await request(server)
          .post('/sms/send-code')
          .send({ phone: '+82010012345678' })
          .expect(HttpStatus.OK);
      }

      // 21st request exceeds IP axis limit
      const res = await request(server)
        .post('/sms/send-code')
        .send({ phone: '+82010012345678' });
      expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });
  });

  describe('verify-code rate limiting', () => {
    it('IP axis: 10/900s -- 11번째 요청에서 429', async () => {
      await redis.flushall();

      const server = app.getHttpServer();

      // 10 requests should succeed
      for (let i = 0; i < 10; i++) {
        await request(server)
          .post('/sms/verify-code')
          .send({ phone: `+8201000000${String(i).padStart(2, '0')}`, code: '123456' })
          .expect(HttpStatus.OK);
      }

      // 11th request should be throttled
      const res = await request(server)
        .post('/sms/verify-code')
        .send({ phone: '+82010000099', code: '123456' });
      expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('같은 phone으로 반복 verify -- IP axis limit 적용', async () => {
      await redis.flushall();

      const server = app.getHttpServer();

      for (let i = 0; i < 10; i++) {
        await request(server)
          .post('/sms/verify-code')
          .send({ phone: '+82010012345678', code: '000000' })
          .expect(HttpStatus.OK);
      }

      const res = await request(server)
        .post('/sms/verify-code')
        .send({ phone: '+82010012345678', code: '000000' });
      expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });
  });

  describe('password-reset rate limiting (D-09)', () => {
    it('3/900s -- 4번째 요청에서 429', async () => {
      await redis.flushall();

      const server = app.getHttpServer();

      // 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        await request(server)
          .post('/auth/password-reset/request')
          .send({ email: `user${i}@test.com` })
          .expect(HttpStatus.OK);
      }

      // 4th request should be throttled
      const res = await request(server)
        .post('/auth/password-reset/request')
        .send({ email: 'blocked@test.com' });
      expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });
  });

  // [Review #6 TTL ms 검증]
  describe('TTL 단위 검증', () => {
    it('send-code Throttler가 1h=3600000ms TTL을 Valkey에 설정하는지 확인', async () => {
      await redis.flushall();

      const server = app.getHttpServer();

      // Make one request to create throttler key
      await request(server)
        .post('/sms/send-code')
        .send({ phone: '+82010099998888' })
        .expect(HttpStatus.OK);

      // Find throttler hit keys in Valkey.
      // @nest-lab/throttler-storage-redis stores keys as `{<tracker>:<throttlerName>}:hits`
      // (and `:blocked`) — no "throttler" substring in the key itself.
      const keys = await redis.keys('*');
      const throttlerKeys = keys.filter((k) => k.endsWith(':hits'));

      // At least one throttler key should exist
      expect(throttlerKeys.length).toBeGreaterThan(0);

      // Check PTTL of any throttler key -- should be <= 3_600_000ms (1h)
      // The send-code endpoint has ttl: 3_600_000
      for (const key of throttlerKeys) {
        const pttl = await redis.pttl(key);
        // PTTL should be positive and <= 3_600_000ms
        expect(pttl).toBeGreaterThan(0);
        expect(pttl).toBeLessThanOrEqual(3_600_000);
        // Should be close to 3_600_000ms (within first second of creation)
        expect(pttl).toBeGreaterThan(3_599_000);
      }
    });

    it('verify-code Throttler가 15min=900000ms TTL을 Valkey에 설정하는지 확인', async () => {
      await redis.flushall();

      const server = app.getHttpServer();

      await request(server)
        .post('/sms/verify-code')
        .send({ phone: '+82010088887777', code: '123456' })
        .expect(HttpStatus.OK);

      const keys = await redis.keys('*');
      const throttlerKeys = keys.filter((k) => k.endsWith(':hits'));

      expect(throttlerKeys.length).toBeGreaterThan(0);

      for (const key of throttlerKeys) {
        const pttl = await redis.pttl(key);
        expect(pttl).toBeGreaterThan(0);
        expect(pttl).toBeLessThanOrEqual(900_000);
        expect(pttl).toBeGreaterThan(899_000);
      }
    });
  });
});

/**
 * VERIFY_AND_INCREMENT_LUA atomic script smoke tests -- testcontainers Valkey
 *
 * Phase 10.1 신규 Lua script가 실제 Valkey Lua 5.1 interpreter에서
 * 4분기 결과(VERIFIED/WRONG/EXPIRED/NO_MORE_ATTEMPTS)를 올바르게 반환하는지 검증합니다.
 *
 * sms.service.ts의 VERIFY_AND_INCREMENT_LUA와 동일한 스크립트를 사용합니다.
 */
describe('VERIFY_AND_INCREMENT_LUA atomic script (Valkey EVAL)', () => {
  let container: StartedTestContainer;
  let redis: IORedis;

  // D-13 SoT: Lua body + key builders are imported from sms.service.ts (top of file).
  // No local duplicate here -- any future key-scheme change propagates automatically.

  const keys = (phone: string) => [
    smsOtpKey(phone),
    smsAttemptsKey(phone),
    smsVerifiedKey(phone),
  ];

  beforeAll(async () => {
    container = await new GenericContainer('valkey/valkey:8')
      .withExposedPorts(6379)
      .start();

    const host = container.getHost();
    const port = container.getMappedPort(6379);
    redis = new IORedis(`redis://${host}:${port}`, { maxRetriesPerRequest: 3 });
  }, 120_000);

  afterAll(async () => {
    await redis?.quit();
    await container?.stop();
  });

  beforeEach(async () => {
    await redis.del(...keys('+821099990001'));
  });

  it('정답 코드 → VERIFIED, verified 플래그 저장, otp/attempts DEL', async () => {
    const phone = '+821099990001';
    await redis.set(smsOtpKey(phone), '123456', 'PX', 180_000);

    const result = await redis.eval(
      VERIFY_AND_INCREMENT_LUA, 3,
      ...keys(phone), '123456', '5', '600',
    );
    expect(result).toEqual(['VERIFIED', 1]);
    expect(await redis.get(smsOtpKey(phone))).toBeNull();
    expect(await redis.get(smsAttemptsKey(phone))).toBeNull();
    expect(await redis.get(smsVerifiedKey(phone))).toBe('1');
  });

  it('오답 코드 → WRONG, attempts INCR만', async () => {
    const phone = '+821099990001';
    await redis.set(smsOtpKey(phone), '123456', 'PX', 180_000);

    const result = await redis.eval(
      VERIFY_AND_INCREMENT_LUA, 3,
      ...keys(phone), '999999', '5', '600',
    );
    expect(result).toEqual(['WRONG', 4]);
    expect(await redis.get(smsOtpKey(phone))).toBe('123456');
    expect(await redis.get(smsAttemptsKey(phone))).toBe('1');
  });

  it('otp 없음 → EXPIRED', async () => {
    const phone = '+821099990001';
    // otp 미저장
    const result = await redis.eval(
      VERIFY_AND_INCREMENT_LUA, 3,
      ...keys(phone), '123456', '5', '600',
    );
    expect(result).toEqual(['EXPIRED', 0]);
  });

  it('attempts 5회 초과 시 NO_MORE_ATTEMPTS + otp/attempts DEL', async () => {
    const phone = '+821099990001';
    await redis.set(smsOtpKey(phone), '123456', 'PX', 180_000);

    // 먼저 4번 틀리게 호출 (attempts=4)
    for (let i = 0; i < 4; i++) {
      await redis.eval(
        VERIFY_AND_INCREMENT_LUA, 3,
        ...keys(phone), '999999', '5', '600',
      );
    }
    // 5번째 틀리기 — attempts=5, max=5, 조건 attempts > max 불충족 → WRONG(0)
    const r5 = await redis.eval(
      VERIFY_AND_INCREMENT_LUA, 3,
      ...keys(phone), '999999', '5', '600',
    );
    expect(r5).toEqual(['WRONG', 0]);

    // 6번째 → attempts=6 > max=5 → NO_MORE_ATTEMPTS
    const r6 = await redis.eval(
      VERIFY_AND_INCREMENT_LUA, 3,
      ...keys(phone), '999999', '5', '600',
    );
    expect(r6).toEqual(['NO_MORE_ATTEMPTS', 0]);
    expect(await redis.get(smsOtpKey(phone))).toBeNull();
    expect(await redis.get(smsAttemptsKey(phone))).toBeNull();
  });

  it('attempts EXPIRE 900s 설정 확인', async () => {
    const phone = '+821099990001';
    await redis.set(smsOtpKey(phone), '123456', 'PX', 180_000);

    await redis.eval(
      VERIFY_AND_INCREMENT_LUA, 3,
      ...keys(phone), '999999', '5', '600',
    );
    const ttl = await redis.ttl(smsAttemptsKey(phone));
    expect(ttl).toBeGreaterThan(800);
    expect(ttl).toBeLessThanOrEqual(900);
  });

  it('verified 플래그 TTL 600s 설정 확인', async () => {
    const phone = '+821099990001';
    await redis.set(smsOtpKey(phone), '123456', 'PX', 180_000);

    await redis.eval(
      VERIFY_AND_INCREMENT_LUA, 3,
      ...keys(phone), '123456', '5', '600',
    );
    const ttl = await redis.ttl(smsVerifiedKey(phone));
    expect(ttl).toBeGreaterThan(550);
    expect(ttl).toBeLessThanOrEqual(600);
  });
});
