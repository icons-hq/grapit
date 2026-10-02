import {
  describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance,
} from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Test } from '@nestjs/testing';
import { type INestApplication, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { APP_GUARD } from '@nestjs/core';
import IORedis from 'ioredis';
import request from 'supertest';
import { SmsController } from '../src/modules/sms/sms.controller.js';
import {
  SmsService,
  VERIFY_AND_INCREMENT_LUA,
  smsAttemptsKey,
  smsGlobalSendCounterKey,
  smsOtpKey,
  smsResendKey,
  smsSendCounterKey,
  smsVerificationTokenClaimKey,
  smsVerifiedKey,
} from '../src/modules/sms/sms.service.js';
import {
  TwilioVerifyApiError,
  TwilioVerifyClient,
} from '../src/modules/sms/twilio-verify-client.js';

/**
 * SMS abuse limits against the REAL SmsController + SmsService -- testcontainers Valkey
 *
 * Audit #36: this file used to exercise a stand-in controller carrying
 * @Throttle decorators that production never had, so it passed while the real
 * /sms routes had no app-level limit at all. The production routes skip the
 * IP throttler on purpose (260517 shared-IP hotfix); the limits that must hold
 * are the IP-independent ones inside SmsService, checked here against real
 * Valkey TTL/INCR/SET NX semantics. Only the Twilio HTTP calls are stubbed.
 *
 * 실행: pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts test/sms-throttle.integration.spec.ts
 * Docker가 필수입니다.
 */

const GLOBAL_SEND_LIMIT_PER_MINUTE = 10;
// Lower than the number of distinct-phone sends below, to prove the shared
// client IP is not what limits these routes.
const DEFAULT_IP_THROTTLE_LIMIT = 3;

function phoneAt(index: number): string {
  return `+8210${String(55550000 + index)}`;
}

async function waitForFreshMinuteWindow(minRemainingMs = 8_000): Promise<number> {
  const remaining = 60_000 - (Date.now() % 60_000);
  if (remaining < minRemainingMs) {
    await new Promise((resolve) => setTimeout(resolve, remaining + 50));
  }
  return Math.floor(Date.now() / 60_000);
}

describe('SMS app-side limits (real SmsController + SmsService + Valkey)', () => {
  let container: StartedTestContainer;
  let app: INestApplication;
  let redis: IORedis;
  let smsService: SmsService;
  let sendSpy: MockInstance<TwilioVerifyClient['sendVerification']>;
  let checkSpy: MockInstance<TwilioVerifyClient['checkVerification']>;

  beforeAll(async () => {
    container = await new GenericContainer('valkey/valkey:8')
      .withExposedPorts(6379)
      .start();

    redis = new IORedis(
      `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
      { maxRetriesPerRequest: 3 },
    );

    // Production wiring: the real service built from env-shaped config and the
    // real Valkey client. Vitest does not emit decorator metadata, so the
    // controller's constructor type is declared explicitly (same pattern as
    // the other integration specs).
    smsService = new SmsService(
      new ConfigService({
        TWILIO_ACCOUNT_SID: 'AC_integration',
        TWILIO_API_KEY_SID: 'SK_integration',
        TWILIO_API_KEY_SECRET: 'integration-secret',
        TWILIO_VERIFY_SERVICE_SID: 'VA_integration',
        SMS_VERIFICATION_TOKEN_SECRET: 'integration-token-secret',
        SMS_GLOBAL_SEND_LIMIT_PER_MINUTE: String(GLOBAL_SEND_LIMIT_PER_MINUTE),
      }),
      redis,
    );
    Reflect.defineMetadata('design:paramtypes', [SmsService], SmsController);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: DEFAULT_IP_THROTTLE_LIMIT }],
          storage: new ThrottlerStorageRedisService(redis),
        }),
      ],
      controllers: [SmsController],
      providers: [
        { provide: SmsService, useValue: smsService },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Keep one server open across requests; per-request listen/close races with keep-alive.
    await app.listen(0, '127.0.0.1');
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await redis?.quit();
    await container?.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
    vi.restoreAllMocks();
    sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
      .mockResolvedValue({ sid: 'VE_integration', status: 'pending', channel: 'sms' });
    checkSpy = vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
      .mockResolvedValue({ sid: 'VE_integration', status: 'pending', valid: false });
  });

  describe('send-code', () => {
    it('같은 번호의 30초 cooldown 안 재발송은 429이고 Valkey TTL이 실제로 설정된다', async () => {
      const server = app.getHttpServer();
      const phone = phoneAt(1);

      await request(server).post('/sms/send-code').send({ phone }).expect(HttpStatus.OK);
      const second = await request(server).post('/sms/send-code').send({ phone });

      expect(second.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const cooldownTtl = await redis.pttl(smsResendKey(phone));
      expect(cooldownTtl).toBeGreaterThan(25_000);
      expect(cooldownTtl).toBeLessThanOrEqual(30_000);
      const counterTtl = await redis.ttl(smsSendCounterKey(phone));
      expect(counterTtl).toBeGreaterThan(3_500);
      expect(counterTtl).toBeLessThanOrEqual(3_600);
      expect(await redis.get(smsSendCounterKey(phone))).toBe('1');
    });

    it('cooldown이 지나도 같은 번호는 시간당 5회를 넘겨 발송할 수 없다', async () => {
      const server = app.getHttpServer();
      const phone = phoneAt(2);

      for (let i = 0; i < 5; i++) {
        await request(server).post('/sms/send-code').send({ phone }).expect(HttpStatus.OK);
        await redis.del(smsResendKey(phone)); // simulate the 30s cooldown elapsing
      }
      const sixth = await request(server).post('/sms/send-code').send({ phone });

      expect(sixth.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(sendSpy).toHaveBeenCalledTimes(5);
    });

    it('번호를 돌리는 대량 발송은 공유 IP throttle이 아니라 분당 global send budget에서 멈춘다', async () => {
      const server = app.getHttpServer();
      const windowIndex = await waitForFreshMinuteWindow();
      const remainingBudget = 5;
      await redis.set(
        smsGlobalSendCounterKey(windowIndex),
        String(GLOBAL_SEND_LIMIT_PER_MINUTE - remainingBudget),
        'EX',
        120,
      );

      for (let i = 0; i < remainingBudget; i++) {
        await request(server)
          .post('/sms/send-code')
          .send({ phone: phoneAt(100 + i) })
          .expect(HttpStatus.OK);
      }
      const rejectedPhone = phoneAt(200);
      const rejected = await request(server).post('/sms/send-code').send({ phone: rejectedPhone });

      expect(remainingBudget).toBeGreaterThan(DEFAULT_IP_THROTTLE_LIMIT);
      expect(rejected.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(rejected.body.message).toBe('인증번호 요청이 많아 잠시 후 다시 시도해주세요.');
      expect(sendSpy).toHaveBeenCalledTimes(remainingBudget);
      // The rejected buyer keeps no per-phone cooldown or hourly slot.
      expect(await redis.exists(smsResendKey(rejectedPhone))).toBe(0);
      expect(await redis.get(smsSendCounterKey(rejectedPhone))).toBe('0');
      const globalTtl = await redis.ttl(smsGlobalSendCounterKey(windowIndex));
      expect(globalTtl).toBeGreaterThan(0);
      expect(globalTtl).toBeLessThanOrEqual(120);
    });

    it('공급자 일시 장애로 보내지 못한 요청은 cooldown·시간당 한도·global budget을 되돌린다', async () => {
      const server = app.getHttpServer();
      const windowIndex = await waitForFreshMinuteWindow();
      const phone = phoneAt(3);
      sendSpy.mockRejectedValueOnce(new TwilioVerifyApiError(503, 20503, 'Service Unavailable'));

      const failed = await request(server).post('/sms/send-code').send({ phone });

      expect(failed.status).toBe(HttpStatus.BAD_REQUEST);
      expect(await redis.exists(smsResendKey(phone))).toBe(0);
      expect(await redis.get(smsSendCounterKey(phone))).toBe('0');
      expect(await redis.get(smsGlobalSendCounterKey(windowIndex))).toBe('0');
      await request(server).post('/sms/send-code').send({ phone }).expect(HttpStatus.OK);
    });
  });

  describe('verify-code', () => {
    it('같은 번호의 15분 10회를 넘는 확인 시도는 Twilio 호출 전에 429로 막힌다', async () => {
      const server = app.getHttpServer();
      const phone = phoneAt(4);

      for (let i = 0; i < 10; i++) {
        const res = await request(server)
          .post('/sms/verify-code')
          .send({ phone, code: '123456' })
          .expect(HttpStatus.OK);
        expect(res.body.verified).toBe(false);
      }
      const eleventh = await request(server)
        .post('/sms/verify-code')
        .send({ phone, code: '123456' });

      expect(eleventh.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(checkSpy).toHaveBeenCalledTimes(10);
    });
  });

  describe('phone verification token (audit #103)', () => {
    it('발급된 토큰은 한 번만 claim되고, release하면 같은 토큰으로 재시도할 수 있다', async () => {
      const server = app.getHttpServer();
      const phone = phoneAt(5);
      checkSpy.mockResolvedValueOnce({ sid: 'VE_ok', status: 'approved', valid: true });

      const verified = await request(server)
        .post('/sms/verify-code')
        .send({ phone, code: '123456', purpose: 'signup' })
        .expect(HttpStatus.OK);
      const token = verified.body.verificationToken as string;
      const nonce = (JSON.parse(
        Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8'),
      ) as { nonce: string }).nonce;

      const claims = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          smsService.claimPhoneVerificationToken(token, { phone, purpose: 'signup' })),
      );
      const fulfilled = claims.filter(
        (claim): claim is PromiseFulfilledResult<Awaited<ReturnType<SmsService['claimPhoneVerificationToken']>>> =>
          claim.status === 'fulfilled',
      );
      expect(fulfilled).toHaveLength(1);

      const claimTtl = await redis.pttl(smsVerificationTokenClaimKey(phone, nonce));
      expect(claimTtl).toBeGreaterThan(600_000);
      expect(claimTtl).toBeLessThanOrEqual(660_000);

      await fulfilled[0]!.value.release();
      await expect(
        smsService.claimPhoneVerificationToken(token, { phone, purpose: 'signup' }),
      ).resolves.toBeDefined();
      await expect(
        smsService.claimPhoneVerificationToken(token, { phone, purpose: 'signup' }),
      ).rejects.toThrow('이미 사용된 전화번호 인증입니다');
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
