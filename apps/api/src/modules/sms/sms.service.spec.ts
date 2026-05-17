import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, GoneException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SmsService,
  smsAttemptsKey,
  smsOtpKey,
  smsResendKey,
  smsSendCounterKey,
  smsVerifiedKey,
  smsVerifyCounterKey,
} from './sms.service.js';
import {
  TwilioVerifyApiError,
  TwilioVerifyClient,
} from './twilio-verify-client.js';

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

describe('SmsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env['NODE_ENV'] = 'test';
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
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(mockRedis.eval).not.toHaveBeenCalled();
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
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(mockRedis.eval).not.toHaveBeenCalled();
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

    it('local resend cooldown이 남아 있어도 Twilio Verify로 발송한다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce(null);
      mockRedis.pttl.mockResolvedValueOnce(25000);
      const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockResolvedValueOnce({
          sid: 'VE_hotfix',
          status: 'pending',
          channel: 'sms',
        });

      const result = await service.sendVerificationCode('+821012345678');

      expect(result.success).toBe(true);
      expect(sendSpy).toHaveBeenCalledWith('+821012345678');
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(mockRedis.pttl).not.toHaveBeenCalled();
    });

    it('Twilio Verify send 성공 시 로컬 OTP/cooldown/counter를 생성하지 않는다', async () => {
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
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(mockRedis.eval).not.toHaveBeenCalled();
    });

    it('Twilio Verify 5xx 시 로컬 quota rollback을 하지 않는다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.del.mockResolvedValueOnce(1);
      mockRedis.decr.mockResolvedValueOnce(0);

      vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockRejectedValueOnce(new TwilioVerifyApiError(500, 20000, 'Server Error'));

      await expect(service.sendVerificationCode('+821012345678')).rejects.toThrow(
        BadRequestException,
      );

      expect(mockRedis.del).not.toHaveBeenCalled();
      expect(mockRedis.decr).not.toHaveBeenCalled();
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

    it('local phone-axis send counter 초과 상태도 앱에서 막지 않는다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.eval.mockResolvedValueOnce(6);
      const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
        .mockResolvedValueOnce({
          sid: 'VE_hotfix_counter',
          status: 'pending',
          channel: 'sms',
        });

      const result = await service.sendVerificationCode('+821012345678');

      expect(result.success).toBe(true);
      expect(sendSpy).toHaveBeenCalledWith('+821012345678');
      expect(mockRedis.eval).not.toHaveBeenCalled();
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

    it('local phone-axis verify counter 초과 상태도 앱에서 막지 않는다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.eval.mockResolvedValueOnce(11);
      mockRedis.set.mockResolvedValueOnce('OK');
      vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
        .mockResolvedValueOnce({
          sid: 'VE_hotfix_verify_counter',
          status: 'approved',
          valid: true,
        });

      const result = await service.verifyCode('+821012345678', '123456');

      expect(result.verified).toBe(true);
      expect(mockRedis.eval).not.toHaveBeenCalled();
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

    it('Twilio expired/not found 결과는 GoneException으로 매핑한다', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
        .mockRejectedValueOnce(new TwilioVerifyApiError(404, 20404, 'Not Found'));

      await expect(service.verifyCode('+821012345678', '123456')).rejects.toThrow(
        GoneException,
      );
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
      expect(mockRedis.decr).not.toHaveBeenCalled();
    });

    it('Twilio transient failure 시 로컬 verify-count rollback을 하지 않고 generic 실패를 반환한다', async () => {
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
      expect(mockRedis.decr).not.toHaveBeenCalled();
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
