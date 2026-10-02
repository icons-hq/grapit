import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException, GoneException, HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SmsService,
  parseSmsAllowedCountries,
  parseSmsGlobalSendLimitPerHour,
  parseSmsGlobalSendLimitPerMinute,
  parseSmsLocalRateLimitsEnabled,
  releasePhoneClaimAndRethrow,
  smsAttemptsKey,
  smsGlobalHourlySendCounterKey,
  smsGlobalSendCounterKey,
  smsOtpKey,
  smsResendKey,
  smsSendCounterKey,
  smsVerificationTokenClaimKey,
  smsVerifiedKey,
  smsVerifyCounterKey,
} from './sms.service.js';
import {
  TwilioVerifyApiError,
  TwilioVerifyClient,
} from './twilio-verify-client.js';

const { captureMessageMock } = vi.hoisted(() => ({ captureMessageMock: vi.fn() }));
vi.mock('@sentry/nestjs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sentry/nestjs')>()),
  captureMessage: captureMessageMock,
}));

const mockRedis = {
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  decr: vi.fn(),
  pttl: vi.fn(),
  eval: vi.fn(),
};

function createConfigService(overrides: Record<string, string | undefined> = {}): ConfigService {
  const config: Record<string, string | undefined> = {
    TWILIO_ACCOUNT_SID: 'AC_test',
    TWILIO_API_KEY_SID: 'SK_test',
    TWILIO_API_KEY_SECRET: 'test-secret',
    TWILIO_VERIFY_SERVICE_SID: 'VA_test',
    JWT_SECRET: 'test-jwt-secret',
    NODE_ENV: 'test',
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => config[key]),
  } as unknown as ConfigService;
}

/**
 * Minimal Valkey stand-in with real SET NX / PX / DEL semantics, so the
 * single-use token tests exercise the same NX race the service relies on.
 */
function createNxRedis(now: () => number = Date.now) {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const live = (key: string) => {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    store,
    set: vi.fn(async (key: string, value: string, ...args: (string | number)[]) => {
      const flags = args.map((arg) => (typeof arg === 'string' ? arg.toUpperCase() : arg));
      if (flags.includes('NX') && live(key)) return null;
      const pxIndex = flags.indexOf('PX');
      const exIndex = flags.indexOf('EX');
      const ttlMs = pxIndex >= 0
        ? Number(flags[pxIndex + 1])
        : exIndex >= 0 ? Number(flags[exIndex + 1]) * 1000 : null;
      store.set(key, { value, expiresAt: ttlMs === null ? null : now() + ttlMs });
      return 'OK';
    }),
    get: vi.fn(async (key: string) => live(key)?.value ?? null),
    del: vi.fn(async (...keys: string[]) => keys.filter((key) => store.delete(key)).length),
    pttl: vi.fn(async (key: string) => {
      const entry = live(key);
      if (!entry) return -2;
      return entry.expiresAt === null ? -1 : entry.expiresAt - now();
    }),
    decr: vi.fn(),
    eval: vi.fn().mockResolvedValue(1),
  };
}

async function issueVerificationToken(
  service: SmsService,
  phone = '+821012345678',
  purpose: 'signup' | 'social_registration' | 'profile_phone_change' = 'signup',
): Promise<string> {
  vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
    .mockResolvedValueOnce({ sid: 'VE_token', status: 'approved', valid: true });
  const result = await service.verifyCode(phone, '123456', purpose);
  return result.verificationToken!;
}

