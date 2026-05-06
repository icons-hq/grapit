/**
 * Phase 10.1: Infobip /sms/3/messages v3 전환
 * - OTP 생성: crypto.randomInt (Math.random 금지, OWASP A02)
 * - 저장: Valkey `{sms:{e164}}:otp` TTL 180s (Phase 14 hash-tag 적용)
 * - Verify: Valkey Lua VERIFY_AND_INCREMENT_LUA atomic script
 * - Infobip verify API 사용 안 함 (자체 구현)
 *
 * RED 상태: Plan 04 실행 전까지 SmsService에 OTP/Lua verify 로직 미존재
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, GoneException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SmsService,
  smsOtpKey,
  smsAttemptsKey,
  smsVerifiedKey,
  smsResendKey,
  smsSendCounterKey,
  smsVerifyCounterKey,
} from './sms.service.js';
import { InfobipClient, InfobipApiError } from './infobip-client.js';
import { formatSmsOtpMessage } from './sms-copy.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomInt: actual.randomInt };
});
import * as nodeCrypto from 'node:crypto';

// ---------- Mocks ----------
// [Issue 1 / PR #16 review] sendVerificationCode now uses redis.pipeline() to
// SET the new OTP and DEL {sms:{e164}}:attempts together. The mock pipeline must
// be chainable (set/del return `this`) and exec must resolve to ioredis-style
// [Error|null, unknown][] tuples.
const mockPipeline = {
  set: vi.fn().mockReturnThis(),
  del: vi.fn().mockReturnThis(),
  exec: vi.fn(),
};
const mockRedis = {
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  decr: vi.fn(),
  pttl: vi.fn(),
  eval: vi.fn(),
  pipeline: vi.fn(() => mockPipeline),
};

function createConfigService(overrides: Record<string, string | undefined> = {}): ConfigService {
  const config: Record<string, string | undefined> = {
    INFOBIP_API_KEY: 'test-key',
    INFOBIP_BASE_URL: 'https://test.api.infobip.com',
    INFOBIP_SENDER: '0212345678',
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
    // Re-establish chainable behavior on pipeline mocks (cleared by clearAllMocks)
    mockPipeline.set.mockReturnThis();
    mockPipeline.del.mockReturnThis();
    // Default exec result: both ops succeed (null error, OK/1 result)
    mockPipeline.exec.mockResolvedValue([
      [null, 'OK'],
      [null, 1],
    ]);
  });

  // ---------- constructor ----------
  describe('constructor', () => {
    it('production에서 INFOBIP_API_KEY 미설정 시 throw', () => {
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        INFOBIP_API_KEY: undefined,
        NODE_ENV: 'production',
      });

      expect(() => new SmsService(configService, mockRedis as never)).toThrow(
        /INFOBIP_API_KEY.*required in production/,
      );
    });

    it('production에서 INFOBIP_BASE_URL 빈 문자열이면 throw', () => {
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        INFOBIP_BASE_URL: '',
        NODE_ENV: 'production',
      });

      expect(() => new SmsService(configService, mockRedis as never)).toThrow(
        /required in production/,
      );
    });

    it('production에서 INFOBIP_SENDER 누락 시 throw', () => {
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        INFOBIP_SENDER: undefined,
        NODE_ENV: 'production',
      });

      expect(() => new SmsService(configService, mockRedis as never)).toThrow(
        /INFOBIP_SENDER.*required in production/,
      );
    });

    it('non-production에서 3종 전부 미설정이면 isDevMock=true', () => {
      const configService = createConfigService({
        INFOBIP_API_KEY: undefined,
        INFOBIP_BASE_URL: undefined,
        INFOBIP_SENDER: undefined,
        NODE_ENV: 'test',
      });

      const service = new SmsService(configService, mockRedis as never);
      expect(service).toBeDefined();
    });

    it('non-production이어도 legacy env(APPLICATION_ID, MESSAGE_ID)를 참조하지 않는다', () => {
      const configService = createConfigService();
      new SmsService(configService, mockRedis as never);

      const getCalls = (configService.get as ReturnType<typeof vi.fn>).mock.calls;
      const requestedKeys = getCalls.map((call: unknown[]) => call[0]);
      expect(requestedKeys).not.toContain('INFOBIP_APPLICATION_ID');
      expect(requestedKeys).not.toContain('INFOBIP_MESSAGE_ID');
    });

    // ---------- WR-03: INFOBIP_SENDER format validation ----------
    it('[WR-03] production에서 INFOBIP_SENDER가 알파벳 포함 시 throw (KR MNO silent rewrite 방지)', () => {
      // Alphanumeric senders are silently rewritten by KR MNOs — Infobip then
      // returns 4xx for every send, and our 4xx rollback policy keeps the
      // phone-axis counter (abuse mitigation), permanently draining quotas.
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        INFOBIP_SENDER: 'Grabit',
        NODE_ENV: 'production',
      });

      expect(() => new SmsService(configService, mockRedis as never)).toThrow(
        /INFOBIP_SENDER must be a KISA-registered numeric ID/,
      );
    });

    it('[WR-03] production에서 INFOBIP_SENDER가 4자리 미만의 숫자이면 throw', () => {
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        INFOBIP_SENDER: '123',
        NODE_ENV: 'production',
      });

      expect(() => new SmsService(configService, mockRedis as never)).toThrow(
        /INFOBIP_SENDER must be a KISA-registered numeric ID/,
      );
    });

    it('[WR-03] production에서 INFOBIP_SENDER 길이 3 이하 시에도 값은 마스킹됨 (로그 유출 방지)', () => {
      // Prior `length <= 3 ? sender : ${slice}***` branch leaked the full
      // value for 1-3 char inputs (e.g., "abc" was echoed verbatim into the
      // boot-time error -> Cloud Logging). Always mask.
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        INFOBIP_SENDER: 'abc',
        NODE_ENV: 'production',
      });

      try {
        new SmsService(configService, mockRedis as never);
        expect.fail('should throw');
      } catch (err) {
        const msg = (err as Error).message;
        // Full 3-char value must not appear verbatim.
        expect(msg).not.toContain('"abc"');
        // First 2 chars + *** is the canonical mask.
        expect(msg).toContain('ab***');
      }
    });

    it('[WR-03] production에서 INFOBIP_SENDER 길이 1-2 시에는 *** 전용 마스킹', () => {
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        INFOBIP_SENDER: 'x',
        NODE_ENV: 'production',
      });

      try {
        new SmsService(configService, mockRedis as never);
        expect.fail('should throw');
      } catch (err) {
        const msg = (err as Error).message;
        // Prefix would be the entire value — emit *** only.
        expect(msg).not.toContain('"x"');
        expect(msg).toContain('"***"');
      }
    });

    it('[WR-03] production에서 INFOBIP_SENDER가 숫자 4-15자리면 통과', () => {
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        INFOBIP_SENDER: '0212345678',
        NODE_ENV: 'production',
      });

      expect(() => new SmsService(configService, mockRedis as never)).not.toThrow();
    });

    it('[WR-03] production에서 INFOBIP_SENDER 에러 메시지는 sender 값을 마스킹 (로그 유출 방지)', () => {
      process.env['NODE_ENV'] = 'production';
      const configService = createConfigService({
        INFOBIP_SENDER: 'SECRETVALUE',
        NODE_ENV: 'production',
      });

      try {
        new SmsService(configService, mockRedis as never);
        expect.fail('should throw');
      } catch (err) {
        const msg = (err as Error).message;
        // Only first 2 chars leak as prefix; full value must not appear.
        expect(msg).not.toContain('SECRETVALUE');
        expect(msg).toContain('SE***');
      }
    });

    it('[WR-03] non-production에서는 INFOBIP_SENDER 형식 검사를 스킵', () => {
      // Dev-friendly: allow anything (including "TEST") in local/test envs.
      process.env['NODE_ENV'] = 'test';
      const configService = createConfigService({
        INFOBIP_SENDER: 'TESTSENDER',
        NODE_ENV: 'test',
      });

      expect(() => new SmsService(configService, mockRedis as never)).not.toThrow();
    });
  });

  // ---------- sendVerificationCode ----------
  describe('sendVerificationCode', () => {
    it.each([
      ['Korea local mobile', '01012345678', '+821012345678'],
      ['United States English fallback', '+14155552671', '+14155552671'],
      ['Thailand mobile', '+66812345678', '+66812345678'],
      ['Taiwan mobile', '+886912345678', '+886912345678'],
      ['Hong Kong mobile', '+85251234567', '+85251234567'],
    ])('launch market phone validation accepts %s', async (_label, phone, expectedE164) => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK');
      mockRedis.eval.mockResolvedValueOnce(1);

      vi.spyOn(nodeCrypto, 'randomInt').mockReturnValueOnce(123456);
      const sendSmsSpy = vi.spyOn(InfobipClient.prototype, 'sendSms').mockResolvedValueOnce({
        messageId: 'mid-launch',
        status: 'MESSAGE_ACCEPTED',
        groupId: 1,
      });

      const result = await service.sendVerificationCode(phone);

      expect(result.success).toBe(true);
      expect(sendSmsSpy).toHaveBeenCalledWith(
        expectedE164,
        formatSmsOtpMessage('123456', 'ko'),
      );
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('INCR'),
        expect.any(Number),
        smsSendCounterKey(expectedE164),
        expect.any(Number),
      );
    });

    it('mainland China phone parses strictly but is blocked before provider call', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      const sendSmsSpy = vi.spyOn(InfobipClient.prototype, 'sendSms');

      await expect(service.sendVerificationCode('+8613912345678')).rejects.toThrow(
        BadRequestException,
      );

      expect(sendSmsSpy).not.toHaveBeenCalled();
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(mockRedis.eval).not.toHaveBeenCalled();
    });

    it('[Phase 22-06] invalid-but-regex-valid international phone throws BadRequestException before side effects', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      const sendSmsSpy = vi.spyOn(InfobipClient.prototype, 'sendSms');

      await expect(service.sendVerificationCode('+9991234567')).rejects.toThrow(
        BadRequestException,
      );

      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(mockRedis.eval).not.toHaveBeenCalled();
      expect(mockRedis.pipeline).not.toHaveBeenCalled();
      expect(sendSmsSpy).not.toHaveBeenCalled();
    });

    it('중국 본토(+86) 번호 reject -- BadRequestException', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      await expect(service.sendVerificationCode('+8613912345678')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('dev mock에서 성공 반환 (Infobip 호출 없음)', async () => {
      const configService = createConfigService({
        INFOBIP_API_KEY: undefined,
        INFOBIP_BASE_URL: undefined,
        INFOBIP_SENDER: undefined,
      });
      const service = new SmsService(configService, mockRedis as never);
      const sendSmsSpy = vi.spyOn(InfobipClient.prototype, 'sendSms');

      const result = await service.sendVerificationCode('01012345678');
      expect(result.success).toBe(true);
      expect(sendSmsSpy).not.toHaveBeenCalled();
    });

    it('resend cooldown SET NX fail 시 HttpException(429)', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce(null); // NX fail = cooldown active
      mockRedis.pttl.mockResolvedValueOnce(25000);

      await expect(service.sendVerificationCode('+821012345678')).rejects.toThrow(
        HttpException,
      );
    });

    it('Infobip sendSms 성공 시 Valkey에 OTP 6자리 저장 ({sms:{e164}}:otp, TTL 180s)', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK'); // cooldown NX pass
      mockRedis.eval.mockResolvedValueOnce(1); // phone counter = 1 (within limit)

      vi.spyOn(nodeCrypto, 'randomInt').mockReturnValueOnce(654321);
      vi.spyOn(InfobipClient.prototype, 'sendSms').mockResolvedValueOnce({
        messageId: 'mid-123',
        status: 'MESSAGE_ACCEPTED',
        groupId: 1,
      });
      // OTP storage now goes through redis.pipeline().set(...).del(...).exec()
      // — see beforeEach for default exec resolution.

      const result = await service.sendVerificationCode('+821012345678');
      expect(result.success).toBe(true);
      expect(mockPipeline.set).toHaveBeenCalledWith(
        smsOtpKey('+821012345678'),
        '654321',
        'PX',
        180000,
      );
    });

    it('메시지 본문이 [Grabit] 인증번호 XXXXXX (3분 이내 입력) 포맷으로 전송됨', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK'); // cooldown NX pass
      mockRedis.eval.mockResolvedValueOnce(1); // phone counter OK

      vi.spyOn(nodeCrypto, 'randomInt').mockReturnValueOnce(654321);
      const sendSmsSpy = vi.spyOn(InfobipClient.prototype, 'sendSms').mockResolvedValueOnce({
        messageId: 'mid-456',
        status: 'MESSAGE_ACCEPTED',
        groupId: 1,
      });
      // OTP set via pipeline (default exec result from beforeEach)

      await service.sendVerificationCode('+821012345678');
      expect(sendSmsSpy).toHaveBeenCalledWith(
        '+821012345678',
        '[Grabit] 인증번호 654321 (3분 이내 입력)',
      );
    });

    it('OTP 생성 시 Math.random 대신 crypto.randomInt 사용', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK'); // cooldown NX pass
      mockRedis.eval.mockResolvedValueOnce(1); // phone counter OK

      const randomIntSpy = vi.spyOn(nodeCrypto, 'randomInt').mockReturnValueOnce(123456);
      vi.spyOn(InfobipClient.prototype, 'sendSms').mockResolvedValueOnce({
        messageId: 'mid-789',
        status: 'MESSAGE_ACCEPTED',
        groupId: 1,
      });
      // OTP set via pipeline (default exec result from beforeEach)

      await service.sendVerificationCode('+821012345678');
      expect(randomIntSpy).toHaveBeenCalledWith(100000, 1000000);
    });

    it('Infobip sendSms 5xx 시 cooldown key DEL rollback', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK'); // cooldown NX pass
      mockRedis.eval.mockResolvedValueOnce(1); // phone counter OK

      vi.spyOn(InfobipClient.prototype, 'sendSms').mockRejectedValueOnce(
        new InfobipApiError(500, 'Internal Server Error'),
      );

      await expect(service.sendVerificationCode('+821012345678')).rejects.toThrow();

      expect(mockRedis.del).toHaveBeenCalledWith(
        smsResendKey('+821012345678'),
      );
    });

    it('Infobip sendSms 4xx 시 cooldown key 유지 (DEL 미호출)', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK'); // cooldown NX pass
      mockRedis.eval.mockResolvedValueOnce(1); // phone counter OK

      vi.spyOn(InfobipClient.prototype, 'sendSms').mockRejectedValueOnce(
        new InfobipApiError(400, 'Bad Request'),
      );

      await expect(service.sendVerificationCode('+821012345678')).rejects.toThrow();

      expect(mockRedis.del).not.toHaveBeenCalledWith(
        smsResendKey('+821012345678'),
      );
    });

    // ---------- Issue 2 (PR #16 review): phone-axis send counter rollback ----------
    it('Infobip sendSms 5xx 시 send-count 카운터도 DECR rollback', async () => {
      // {sms:{e164}}:send-count (5/3600s) was INCR'd before calling Infobip
      // but never decremented when the call failed transiently. A series of
      // 5xx errors could exhaust the user's hourly quota despite no SMS
      // delivery.
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK'); // cooldown NX pass
      mockRedis.eval.mockResolvedValueOnce(1); // phone counter OK
      mockRedis.del.mockResolvedValueOnce(1); // cooldown DEL rollback resolves
      mockRedis.decr.mockResolvedValueOnce(0); // counter DECR rollback resolves

      vi.spyOn(InfobipClient.prototype, 'sendSms').mockRejectedValueOnce(
        new InfobipApiError(500, 'Internal Server Error'),
      );

      await expect(service.sendVerificationCode('+821012345678')).rejects.toThrow();

      expect(mockRedis.decr).toHaveBeenCalledWith(
        smsSendCounterKey('+821012345678'),
      );
    });

    it('Infobip sendSms 4xx 시 send-count 카운터 유지 (DECR 미호출, 악용 방지)', async () => {
      // 4xx (incl. groupId=5 REJECTED converted by InfobipClient) is a
      // permanent rejection. Keep the counter so an abuser can't rapid-fire
      // REJECTED responses to drain real users' quotas.
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK'); // cooldown NX pass
      mockRedis.eval.mockResolvedValueOnce(1); // phone counter OK

      vi.spyOn(InfobipClient.prototype, 'sendSms').mockRejectedValueOnce(
        new InfobipApiError(400, 'REJECTED'),
      );

      await expect(service.sendVerificationCode('+821012345678')).rejects.toThrow();

      expect(mockRedis.decr).not.toHaveBeenCalledWith(
        smsSendCounterKey('+821012345678'),
      );
    });

    it('non-InfobipApiError (network down 등) 시 send-count 카운터 DECR rollback', async () => {
      // Matches existing shouldRollback logic: !(err instanceof InfobipApiError)
      // || err.status >= 500. Network/timeout errors should release the slot.
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK'); // cooldown NX pass
      mockRedis.eval.mockResolvedValueOnce(1); // phone counter OK
      mockRedis.del.mockResolvedValueOnce(1); // cooldown DEL rollback resolves
      mockRedis.decr.mockResolvedValueOnce(0); // counter DECR rollback resolves

      vi.spyOn(InfobipClient.prototype, 'sendSms').mockRejectedValueOnce(
        new Error('network down'),
      );

      await expect(service.sendVerificationCode('+821012345678')).rejects.toThrow();

      expect(mockRedis.decr).toHaveBeenCalledWith(
        smsSendCounterKey('+821012345678'),
      );
    });

    it('phone axis send counter Lua INCR: 6번째 호출 429', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK'); // cooldown NX pass

      mockRedis.eval.mockResolvedValueOnce(6); // limit 5 초과

      await expect(service.sendVerificationCode('+821012345678')).rejects.toThrow(
        HttpException,
      );
    });

    it('phone axis send counter Lua에 send-count hash-tag 키 전달', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValue('OK'); // cooldown NX pass
      mockRedis.eval.mockResolvedValueOnce(1); // phone counter = 1

      vi.spyOn(nodeCrypto, 'randomInt').mockReturnValueOnce(999999);
      vi.spyOn(InfobipClient.prototype, 'sendSms').mockResolvedValueOnce({
        messageId: 'mid-000',
        status: 'MESSAGE_ACCEPTED',
        groupId: 1,
      });

      await service.sendVerificationCode('+821012345678');

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('INCR'),
        expect.any(Number),
        smsSendCounterKey('+821012345678'),
        expect.any(Number),
      );
    });

    // ---------- Issue 1 (PR #16 review): sms:attempts reset on new OTP ----------
    it('신규 OTP 저장 시 {sms:{e164}}:attempts를 함께 DEL (재발송 후 5회 시도 보장)', async () => {
      // {sms:{e164}}:attempts TTL is 900s (set inside VERIFY_AND_INCREMENT_LUA),
      // longer than OTP TTL 180s. Without this DEL, a user who failed N
      // attempts on OTP#1 and then re-sends would start OTP#2 with attempts=N
      // already counted — the very first verify on OTP#2 could trigger
      // NO_MORE_ATTEMPTS. The pipeline keeps SET + DEL adjacent.
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK'); // cooldown NX pass
      mockRedis.eval.mockResolvedValueOnce(1); // phone counter OK

      vi.spyOn(nodeCrypto, 'randomInt').mockReturnValueOnce(424242);
      vi.spyOn(InfobipClient.prototype, 'sendSms').mockResolvedValueOnce({
        messageId: 'mid-att',
        status: 'MESSAGE_ACCEPTED',
        groupId: 1,
      });

      const result = await service.sendVerificationCode('+821012345678');

      expect(result.success).toBe(true);
      // Pipeline used (single round trip)
      expect(mockRedis.pipeline).toHaveBeenCalled();
      // SET OTP with TTL 180s
      expect(mockPipeline.set).toHaveBeenCalledWith(
        smsOtpKey('+821012345678'),
        '424242',
        'PX',
        180000,
      );
      // DEL stale attempts counter
      expect(mockPipeline.del).toHaveBeenCalledWith(
        smsAttemptsKey('+821012345678'),
      );
      // Success path must NOT release the cooldown (handled separately)
      expect(mockRedis.del).not.toHaveBeenCalledWith(
        smsResendKey('+821012345678'),
      );
    });

    it('OTP pipeline exec 에러 시 Infobip sendSms 미호출 (보안: 미저장 OTP로 SMS 보내지 않음)', async () => {
      // Defense-in-depth: if Valkey is down at pipeline.exec(), the OTP was
      // never stored. We must NOT send the SMS — the user would receive a
      // code they cannot verify.
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.set.mockResolvedValueOnce('OK'); // cooldown NX pass
      mockRedis.eval.mockResolvedValueOnce(1); // phone counter OK
      // Pipeline exec reports an error on the SET op
      mockPipeline.exec.mockResolvedValueOnce([
        [new Error('valkey down'), null],
        [null, 1],
      ]);
      mockRedis.del.mockResolvedValueOnce(1); // cooldown DEL rollback resolves
      mockRedis.decr.mockResolvedValueOnce(0); // counter DECR rollback resolves

      const sendSmsSpy = vi.spyOn(InfobipClient.prototype, 'sendSms');

      await expect(service.sendVerificationCode('+821012345678')).rejects.toThrow();

      expect(sendSmsSpy).not.toHaveBeenCalled();
    });
  });

  // ---------- verifyCode ----------
  describe('verifyCode', () => {
    it('[Phase 22-06] invalid-but-regex-valid international phone throws BadRequestException before Valkey work', async () => {
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
        INFOBIP_API_KEY: undefined,
        INFOBIP_BASE_URL: undefined,
        INFOBIP_SENDER: undefined,
      });
      const service = new SmsService(configService, mockRedis as never);

      const result = await service.verifyCode('01012345678', '000000');
      expect(result.verified).toBe(true);
    });

    it('dev mock에서 잘못된 코드 실패', async () => {
      const configService = createConfigService({
        INFOBIP_API_KEY: undefined,
        INFOBIP_BASE_URL: undefined,
        INFOBIP_SENDER: undefined,
      });
      const service = new SmsService(configService, mockRedis as never);

      const result = await service.verifyCode('01012345678', '111111');
      expect(result.verified).toBe(false);
    });

    it('phone axis verify counter: 11번째 호출에서 429 (D-07)', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      mockRedis.eval.mockResolvedValueOnce(11); // limit 10 초과

      await expect(service.verifyCode('+821012345678', '123456')).rejects.toThrow(
        HttpException,
      );
    });

    it('Lua VERIFY_AND_INCREMENT 결과 ["VERIFIED", attempts] 시 verified: true + {sms:{e164}}:verified TTL 600s 저장', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      mockRedis.eval.mockResolvedValueOnce(1); // phone axis verify counter OK
      mockRedis.eval.mockResolvedValueOnce(['VERIFIED', 1]); // VERIFY_AND_INCREMENT result

      const result = await service.verifyCode('+821012345678', '123456');
      expect(result.verified).toBe(true);

      // Lua script includes SETEX for sms:verified internally,
      // or service calls redis.set for sms:verified key
      // Either way, the verify script must reference sms:verified pattern
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('KEYS'),
        expect.any(Number),
        smsOtpKey('+821012345678'),
        smsAttemptsKey('+821012345678'),
        smsVerifiedKey('+821012345678'),
        expect.any(String), // user code
        expect.any(String), // max attempts
        expect.any(String), // verified TTL
      );
    });

    it('Lua 결과 ["WRONG", remaining] 시 verified: false 반환', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      mockRedis.eval.mockResolvedValueOnce(1); // phone axis verify counter OK
      mockRedis.eval.mockResolvedValueOnce(['WRONG', 3]); // VERIFY_AND_INCREMENT result

      const result = await service.verifyCode('+821012345678', '000000');
      expect(result.verified).toBe(false);
      expect(result.message).toContain('인증번호가 일치하지 않습니다');
    });

    it('Lua 결과 ["EXPIRED", 0] 시 GoneException', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      mockRedis.eval.mockResolvedValueOnce(1); // phone axis verify counter OK
      mockRedis.eval.mockResolvedValueOnce(['EXPIRED', 0]); // VERIFY_AND_INCREMENT result

      await expect(service.verifyCode('+821012345678', '123456')).rejects.toThrow(
        GoneException,
      );
    });

    it('Lua 결과 ["NO_MORE_ATTEMPTS", 0] 시 GoneException', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      mockRedis.eval.mockResolvedValueOnce(1); // phone axis verify counter OK
      mockRedis.eval.mockResolvedValueOnce(['NO_MORE_ATTEMPTS', 0]); // VERIFY_AND_INCREMENT result

      await expect(service.verifyCode('+821012345678', '999999')).rejects.toThrow(
        GoneException,
      );
    });

    it('Infobip verifyPin을 호출하지 않는다 (Valkey Lua 자체 검증)', () => {
      expect(InfobipClient.prototype).not.toHaveProperty('verifyPin');
    });

    // ---------- WR-04: verify-counter rollback on Valkey eval failure ----------
    it('[WR-04] Lua eval 실패 시 verify-count 카운터 DECR rollback', async () => {
      // Transient Valkey failure (network blip, eval error) must release the
      // phone-axis verify slot that atomicIncr consumed before the Lua call.
      // Without this, each failure burns one of the user's 10/15min attempts
      // without delivering a verification outcome.
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      mockRedis.eval
        .mockResolvedValueOnce(1)                                    // phone-axis counter
        .mockRejectedValueOnce(new Error('valkey eval transient'));  // Lua fails
      mockRedis.decr.mockResolvedValueOnce(0); // rollback resolves

      const result = await service.verifyCode('+821012345678', '123456');

      expect(result.verified).toBe(false);
      expect(mockRedis.decr).toHaveBeenCalledWith(
        smsVerifyCounterKey('+821012345678'),
      );
    });

    it('[WR-04] GoneException은 verify 카운터를 rollback하지 않는다', async () => {
      // EXPIRED/NO_MORE_ATTEMPTS는 정상적인 검증 outcome이므로 카운터를 소모.
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      mockRedis.eval
        .mockResolvedValueOnce(1)                  // phone-axis counter
        .mockResolvedValueOnce(['EXPIRED', 0]);    // OTP expired (legit outcome)

      await expect(
        service.verifyCode('+821012345678', '123456'),
      ).rejects.toThrow(GoneException);

      // DECR must NOT have been called — this is a legitimate verify outcome.
      expect(mockRedis.decr).not.toHaveBeenCalledWith(
        smsVerifyCounterKey('+821012345678'),
      );
    });

    // ---------- WR-02: enumeration resistance on sms:verified flag ----------
    it('[WR-02] phone-axis 카운터는 Lua OTP 검증보다 먼저 INCR (enumeration 방지)', async () => {
      // If any verify branch runs before the rate-limit counter, an attacker
      // can probe arbitrary phones and learn which ones verified within the
      // last 10min based on the response shape. Ordering must be:
      // atomicIncr(phone_axis_verify) -> Lua VERIFY_AND_INCREMENT.
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      // First eval call = phone-axis counter returns 1 (within limit).
      // Second eval call = Lua VERIFY_AND_INCREMENT result.
      mockRedis.eval
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(['WRONG', 4]);

      const result = await service.verifyCode('+821012345678', '000000');
      expect(result.verified).toBe(false);

      // Counter must have been incremented for this phone, ordered first.
      expect(mockRedis.eval).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INCR'),
        expect.any(Number),
        smsVerifyCounterKey('+821012345678'),
        expect.any(Number),
      );
    });

    it('[WR-02] phone-axis 카운터 초과 시 429 (Lua 검증 미도달)', async () => {
      // Attacker-scenario regression: the 11th probe in the 15min window must
      // be rate-limited regardless of OTP state. Without counter-first
      // ordering, enumeration is unbounded.
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      mockRedis.eval.mockResolvedValueOnce(11); // counter > 10

      await expect(service.verifyCode('+821012345678', '000000')).rejects.toThrow(
        HttpException,
      );

      // Only the counter eval should have run; Lua VERIFY_AND_INCREMENT must not.
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    // ---------- CR-01: no short-circuit on sms:verified flag ----------
    it('[CR-01] {sms:{e164}}:verified 플래그가 세팅돼 있어도 잘못된 code는 거부 (impersonation 방지)', async () => {
      // PREVIOUS BUG: when `{sms:{e164}}:verified` == '1', verifyCode returned
      // `{ verified: true }` for ANY submitted code (including "000000") for
      // the 600s flag TTL. This allowed anyone who knew a recently-verified
      // phone to spoof verification on signup/password-reset.
      //
      // Fix: short-circuit removed. Every verify call must pass Lua
      // VERIFY_AND_INCREMENT with the correct stored OTP.
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      mockRedis.eval
        .mockResolvedValueOnce(1)                       // phone-axis counter
        .mockResolvedValueOnce(['WRONG', 4]);           // Lua: wrong code

      // Even if redis.get('{sms:...}:verified') would have returned '1'
      // (simulating a recently-verified phone), the code path must not
      // consult it — and must return verified:false for a wrong code.
      mockRedis.get.mockResolvedValue('1');

      const result = await service.verifyCode('+821012345678', '000000');

      expect(result.verified).toBe(false);
      // {sms:{e164}}:verified flag MUST NOT be consulted (no short-circuit path).
      expect(mockRedis.get).not.toHaveBeenCalledWith(
        expect.stringContaining(':verified'),
      );
    });

    it('[CR-01] {sms:{e164}}:verified 플래그가 세팅돼 있어도 올바른 Lua VERIFIED 응답만 verified:true', async () => {
      // Positive regression: the legitimate path still works — the Lua script
      // DEL'd OTP on first VERIFIED so idempotent re-verify against the same
      // OTP returns EXPIRED (GoneException). That is the documented trade-off
      // of the CR-01 short-term mitigation.
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);

      mockRedis.eval
        .mockResolvedValueOnce(1)                       // phone-axis counter
        .mockResolvedValueOnce(['EXPIRED', 0]);         // OTP already consumed

      // {sms:{e164}}:verified flag set from a prior verify.
      mockRedis.get.mockResolvedValue('1');

      await expect(
        service.verifyCode('+821012345678', '123456'),
      ).rejects.toThrow(GoneException);

      // Flag must not have short-circuited the GoneException.
      expect(mockRedis.get).not.toHaveBeenCalledWith(
        expect.stringContaining(':verified'),
      );
    });
  });

  // ---------- [hotfix 260427-kch] isPhoneVerified idempotency probe ----------
  describe('isPhoneVerified', () => {
    it('production에서 {sms:{e164}}:verified flag = "1" 이면 true 반환', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.get.mockResolvedValueOnce('1');

      const result = await service.isPhoneVerified('+821012345678');

      expect(result).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledWith(
        smsVerifiedKey('+821012345678'),
      );
    });

    it('production에서 flag 가 null 이면 false 반환', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.get.mockResolvedValueOnce(null);

      const result = await service.isPhoneVerified('+821012345678');

      expect(result).toBe(false);
    });

    it('dev mock 모드에서는 Redis 호출 없이 false 반환', async () => {
      const configService = createConfigService({
        INFOBIP_API_KEY: undefined,
        INFOBIP_BASE_URL: undefined,
        INFOBIP_SENDER: undefined,
      });
      const service = new SmsService(configService, mockRedis as never);
      // Reset call history specifically for redis.get so prior tests do not leak.
      mockRedis.get.mockClear();

      const result = await service.isPhoneVerified('01012345678');

      expect(result).toBe(false);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('Redis get 실패 시 false 반환 (fail closed)', async () => {
      const configService = createConfigService();
      const service = new SmsService(configService, mockRedis as never);
      mockRedis.get.mockRejectedValueOnce(new Error('valkey down'));

      const result = await service.isPhoneVerified('+821012345678');

      expect(result).toBe(false);
    });
  });

  // ---------- WR-02: Hash-tag key builders assert E.164 at the boundary ----------
  describe('[WR-02] hash-tag key builders reject non-E.164 input', () => {
    // Redis Cluster hashes on the content between the first `{` and the next
    // `}`. If a caller bypasses parseE164() and passes a malformed string,
    // characters like `}` or `{` would terminate the hash-tag early, splitting
    // the 3-key OTP set across slots and silently resurrecting CROSSSLOT.
    // The per-builder assertion turns that into a loud, local failure.

    it.each([
      ['empty string', ''],
      ['missing plus', '821012345678'],
      ['curly-brace injection', '}x:+821012345678'],
      ['letters', '+821ABCDEFGH'],
      ['too short', '+12345'],
      ['too long', '+1234567890123456'],
      ['whitespace', '+82 10 1234 5678'],
      ['hyphens', '+82-10-1234-5678'],
    ])('smsOtpKey throws on %s', (_label, bad) => {
      expect(() => smsOtpKey(bad)).toThrow(/non-E164 key input/);
    });

    it.each([
      ['empty string', ''],
      ['curly-brace injection', '}x:+821012345678'],
    ])('smsAttemptsKey throws on %s', (_label, bad) => {
      expect(() => smsAttemptsKey(bad)).toThrow(/non-E164 key input/);
    });

    it.each([
      ['empty string', ''],
      ['curly-brace injection', '}x:+821012345678'],
    ])('smsVerifiedKey throws on %s', (_label, bad) => {
      expect(() => smsVerifiedKey(bad)).toThrow(/non-E164 key input/);
    });

    it.each([
      ['empty string', ''],
      ['missing plus', '821012345678'],
    ])('smsResendKey throws on %s', (_label, bad) => {
      expect(() => smsResendKey(bad)).toThrow(/non-E164 key input/);
    });

    it.each([
      ['empty string', ''],
      ['missing plus', '821012345678'],
    ])('smsSendCounterKey throws on %s', (_label, bad) => {
      expect(() => smsSendCounterKey(bad)).toThrow(/non-E164 key input/);
    });

    it.each([
      ['empty string', ''],
      ['missing plus', '821012345678'],
    ])('smsVerifyCounterKey throws on %s', (_label, bad) => {
      expect(() => smsVerifyCounterKey(bad)).toThrow(/non-E164 key input/);
    });

    it('error message masks the subscriber number (keeps only country-code prefix)', () => {
      // +821012345678 → first 4 chars "+821" leak as triage context, rest is
      // "***". The full number must never appear in the error text (it lands
      // in Cloud Logging via logger.error / Sentry).
      try {
        // Force a failure by passing a value that fails the regex (too short)
        // so we can inspect the mask shape.
        smsOtpKey('+8210xBAD');
        expect.fail('should throw');
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain('+821***');
        expect(msg).not.toContain('xBAD');
      }
    });

    it.each([
      ['KR mobile', '+821012345678'],
      ['US number', '+13125551234'],
      ['HK number', '+85212345678'],
    ])('valid E.164 input (%s) passes through', (_label, good) => {
      expect(() => smsOtpKey(good)).not.toThrow();
      expect(() => smsAttemptsKey(good)).not.toThrow();
      expect(() => smsVerifiedKey(good)).not.toThrow();
      expect(() => smsResendKey(good)).not.toThrow();
      expect(() => smsSendCounterKey(good)).not.toThrow();
      expect(() => smsVerifyCounterKey(good)).not.toThrow();
    });
  });
});
