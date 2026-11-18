import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import IORedis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SmsController } from '../src/modules/sms/sms.controller.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import {
  SensOtpStore, sensOtpKeys, SENS_OTP_TTL_MS,
} from '../src/modules/sms/sens-otp-store.js';
import { NaverSensApiError, NaverSensClient } from '../src/modules/sms/naver-sens-client.js';
import { TwilioVerifyClient } from '../src/modules/sms/twilio-verify-client.js';
import {
  SmsService, smsGlobalSendCounterKey, smsPendingVerificationKey, smsResendKey, smsSendCounterKey,
} from '../src/modules/sms/sms.service.js';

// Dedicated disposable container only. All provider transports are intercepted;
// this suite cannot send SMS, even if a real credential exists in the host env.
const PHONE = '+8613912345678';
const OTHER_PHONE = '+821012345678';
const SECRET = 'integration-sens-token-secret';
const keys = sensOtpKeys(PHONE);
function config(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = {
    TWILIO_ACCOUNT_SID: 'AC_test', TWILIO_API_KEY_SID: 'SK_test',
    TWILIO_API_KEY_SECRET: 'twilio-test-secret', TWILIO_VERIFY_SERVICE_SID: 'VA_test',
    JWT_SECRET: SECRET, SMS_CN_PROVIDER: 'sens', NCP_SENS_ACCESS_KEY: 'test-access',
    NCP_SENS_SECRET_KEY: 'test-secret', NCP_SENS_SMS_SERVICE_ID: 'ncp:sms:kr:123:test',
    NCP_SENS_SMS_FROM: '0212345678', NCP_SENS_SMS_COMPANY_NAME: 'ICONS',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as ConfigService;
}
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('China SENS OTP with real Valkey Cluster state', () => {
  let container: StartedTestContainer;
  let redis: IORedis;
  let store: SensOtpStore;

  beforeAll(async () => {
    container = await new GenericContainer('valkey/valkey:8')
      .withExposedPorts(6379)
      .withCommand(['valkey-server', '--port', '6379', '--cluster-enabled', 'yes',
        '--cluster-config-file', 'nodes.conf', '--cluster-require-full-coverage', 'no',
        '--appendonly', 'no'])
      .start();
    redis = new IORedis({ host: container.getHost(), port: container.getMappedPort(6379),
      maxRetriesPerRequest: 1 });
    await redis.call('CLUSTER', 'ADDSLOTSRANGE', '0', '16383');
    for (let i = 0; i < 40; i++) {
      if (String(await redis.call('CLUSTER', 'INFO')).includes('cluster_state:ok')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(String(await redis.call('CLUSTER', 'INFO'))).toContain('cluster_state:ok');
  });

  beforeEach(async () => {
    await redis.flushdb();
    store = new SensOtpStore(redis, SECRET);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('External HTTP is forbidden in this test')));
    for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(Logger.prototype, method).mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  afterAll(async () => { await redis?.quit(); await container?.stop(); });

  it('stores HMAC state with a ten-minute TTL and keeps every atomic key in one cluster slot', async () => {
    const prepared = await store.prepare(PHONE);
    expect(prepared.code).toMatch(/^\d{6}$/);
    expect(JSON.parse((await redis.get(keys.candidate))!)).toEqual({
      v: 1, nonce: prepared.nonce, digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await redis.pttl(keys.candidate)).toBeGreaterThan(SENS_OTP_TTL_MS - 2000);
    const slots = await Promise.all(Object.values(keys).map(key => redis.call('CLUSTER', 'KEYSLOT', key)));
    expect(new Set(slots).size).toBe(1);
    await store.commit(PHONE, prepared);
    await store.finish(PHONE, prepared, false);
    expect(await redis.get(keys.active)).toBe(prepared.record);
    expect(await redis.exists(keys.candidate, keys.lease)).toBe(0);
    expect(await store.verify(PHONE, wrongCode(prepared.code))).toBe('wrong');
    expect(await store.verify(PHONE, prepared.code)).toBe('verified');
    expect(await store.verify(PHONE, prepared.code)).toBeNull();
    expect(await redis.get(keys.verified)).toBe('1');
  });

  it('allows only one concurrent successful check and a late commit cannot restore the consumed code', async () => {
    const prepared = await store.prepare(PHONE);
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => store.verify(PHONE, prepared.code)));
    expect(outcomes.filter(value => value === 'verified')).toHaveLength(1);
    await store.commit(PHONE, prepared);
    await store.finish(PHONE, prepared, false);
    expect(await redis.exists(keys.active, keys.candidate)).toBe(0);
  });

  it('preserves the last accepted code when a resend is explicitly rejected', async () => {
    const original = await store.prepare(PHONE);
    await store.commit(PHONE, original);
    await store.finish(PHONE, original, false);
    const resend = await store.prepare(PHONE);
    await store.finish(PHONE, resend, true);
    expect(await redis.get(keys.active)).toBe(original.record);
    expect(await redis.get(keys.candidate)).toBeNull();
    expect(await store.verify(PHONE, original.code)).toBe('verified');
  });

  it('keeps an unacknowledged code verifiable and blocks another potentially billable send', async () => {
    const prepared = await store.prepare(PHONE);
    await store.finish(PHONE, prepared, false);
    await expect(store.prepare(PHONE)).rejects.toMatchObject({ reason: 'pending' });
    expect(await store.verify(PHONE, prepared.code)).toBe('verified');
  });

  it('serializes sends even when local phone throttles are disabled', async () => {
    const attempts = await Promise.allSettled([store.prepare(PHONE), store.prepare(PHONE)]);
    expect(attempts.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(value => value.status === 'rejected')).toMatchObject({ reason: { reason: 'sending' } });
  });

  it('does not reset the ten-check budget by resending and never disables it with the incident switch', async () => {
    const service = new SmsService(config({ SMS_LOCAL_RATE_LIMITS_ENABLED: 'false' }), redis);
    const sent = vi.spyOn(NaverSensClient.prototype, 'sendCode').mockResolvedValue({ requestId: 'RSLG-test' });
    await service.sendVerificationCode(PHONE);
    const code = sent.mock.calls[0][1];
    for (let i = 0; i < 5; i++) expect((await service.verifyCode(PHONE, wrongCode(code))).verified).toBe(false);
    await service.sendVerificationCode(PHONE);
    const secondCode = sent.mock.calls[1][1];
    for (let i = 0; i < 5; i++) expect((await service.verifyCode(PHONE, wrongCode(secondCode))).verified).toBe(false);
    await expect(service.verifyCode(PHONE, secondCode)).rejects.toMatchObject({ status: 429 });
    await expect(service.sendVerificationCode(PHONE)).rejects.toMatchObject({ status: 429 });
    expect(sent).toHaveBeenCalledTimes(2);
    expect(await redis.pttl(keys.checks)).toBeGreaterThan(890_000);
  });

  it('does not accept an expired or malformed challenge', async () => {
    const prepared = await store.prepare(PHONE);
    await redis.pexpire(keys.candidate, 1);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(await store.verify(PHONE, prepared.code)).toBeNull();
    await redis.set(keys.active, '{}');
    await expect(store.verify(PHONE, prepared.code)).rejects.toThrow(/Invalid SENS OTP state/);
  });

  it('waits for Twilio codes across cutover and verifies SENS codes after a config rollback', async () => {
    const twilio = new SmsService(config({ SMS_CN_PROVIDER: 'twilio' }), redis);
    const sens = new SmsService(config(), redis);
    const twilioSend = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
      .mockResolvedValue({ sid: 'VE-test', status: 'pending', channel: 'sms' });
    const twilioCheck = vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
      .mockResolvedValue({ sid: 'VE-test', status: 'approved', valid: true });
    const sensSend = vi.spyOn(NaverSensClient.prototype, 'sendCode').mockResolvedValue({ requestId: 'RSLG-test' });
    await twilio.sendVerificationCode(PHONE);
    await redis.del(smsResendKey(PHONE));
    await expect(sens.sendVerificationCode(PHONE)).rejects.toMatchObject({ status: 429 });
    expect(sensSend).not.toHaveBeenCalled();
    expect((await sens.verifyCode(PHONE, '123456')).verified).toBe(true);
    expect(twilioCheck).toHaveBeenCalledOnce();

    await sens.sendVerificationCode(PHONE);
    await redis.del(smsResendKey(PHONE));
    await expect(twilio.sendVerificationCode(PHONE)).rejects.toMatchObject({ status: 429 });
    expect(twilioSend).toHaveBeenCalledOnce();
    const result = await twilio.verifyCode(PHONE, sensSend.mock.calls[0][1]);
    expect(result.verified).toBe(true);
    expect(twilioCheck).toHaveBeenCalledOnce();
    // The same existing purpose-bound token contract protects signup writes.
    await expect(twilio.claimPhoneVerificationToken(result.verificationToken!, { phone: PHONE, purpose: 'profile_phone_change' }))
      .rejects.toThrow();
    const claim = await twilio.claimPhoneVerificationToken(result.verificationToken!, { phone: PHONE, purpose: 'signup' });
    await expect(twilio.claimPhoneVerificationToken(result.verificationToken!, { phone: PHONE, purpose: 'signup' })).rejects.toThrow();
    await claim.release();
    await expect(twilio.claimPhoneVerificationToken(result.verificationToken!, { phone: PHONE, purpose: 'signup' })).resolves.toBeDefined();
  });

  it('routes only mainland China through SENS and still enforces destination and send limits', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const service = new SmsService(config(), redis);
    const sensSend = vi.spyOn(NaverSensClient.prototype, 'sendCode').mockResolvedValue({ requestId: 'RSLG-test' });
    const twilioSend = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
      .mockResolvedValue({ sid: 'VE-test', status: 'pending', channel: 'sms' });
    await service.sendVerificationCode(OTHER_PHONE);
    expect(twilioSend).toHaveBeenCalledWith(OTHER_PHONE);
    expect(sensSend).not.toHaveBeenCalled();
    await service.sendVerificationCode(PHONE);
    await expect(service.sendVerificationCode(PHONE)).rejects.toMatchObject({ status: 429 });
    expect(sensSend).toHaveBeenCalledOnce();
    const blocked = new SmsService(config({ SMS_ALLOWED_COUNTRIES: 'KR,TH' }), redis);
    await expect(blocked.sendVerificationCode(PHONE)).rejects.toMatchObject({ status: 400 });
    const budget = new SmsService(config({ SMS_GLOBAL_SEND_LIMIT_PER_MINUTE: '1' }), redis);
    await redis.del(smsResendKey(PHONE));
    await expect(budget.sendVerificationCode(PHONE)).rejects.toMatchObject({ status: 429 });
    expect(sensSend).toHaveBeenCalledOnce();
  });

  it('fails before the provider when durable OTP preparation fails and refunds the reserved quota', async () => {
    const service = new SmsService(config(), redis);
    const sent = vi.spyOn(NaverSensClient.prototype, 'sendCode');
    vi.spyOn(SensOtpStore.prototype, 'prepare').mockRejectedValue(new Error('Valkey unavailable'));
    await expect(service.sendVerificationCode(PHONE)).rejects.toMatchObject({ status: 400 });
    expect(sent).not.toHaveBeenCalled();
    expect(await redis.get(smsResendKey(PHONE))).toBeNull();
    expect(await redis.get(smsSendCounterKey(PHONE))).toBe('0');
  });

  it('accepts a delivered code after losing the Valkey acknowledgement without sending twice', async () => {
    const service = new SmsService(config(), redis);
    const sent = vi.spyOn(NaverSensClient.prototype, 'sendCode').mockResolvedValue({ requestId: 'RSLG-test' });
    vi.spyOn(SensOtpStore.prototype, 'commit').mockRejectedValue(new Error('lost acknowledgement'));
    await expect(service.sendVerificationCode(PHONE)).resolves.toMatchObject({ success: true });
    expect((await service.verifyCode(PHONE, sent.mock.calls[0][1])).verified).toBe(true);
    expect(sent).toHaveBeenCalledOnce();
  });

  it.each([0, 500])('keeps state and quota on uncertain provider outcome %s and exposes the OTP entry contract', async (status) => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const service = new SmsService(config(), redis);
    const sent = vi.spyOn(NaverSensClient.prototype, 'sendCode').mockRejectedValue(new NaverSensApiError(status, 'unknown'));
    const error = await service.sendVerificationCode(PHONE).catch(e => e);
    expect(error.getResponse()).toMatchObject({ errorCode: 'SMS_SEND_OUTCOME_UNKNOWN', retryAfterMs: expect.any(Number) });
    expect(await redis.get(smsSendCounterKey(PHONE))).toBe('1');
    expect(await redis.get(smsGlobalSendCounterKey(Math.floor(Date.now() / 60_000)))).toBe('1');
    await redis.del(smsResendKey(PHONE));
    const retry = await service.sendVerificationCode(PHONE).catch(e => e);
    expect(retry.getResponse()).toMatchObject({ errorCode: 'SMS_SEND_OUTCOME_UNKNOWN' });
    expect(sent).toHaveBeenCalledOnce();
    expect((await service.verifyCode(PHONE, sent.mock.calls[0][1])).verified).toBe(true);
  });

  it('removes a definitively rejected code and releases quota only for explicit provider rate rejection', async () => {
    const service = new SmsService(config(), redis);
    const sent = vi.spyOn(NaverSensClient.prototype, 'sendCode').mockRejectedValue(new NaverSensApiError(429, 'rejected'));
    await expect(service.sendVerificationCode(PHONE)).rejects.toMatchObject({ status: 400 });
    expect(await redis.exists(keys.candidate, keys.lease)).toBe(0);
    expect(await redis.get(smsResendKey(PHONE))).toBeNull();
    expect(await redis.get(smsSendCounterKey(PHONE))).toBe('0');
    sent.mockRejectedValue(new NaverSensApiError(403, 'rejected'));
    await expect(service.sendVerificationCode(PHONE)).rejects.toMatchObject({ status: 400 });
    expect(await redis.get(smsSendCounterKey(PHONE))).toBe('1');
    expect(await redis.get(smsResendKey(PHONE))).toBe('1');
    expect(await redis.exists(keys.candidate, keys.lease)).toBe(0);
  });

  it('requires valid SENS credentials only when the opt-in switch is enabled', () => {
    expect(() => new SmsService(config({ SMS_CN_PROVIDER: 'twilio', NCP_SENS_ACCESS_KEY: '' }), redis)).not.toThrow();
    expect(() => new SmsService(config({ NCP_SENS_ACCESS_KEY: '' }), redis)).toThrow(/Invalid SENS/);
    expect(() => new SmsService(config({ SMS_CN_PROVIDER: 'other' }), redis)).toThrow(/twilio or sens/);
    expect(() => new SmsService(config({ TWILIO_ACCOUNT_SID: '' }), redis)).toThrow(/Twilio credentials/);
  });

  it('preserves the uncertain-send contract through the real HTTP controller and exception filter', async () => {
    const service = new SmsService(config(), redis);
    const send = vi.spyOn(NaverSensClient.prototype, 'sendCode').mockRejectedValue(new NaverSensApiError(0, 'unknown'));
    Reflect.defineMetadata('design:paramtypes', [SmsService], SmsController);
    const moduleRef = await Test.createTestingModule({
      controllers: [SmsController], providers: [{ provide: SmsService, useValue: service }],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    try {
      const sent = await request(app.getHttpServer()).post('/sms/send-code').send({ phone: PHONE }).expect(400);
      expect(sent.body).toMatchObject({ errorCode: 'SMS_SEND_OUTCOME_UNKNOWN', retryAfterMs: expect.any(Number) });
      expect(sent.body.retryAfterMs).toBeGreaterThan(580_000);
      expect(sent.body).not.toHaveProperty('code');
      const verified = await request(app.getHttpServer()).post('/sms/verify-code')
        .send({ phone: PHONE, code: send.mock.calls[0][1], purpose: 'signup' }).expect(200);
      expect(verified.body).toMatchObject({ verified: true, verificationToken: expect.any(String) });
      await request(app.getHttpServer()).post('/sms/verify-code')
        .send({ phone: PHONE, code: send.mock.calls[0][1] }).expect(410);
      expect(send).toHaveBeenCalledOnce();
    } finally { await app.close(); }
  });
});