describe('SmsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env['NODE_ENV'] = 'test';
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.eval.mockResolvedValue(1);
    mockRedis.del.mockResolvedValue(1);
    mockRedis.decr.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('production에서 TWILIO_ACCOUNT_SID 미설정 시 throw', () => {
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        TWILIO_ACCOUNT_SID: undefined,
      });

      expect(() => new SmsService(configService, mockRedis as never)).toThrow(
        /TWILIO_ACCOUNT_SID.*required in production/,
      );
    });

    it('production에서 Twilio 인증 수단이 모두 비어 있으면 throw', () => {
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        TWILIO_AUTH_TOKEN: '',
        TWILIO_API_KEY_SID: '',
        TWILIO_API_KEY_SECRET: '',
      });

      expect(() => new SmsService(configService, mockRedis as never)).toThrow(
        /TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID\/TWILIO_API_KEY_SECRET.*required in production/,
      );
    });

    it('production에서 TWILIO_AUTH_TOKEN만 있어도 생성된다', () => {
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        TWILIO_AUTH_TOKEN: 'test-token',
        TWILIO_API_KEY_SID: '',
        TWILIO_API_KEY_SECRET: '',
      });

      expect(() => new SmsService(configService, mockRedis as never)).not.toThrow();
    });

    it('production에서 TWILIO_API_KEY_SID만 있으면 pair 누락으로 throw', () => {
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        TWILIO_AUTH_TOKEN: '',
        TWILIO_API_KEY_SECRET: '',
      });

      expect(() => new SmsService(configService, mockRedis as never)).toThrow(
        /TWILIO_API_KEY_SECRET.*required in production/,
      );
    });

    it('production에서 TWILIO_VERIFY_SERVICE_SID 누락 시 throw', () => {
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        TWILIO_VERIFY_SERVICE_SID: undefined,
      });

      expect(() => new SmsService(configService, mockRedis as never)).toThrow(
        /TWILIO_VERIFY_SERVICE_SID.*required in production/,
      );
    });

    it('production에서 verification token secret 누락 시 throw', () => {
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        JWT_SECRET: undefined,
      });

      expect(() => new SmsService(configService, mockRedis as never)).toThrow(
        /SMS_VERIFICATION_TOKEN_SECRET or JWT_SECRET required in production/,
      );
    });

    it('non-production에서 Twilio 3종 전부 미설정이면 dev mock 모드로 생성된다', () => {
      const configService = createConfigService({
        TWILIO_ACCOUNT_SID: undefined,
        TWILIO_AUTH_TOKEN: undefined,
        TWILIO_API_KEY_SID: undefined,
        TWILIO_API_KEY_SECRET: undefined,
        TWILIO_VERIFY_SERVICE_SID: undefined,
      });

      expect(() => new SmsService(configService, mockRedis as never)).not.toThrow();
    });

    it('production에서 SMS_ALLOWED_COUNTRIES가 비어 있으면 기동은 하되 경고를 남긴다', () => {
      process.env['NODE_ENV'] = 'production';
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      new SmsService(createConfigService(), mockRedis as never);
      expect(warnSpy).toHaveBeenCalledWith({ event: 'sms.allowed_countries_unset' });

      warnSpy.mockClear();
      new SmsService(createConfigService({ SMS_ALLOWED_COUNTRIES: 'KR,TH,CN' }), mockRedis as never);
      expect(warnSpy).not.toHaveBeenCalledWith({ event: 'sms.allowed_countries_unset' });
    });

    it('legacy Infobip env를 더 이상 참조하지 않는다', () => {
      const configService = createConfigService();
      new SmsService(configService, mockRedis as never);

      const getCalls = (configService.get as ReturnType<typeof vi.fn>).mock.calls;
      const requestedKeys = getCalls.map((call: unknown[]) => call[0]);
      expect(requestedKeys).not.toContain('INFOBIP_API_KEY');
      expect(requestedKeys).not.toContain('INFOBIP_BASE_URL');
      expect(requestedKeys).not.toContain('INFOBIP_SENDER');
    });
  });

  describe('sendVerificationCode', () => {
    it.each([
      ['Korea local mobile', '01012345678', '+821012345678'],
      ['United States English fallback', '+14155552671', '+14155552671'],
      ['Thailand mobile', '+66812345678', '+66812345678'],
      ['Taiwan mobile', '+886912345678', '+886912345678'],
      ['Hong Kong mobile', '+85251234567', '+85251234567'],
      ['Vietnam mobile', '+84982291899', '+84982291899'],
    ])('valid international phone validation accepts %s', async (_label, phone, expectedE164) => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockResolvedValueOnce({
          sid: 'VE_launch',
          status: 'pending',
          channel: 'sms',
        });

      const result = await service.sendVerificationCode(phone);

      expect(result.success).toBe(true);
      expect(sendSpy).toHaveBeenCalledWith(expectedE164);
      expect(mockRedis.set).toHaveBeenCalledWith(
        smsResendKey(expectedE164), '1', 'PX', 30_000, 'NX',
      );
    });

    it('mainland China phone is allowed through to Twilio Verify', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockResolvedValueOnce({
          sid: 'VE_cn',
          status: 'pending',
          channel: 'sms',
        });

      const result = await service.sendVerificationCode('+8613912345678');

      expect(result.success).toBe(true);
      expect(sendSpy).toHaveBeenCalledWith('+8613912345678');
    });

    it('invalid-but-regex-valid international phone throws BadRequestException before side effects', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification');

      await expect(service.sendVerificationCode('+9991234567')).rejects.toThrow(
        BadRequestException,
      );

      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(mockRedis.eval).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('dev mock에서 성공 반환하고 Twilio를 호출하지 않는다', async () => {
      const configService = createConfigService({
        TWILIO_ACCOUNT_SID: undefined,
        TWILIO_AUTH_TOKEN: undefined,
        TWILIO_API_KEY_SID: undefined,
        TWILIO_API_KEY_SECRET: undefined,
        TWILIO_VERIFY_SERVICE_SID: undefined,
      });
      const service = new SmsService(configService, mockRedis as never);
      const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification');

      const result = await service.sendVerificationCode('01012345678');

      expect(result.success).toBe(true);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('resend cooldown이 남아 있으면 429와 남은 시간을 반환하고 Twilio를 호출하지 않는다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce(null);
      mockRedis.pttl.mockResolvedValueOnce(25000);
      const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification');

      const error = await service.sendVerificationCode('+821012345678')
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({ retryAfterMs: 25000 });
      expect(sendSpy).not.toHaveBeenCalled();
      expect(mockRedis.eval).not.toHaveBeenCalled();
    });

    it('Twilio Verify send 성공 시 cooldown·phone counter·분/시간 global budget을 예약하고 되돌리지 않는다', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-02T00:00:30.000Z'));
      const windowIndex = Math.floor(Date.now() / 60_000);
      const hourIndex = Math.floor(Date.now() / 3_600_000);
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockResolvedValueOnce({
          sid: 'VE123',
          status: 'pending',
          channel: 'sms',
        });

      const result = await service.sendVerificationCode('+821012345678');

      expect(result.success).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        smsResendKey('+821012345678'), '1', 'PX', 30_000, 'NX',
      );
      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        1, expect.stringContaining('INCR'), 1, smsSendCounterKey('+821012345678'), 3600,
      );
      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        2, expect.stringContaining('INCR'), 1, smsGlobalSendCounterKey(windowIndex), 120,
      );
      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        3, expect.stringContaining('INCR'), 1, smsGlobalHourlySendCounterKey(hourIndex), 7_200,
      );
      expect(mockRedis.del).not.toHaveBeenCalled();
      expect(mockRedis.decr).not.toHaveBeenCalled();
    });

    it('Twilio Verify 5xx 시 cooldown·phone counter·global budget을 되돌린다', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-02T00:00:30.000Z'));
      const windowIndex = Math.floor(Date.now() / 60_000);
      const hourIndex = Math.floor(Date.now() / 3_600_000);
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockRejectedValueOnce(new TwilioVerifyApiError(500, 20000, 'Server Error'));

      await expect(service.sendVerificationCode('+821012345678')).rejects.toThrow(
        BadRequestException,
      );

      expect(mockRedis.del).toHaveBeenCalledWith(smsResendKey('+821012345678'));
      expect(mockRedis.decr).toHaveBeenCalledWith(smsSendCounterKey('+821012345678'));
      expect(mockRedis.decr).toHaveBeenCalledWith(smsGlobalSendCounterKey(windowIndex));
      expect(mockRedis.decr).toHaveBeenCalledWith(smsGlobalHourlySendCounterKey(hourIndex));
    });

    it('예약 도중 Valkey 명령이 실패하면 이미 잡은 cooldown·phone counter를 되돌리고 Twilio를 호출하지 않는다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.eval
        .mockResolvedValueOnce(1) // phone-axis send counter
        .mockRejectedValueOnce(new Error('Connection is closed.')); // global minute budget
      const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification');

      await expect(service.sendVerificationCode('+821012345678')).rejects.toThrow(
        'Connection is closed.',
      );

      expect(sendSpy).not.toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith(smsResendKey('+821012345678'));
      expect(mockRedis.decr).toHaveBeenCalledWith(smsSendCounterKey('+821012345678'));
      // The failed INCR's own outcome is unknown, so it is not decremented.
      expect(mockRedis.decr).toHaveBeenCalledTimes(1);
    });

    it('시간 global budget INCR이 실패하면 분 budget slot까지 되돌린다', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-02T00:00:30.000Z'));
      const windowIndex = Math.floor(Date.now() / 60_000);
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.eval
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('READONLY'));

      await expect(service.sendVerificationCode('+821012345678')).rejects.toThrow('READONLY');

      expect(mockRedis.del).toHaveBeenCalledWith(smsResendKey('+821012345678'));
      expect(mockRedis.decr).toHaveBeenCalledWith(smsSendCounterKey('+821012345678'));
      expect(mockRedis.decr).toHaveBeenCalledWith(smsGlobalSendCounterKey(windowIndex));
    });

    it('Twilio Verify permanent 4xx 시 quota rollback을 하지 않는다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockRejectedValueOnce(new TwilioVerifyApiError(400, 60200, 'Bad Request'));

      await expect(service.sendVerificationCode('+821012345678')).rejects.toThrow(
        BadRequestException,
      );

      expect(mockRedis.del).not.toHaveBeenCalledWith(smsResendKey('+821012345678'));
      expect(mockRedis.decr).not.toHaveBeenCalledWith(smsSendCounterKey('+821012345678'));
    });

    it('Twilio 60205 landline recipient는 휴대폰 번호 안내로 매핑하고 quota rollback은 하지 않는다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockRejectedValueOnce(
          new TwilioVerifyApiError(
            403,
            60205,
            'SMS is not supported by landline phone number',
          ),
        );

      await expect(service.sendVerificationCode('+66600565418')).rejects.toMatchObject({
        message: 'SMS를 받을 수 있는 휴대폰 번호를 입력해주세요',
      });

      expect(mockRedis.del).not.toHaveBeenCalledWith(smsResendKey('+66600565418'));
      expect(mockRedis.decr).not.toHaveBeenCalledWith(smsSendCounterKey('+66600565418'));
    });

    it('Twilio 60200 invalid To는 올바른 전화번호 안내로 매핑한다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockRejectedValueOnce(
          new TwilioVerifyApiError(
            400,
            60200,
            'Invalid parameter `To`: +82600565418',
          ),
        );

      await expect(service.sendVerificationCode('+82600565418')).rejects.toMatchObject({
        message: '올바른 휴대폰 번호를 입력해주세요',
      });
    });

    it('Twilio 60410 recipient block은 stable errorCode/providerCode를 포함한다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockRejectedValueOnce(
          new TwilioVerifyApiError(
            403,
            60410,
            'The destination phone number has been temporarily blocked',
          ),
        );

      try {
        await service.sendVerificationCode('+821026642373');
        throw new Error('Expected sendVerificationCode to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({
          errorCode: 'SMS_RECIPIENT_BLOCKED',
          providerCode: 60410,
        });
      }
    });

    it('phone-axis send counter가 시간당 5회를 넘으면 429로 막고 Twilio를 호출하지 않는다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.eval.mockResolvedValueOnce(6);
      const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification');

      const error = await service.sendVerificationCode('+821012345678')
        .catch((err: unknown) => err);

      expect((error as HttpException).getStatus()).toBe(429);
      expect(sendSpy).not.toHaveBeenCalled();
      // The global budget is never touched by a request the phone axis rejected.
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    it('서로 다른 번호로 돌려도 분당 global send budget을 넘으면 429로 막고 phone-axis 예약을 되돌린다', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-02T00:00:45.000Z'));
      const configService = createConfigService({ SMS_GLOBAL_SEND_LIMIT_PER_MINUTE: '2' });
      const service = new SmsService(configService, mockRedis as never);
      const counters = new Map<string, number>();
      mockRedis.eval.mockImplementation(async (_script: string, _numKeys: number, key: string) => {
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        return next;
      });
      const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockResolvedValue({ sid: 'VE_rotate', status: 'pending', channel: 'sms' });
      captureMessageMock.mockClear();

      await service.sendVerificationCode('+821011110001');
      await service.sendVerificationCode('+821011110002');
      const third = await service.sendVerificationCode('+821011110003')
        .catch((err: unknown) => err);
      const fourth = await service.sendVerificationCode('+821011110004')
        .catch((err: unknown) => err);

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect((third as HttpException).getStatus()).toBe(429);
      expect((third as HttpException).getResponse()).toMatchObject({
        message: '인증번호 요청이 많아 잠시 후 다시 시도해주세요.',
        retryAfterMs: 15_000,
      });
      expect((fourth as HttpException).getStatus()).toBe(429);
      expect(mockRedis.del).toHaveBeenCalledWith(smsResendKey('+821011110003'));
      expect(mockRedis.decr).toHaveBeenCalledWith(smsSendCounterKey('+821011110003'));
      expect(captureMessageMock).toHaveBeenCalledTimes(1);
      expect(captureMessageMock).toHaveBeenCalledWith('SMS global send budget exhausted');
    });

    it('SMS_GLOBAL_SEND_LIMIT_PER_MINUTE=0이면 분 budget만 끄고 시간 budget은 유지한다', async () => {
      const configService = createConfigService({ SMS_GLOBAL_SEND_LIMIT_PER_MINUTE: '0' });
      const service = new SmsService(configService, mockRedis as never);
      vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockResolvedValueOnce({ sid: 'VE_no_budget', status: 'pending', channel: 'sms' });

      await service.sendVerificationCode('+821012345678');

      expect(mockRedis.eval).toHaveBeenCalledTimes(2);
      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        1, expect.stringContaining('INCR'), 1, smsSendCounterKey('+821012345678'), 3600,
      );
      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        2, expect.stringContaining('INCR'), 1, expect.stringMatching(/^sms:global-send-hour:/), 7_200,
      );
    });

    it('분·시간 global budget을 모두 0으로 두면 phone-axis 한도만 쓴다', async () => {
      const configService = createConfigService({
        SMS_GLOBAL_SEND_LIMIT_PER_MINUTE: '0',
        SMS_GLOBAL_SEND_LIMIT_PER_HOUR: '0',
      });
      const service = new SmsService(configService, mockRedis as never);
      vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockResolvedValueOnce({ sid: 'VE_no_budget', status: 'pending', channel: 'sms' });

      await service.sendVerificationCode('+821012345678');

      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('INCR'), 1, smsSendCounterKey('+821012345678'), 3600,
      );
    });

    it('분 budget 안에서 번호를 돌려도 시간 global budget을 넘으면 429로 막고 분 budget slot까지 되돌린다', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-02T00:40:00.000Z'));
      const minuteIndex = Math.floor(Date.now() / 60_000);
      const configService = createConfigService({
        SMS_GLOBAL_SEND_LIMIT_PER_MINUTE: '100',
        SMS_GLOBAL_SEND_LIMIT_PER_HOUR: '2',
      });
      const service = new SmsService(configService, mockRedis as never);
      const counters = new Map<string, number>();
      mockRedis.eval.mockImplementation(async (_script: string, _numKeys: number, key: string) => {
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        return next;
      });
      const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockResolvedValue({ sid: 'VE_rotate_hour', status: 'pending', channel: 'sms' });
      captureMessageMock.mockClear();

      await service.sendVerificationCode('+821022220001');
      await service.sendVerificationCode('+821022220002');
      const third = await service.sendVerificationCode('+821022220003')
        .catch((err: unknown) => err);
      const fourth = await service.sendVerificationCode('+821022220004')
        .catch((err: unknown) => err);

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect((third as HttpException).getStatus()).toBe(429);
      expect((third as HttpException).getResponse()).toMatchObject({
        message: '인증번호 요청이 많아 잠시 후 다시 시도해주세요.',
        retryAfterMs: 20 * 60_000,
      });
      expect((fourth as HttpException).getStatus()).toBe(429);
      expect(mockRedis.del).toHaveBeenCalledWith(smsResendKey('+821022220003'));
      expect(mockRedis.decr).toHaveBeenCalledWith(smsSendCounterKey('+821022220003'));
      expect(mockRedis.decr).toHaveBeenCalledWith(smsGlobalSendCounterKey(minuteIndex));
      expect(captureMessageMock).toHaveBeenCalledTimes(1);
      expect(captureMessageMock).toHaveBeenCalledWith('SMS hourly global send budget exhausted');
    });

    it('SMS_ALLOWED_COUNTRIES 밖의 번호는 Valkey·Twilio 작업 전에 recipient block으로 거절한다', async () => {
      const configService = createConfigService({ SMS_ALLOWED_COUNTRIES: 'kr, th' });
      const service = new SmsService(configService, mockRedis as never);
      const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockResolvedValue({ sid: 'VE_country', status: 'pending', channel: 'sms' });

      const blocked = await service.sendVerificationCode('+14155552671')
        .catch((err: unknown) => err);
      expect(mockRedis.set).not.toHaveBeenCalled();
      await service.sendVerificationCode('+66812345678');

      expect(blocked).toBeInstanceOf(BadRequestException);
      expect((blocked as BadRequestException).getResponse()).toMatchObject({
        errorCode: 'SMS_RECIPIENT_BLOCKED',
      });
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith('+66812345678');
    });
  });

  describe('SMS limit configuration', () => {
    it('local rate limits default to enabled and only an explicit false disables them', () => {
      expect(parseSmsLocalRateLimitsEnabled(undefined)).toBe(true);
      expect(parseSmsLocalRateLimitsEnabled('')).toBe(true);
      expect(parseSmsLocalRateLimitsEnabled('true')).toBe(true);
      expect(parseSmsLocalRateLimitsEnabled(' FALSE ')).toBe(false);
    });

    it('global send budget defaults to 300/min and rejects invalid values at startup', () => {
      expect(parseSmsGlobalSendLimitPerMinute(undefined)).toBe(300);
      expect(parseSmsGlobalSendLimitPerMinute('0')).toBe(0);
      expect(parseSmsGlobalSendLimitPerMinute('1200')).toBe(1200);
      expect(() => parseSmsGlobalSendLimitPerMinute('-1')).toThrow(/non-negative integer/);
      expect(() => parseSmsGlobalSendLimitPerMinute('ten')).toThrow(/non-negative integer/);
      expect(() => new SmsService(
        createConfigService({ SMS_GLOBAL_SEND_LIMIT_PER_MINUTE: '1.5' }),
        mockRedis as never,
      )).toThrow(/SMS_GLOBAL_SEND_LIMIT_PER_MINUTE/);
    });

    it('hourly global send budget defaults to 3000/hour and rejects invalid values at startup', () => {
      expect(parseSmsGlobalSendLimitPerHour(undefined)).toBe(3000);
      expect(parseSmsGlobalSendLimitPerHour(' ')).toBe(3000);
      expect(parseSmsGlobalSendLimitPerHour('0')).toBe(0);
      expect(parseSmsGlobalSendLimitPerHour('12000')).toBe(12000);
      expect(() => parseSmsGlobalSendLimitPerHour('-5')).toThrow(
        /SMS_GLOBAL_SEND_LIMIT_PER_HOUR must be a non-negative integer/,
      );
      expect(() => new SmsService(
        createConfigService({ SMS_GLOBAL_SEND_LIMIT_PER_HOUR: 'lots' }),
        mockRedis as never,
      )).toThrow(/SMS_GLOBAL_SEND_LIMIT_PER_HOUR/);
    });

    it('allowed countries accept ISO alpha-2 lists and reject other values', () => {
      expect(parseSmsAllowedCountries(undefined)).toBeNull();
      expect(parseSmsAllowedCountries(' ')).toBeNull();
      expect([...parseSmsAllowedCountries('kr, TH,cn')!]).toEqual(['KR', 'TH', 'CN']);
      expect(() => parseSmsAllowedCountries('KR,+82')).toThrow(/ISO 3166-1 alpha-2/);
    });
  });

  describe('verifyCode', () => {
    it('invalid-but-regex-valid international phone throws BadRequestException before Valkey work', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      await expect(service.verifyCode('+9991234567', '123456')).rejects.toThrow(
        BadRequestException,
      );

      expect(mockRedis.eval).not.toHaveBeenCalled();
      expect(mockRedis.decr).not.toHaveBeenCalled();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('dev mock에서 000000 성공', async () => {
      const configService = createConfigService({
        TWILIO_ACCOUNT_SID: undefined,
        TWILIO_AUTH_TOKEN: undefined,
        TWILIO_API_KEY_SID: undefined,
        TWILIO_API_KEY_SECRET: undefined,
        TWILIO_VERIFY_SERVICE_SID: undefined,
      });
      const service = new SmsService(configService, mockRedis as never);

      const result = await service.verifyCode('01012345678', '000000');

      expect(result.verified).toBe(true);
      expect(result.verificationToken).toEqual(expect.any(String));
    });

    it('dev mock에서 잘못된 코드 실패', async () => {
      const configService = createConfigService({
        TWILIO_ACCOUNT_SID: undefined,
        TWILIO_AUTH_TOKEN: undefined,
        TWILIO_API_KEY_SID: undefined,
        TWILIO_API_KEY_SECRET: undefined,
        TWILIO_VERIFY_SERVICE_SID: undefined,
      });
      const service = new SmsService(configService, mockRedis as never);

      const result = await service.verifyCode('01012345678', '111111');

      expect(result).toEqual({
        verified: false,
        message: '인증번호가 일치하지 않습니다',
      });
    });

    it('phone-axis verify counter가 15분 10회를 넘으면 Twilio 확인 전에 429로 막는다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.eval.mockResolvedValueOnce(11);
      const checkSpy = vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification');

      const error = await service.verifyCode('+821012345678', '123456')
        .catch((err: unknown) => err);

      expect((error as HttpException).getStatus()).toBe(429);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('INCR'), 1, smsVerifyCounterKey('+821012345678'), 900,
      );
      expect(checkSpy).not.toHaveBeenCalled();
    });

    it('Twilio approved 시 verified flag 저장 + purpose-bound token 반환', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK');
      vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
        .mockResolvedValueOnce({
          sid: 'VE123',
          status: 'approved',
          valid: true,
        });

      const result = await service.verifyCode('+821012345678', '123456');

      expect(result.verified).toBe(true);
      expect(result.verificationToken).toEqual(expect.any(String));
      expect(mockRedis.set).toHaveBeenCalledWith(
        smsVerifiedKey('+821012345678'),
        '1',
        'EX',
        600,
      );
    });

    it('Twilio pending/invalid 결과는 verified:false를 반환한다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
        .mockResolvedValueOnce({
          sid: 'VE123',
          status: 'pending',
          valid: false,
        });

      const result = await service.verifyCode('+821012345678', '000000');

      expect(result).toEqual({
        verified: false,
        message: '인증번호가 일치하지 않습니다',
      });
    });

    it('Twilio expired/not found 결과는 GoneException으로 매핑하고 verify slot을 되돌린다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
        .mockRejectedValueOnce(new TwilioVerifyApiError(404, 20404, 'Not Found'));

      await expect(service.verifyCode('+821012345678', '123456')).rejects.toThrow(
        GoneException,
      );
      expect(mockRedis.decr).toHaveBeenCalledWith(smsVerifyCounterKey('+821012345678'));
    });

    it('Twilio max check attempts(60202)도 Gone으로 매핑하고 verify slot을 되돌린다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
        .mockRejectedValueOnce(new TwilioVerifyApiError(429, 60202, 'Max check attempts reached'));

      await expect(service.verifyCode('+821012345678', '123456')).rejects.toThrow(
        GoneException,
      );
      expect(mockRedis.decr).toHaveBeenCalledWith(smsVerifyCounterKey('+821012345678'));
    });

    it('발송한 적 없는 번호로 verify를 반복해도 15분 한도를 소모하지 않아 피해자를 잠그지 못한다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      let verifyCount = 0;
      mockRedis.eval.mockImplementation(async () => ++verifyCount);
      mockRedis.decr.mockImplementation(async () => --verifyCount);
      const checkSpy = vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
        .mockRejectedValue(new TwilioVerifyApiError(404, 20404, 'Not Found'));

      for (let i = 0; i < 11; i++) {
        await expect(service.verifyCode('+821012345678', '000000')).rejects.toThrow(GoneException);
      }
      checkSpy.mockResolvedValueOnce({ sid: 'VE_victim', status: 'approved', valid: true });

      await expect(service.verifyCode('+821012345678', '123456')).resolves.toMatchObject({
        verified: true,
      });
      expect(checkSpy).toHaveBeenCalledTimes(12);
    });

    it('Twilio rate limit 결과는 HttpException(429)으로 매핑한다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.decr.mockResolvedValueOnce(0);
      vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
        .mockRejectedValueOnce(new TwilioVerifyApiError(429, 60203, 'Too Many Requests'));

      await expect(service.verifyCode('+821012345678', '123456')).rejects.toThrow(
        HttpException,
      );
      expect(mockRedis.decr).toHaveBeenCalledWith(smsVerifyCounterKey('+821012345678'));
    });

    it('Twilio transient failure 시 로컬 verify-count를 되돌리고 generic 실패를 반환한다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.decr.mockResolvedValueOnce(0);
      vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
        .mockRejectedValueOnce(new TwilioVerifyApiError(500, 20000, 'Server Error'));

      const result = await service.verifyCode('+821012345678', '123456');

      expect(result).toEqual({
        verified: false,
        message: '인증번호 확인에 실패했습니다. 잠시 후 다시 시도해주세요.',
      });
      expect(mockRedis.decr).toHaveBeenCalledWith(smsVerifyCounterKey('+821012345678'));
    });

    it('verifyPhoneVerificationToken accepts a freshly issued token for the same phone and purpose', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK');
      vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
        .mockResolvedValueOnce({
          sid: 'VE123',
          status: 'approved',
          valid: true,
        });

      const result = await service.verifyCode(
        '+821012345678',
        '123456',
        'social_registration',
      );

      expect(() => service.verifyPhoneVerificationToken(
        result.verificationToken!,
        { phone: '+821012345678', purpose: 'social_registration' },
      )).not.toThrow();
    });

    it('verifyPhoneVerificationToken rejects mismatched purpose', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK');
      vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
        .mockResolvedValueOnce({
          sid: 'VE123',
          status: 'approved',
          valid: true,
        });

      const result = await service.verifyCode('+821012345678', '123456', 'signup');

      expect(() => service.verifyPhoneVerificationToken(
        result.verificationToken!,
        { phone: '+821012345678', purpose: 'profile_phone_change' },
      )).toThrow(BadRequestException);
    });
  });

  describe('claimPhoneVerificationToken (single-use, audit #103)', () => {
    it('같은 토큰의 두 번째 claim은 거절해 SMS 한 번으로 계정을 여러 개 만들 수 없다', async () => {
      const redis = createNxRedis();
      const service = new SmsService(createConfigService(), redis as never);
      const token = await issueVerificationToken(service);

      await expect(service.claimPhoneVerificationToken(token, {
        phone: '+821012345678', purpose: 'signup',
      })).resolves.toBeDefined();
      await expect(service.claimPhoneVerificationToken(token, {
        phone: '01012345678', purpose: 'signup',
      })).rejects.toThrow('이미 사용된 전화번호 인증입니다. 휴대폰 인증을 다시 진행해주세요.');
    });

    it('동시에 들어온 같은 토큰 claim은 하나만 성공한다', async () => {
      const redis = createNxRedis();
      const service = new SmsService(createConfigService(), redis as never);
      const token = await issueVerificationToken(service);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => service.claimPhoneVerificationToken(token, {
          phone: '+821012345678', purpose: 'signup',
        })),
      );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(4);
    });

    it('claim marker는 토큰 만료 후 grace까지 유지되고 release하면 같은 토큰으로 재시도할 수 있다', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-02T00:00:00.000Z'));
      const redis = createNxRedis();
      const service = new SmsService(createConfigService(), redis as never);
      const token = await issueVerificationToken(service);
      const payload = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as {
        nonce: string;
      };
      const claimKey = smsVerificationTokenClaimKey('+821012345678', payload.nonce);

      const claim = await service.claimPhoneVerificationToken(token, {
        phone: '+821012345678', purpose: 'signup',
      });
      expect(await redis.pttl(claimKey)).toBe(600_000 + 60_000);

      await claim.release();
      await claim.release();
      expect(redis.del).toHaveBeenCalledTimes(1);

      await expect(service.claimPhoneVerificationToken(token, {
        phone: '+821012345678', purpose: 'signup',
      })).resolves.toBeDefined();
    });

    it('releasePhoneClaimAndRethrow는 실패한 write의 claim을 풀고 원래 오류를 그대로 던진다', async () => {
      const redis = createNxRedis();
      const service = new SmsService(createConfigService(), redis as never);
      const token = await issueVerificationToken(service);
      const claim = await service.claimPhoneVerificationToken(token, {
        phone: '+821012345678', purpose: 'signup',
      });
      const writeError = new Error('unique violation');

      await expect(Promise.reject(writeError).catch(releasePhoneClaimAndRethrow(claim)))
        .rejects.toBe(writeError);
      await expect(service.claimPhoneVerificationToken(token, {
        phone: '+821012345678', purpose: 'signup',
      })).resolves.toBeDefined();
    });

    it('만료·다른 번호·다른 목적 토큰은 Valkey claim 전에 거절한다', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-02T00:00:00.000Z'));
      const redis = createNxRedis();
      const service = new SmsService(createConfigService(), redis as never);
      const token = await issueVerificationToken(service);
      redis.set.mockClear();

      await expect(service.claimPhoneVerificationToken(token, {
        phone: '+821099998888', purpose: 'signup',
      })).rejects.toThrow('전화번호 인증이 완료되지 않았습니다');
      await expect(service.claimPhoneVerificationToken(token, {
        phone: '+821012345678', purpose: 'profile_phone_change',
      })).rejects.toThrow('전화번호 인증이 완료되지 않았습니다');
      vi.setSystemTime(new Date('2026-10-02T00:10:00.001Z'));
      await expect(service.claimPhoneVerificationToken(token, {
        phone: '+821012345678', purpose: 'signup',
      })).rejects.toThrow('전화번호 인증이 완료되지 않았습니다');
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('release 중 Valkey 오류는 삼키고 원래 write 오류 흐름을 막지 않는다', async () => {
      const redis = createNxRedis();
      const service = new SmsService(createConfigService(), redis as never);
      const token = await issueVerificationToken(service);
      const claim = await service.claimPhoneVerificationToken(token, {
        phone: '+821012345678', purpose: 'signup',
      });
      redis.del.mockRejectedValueOnce(new Error('valkey down'));

      await expect(claim.release()).resolves.toBeUndefined();
    });
  });

  describe('SMS hash-tag key builders', () => {
    it.each([
      ['missing plus', '821012345678'],
      ['too short', '+12345'],
      ['contains brace', '+8210}123456'],
      ['contains text', '+8210xBAD'],
    ])('smsOtpKey throws on %s', (_label, bad) => {
      expect(() => smsOtpKey(bad)).toThrow(/non-E164 key input/);
    });

    it.each([
      ['missing plus', '821012345678'],
      ['too short', '+12345'],
      ['contains brace', '+8210}123456'],
    ])('smsAttemptsKey throws on %s', (_label, bad) => {
      expect(() => smsAttemptsKey(bad)).toThrow(/non-E164 key input/);
    });

    it.each([
      ['missing plus', '821012345678'],
      ['too short', '+12345'],
      ['contains brace', '+8210}123456'],
    ])('smsVerifiedKey throws on %s', (_label, bad) => {
      expect(() => smsVerifiedKey(bad)).toThrow(/non-E164 key input/);
    });

    it('all per-phone SMS keys share the same hash tag', () => {
      const phone = '+821012345678';

      expect(smsOtpKey(phone)).toBe('{sms:+821012345678}:otp');
      expect(smsAttemptsKey(phone)).toBe('{sms:+821012345678}:attempts');
      expect(smsVerifiedKey(phone)).toBe('{sms:+821012345678}:verified');
      expect(smsResendKey(phone)).toBe('{sms:+821012345678}:resend');
      expect(smsSendCounterKey(phone)).toBe('{sms:+821012345678}:send-count');
      expect(smsVerifyCounterKey(phone)).toBe('{sms:+821012345678}:verify-count');
    });
  });
});
