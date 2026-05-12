import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 10.1: Twilio Verify env(ACCOUNT_SID/API_KEY/VERIFY_SERVICE_SID)으로 mock 마이그레이션.
// Infobip env는 더 이상 사용되지 않음.

/**
 * Unit tests for sms.controller.ts Plan 10-06 changes:
 * 1. @Throttle decorators on sendCode (20/3600000ms) and verifyCode (10/900000ms)
 * 2. sendCodeSchema accepts both Korean local and E.164 international numbers
 * 3. sms.service.ts phone axis 429 uses HttpException (not BadRequestException)
 */

// ---- 1. Decorator metadata tests ----
// @nestjs/throttler v6 stores metadata per-name: 'THROTTLER:LIMIT' + name -> value
// For @Throttle({ default: { limit: 20, ttl: 3_600_000 } }):
//   'THROTTLER:LIMITdefault' -> 20, 'THROTTLER:TTLdefault' -> 3_600_000
describe('SmsController @Throttle decorators', () => {
  it('sendCode has @Throttle with limit:20, ttl:3600000', async () => {
    const { SmsController } = await import('./sms.controller.js');
    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', SmsController.prototype.sendCode);
    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', SmsController.prototype.sendCode);
    expect(limit).toBe(20);
    expect(ttl).toBe(3_600_000);
  });

  it('verifyCode has @Throttle with limit:10, ttl:900000', async () => {
    const { SmsController } = await import('./sms.controller.js');
    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', SmsController.prototype.verifyCode);
    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', SmsController.prototype.verifyCode);
    expect(limit).toBe(10);
    expect(ttl).toBe(900_000);
  });
});

// ---- 2. sendCodeSchema international phone tests ----
describe('sendCodeSchema phone validation', () => {
  it('accepts Korean local number 01012345678', async () => {
    const { sendCodeSchema } = await import('./sms.controller.js');
    const result = sendCodeSchema.safeParse({ phone: '01012345678' });
    expect(result.success).toBe(true);
  });

  it('accepts Korean local number 01112345678', async () => {
    const { sendCodeSchema } = await import('./sms.controller.js');
    const result = sendCodeSchema.safeParse({ phone: '01112345678' });
    expect(result.success).toBe(true);
  });

  it('accepts E.164 international number +821012345678', async () => {
    const { sendCodeSchema } = await import('./sms.controller.js');
    const result = sendCodeSchema.safeParse({ phone: '+821012345678' });
    expect(result.success).toBe(true);
  });

  it('accepts E.164 international number +14155551234', async () => {
    const { sendCodeSchema } = await import('./sms.controller.js');
    const result = sendCodeSchema.safeParse({ phone: '+14155551234' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid phone number', async () => {
    const { sendCodeSchema } = await import('./sms.controller.js');
    const result = sendCodeSchema.safeParse({ phone: '12345' });
    expect(result.success).toBe(false);
  });

  it('rejects empty string', async () => {
    const { sendCodeSchema } = await import('./sms.controller.js');
    const result = sendCodeSchema.safeParse({ phone: '' });
    expect(result.success).toBe(false);
  });

  it('rejects + without country code', async () => {
    const { sendCodeSchema } = await import('./sms.controller.js');
    const result = sendCodeSchema.safeParse({ phone: '+0123456789' });
    expect(result.success).toBe(false);
  });
});

// ---- 3. sms.service.ts 429 HttpException tests ----
describe('SmsService phone axis 429 uses HttpException', () => {
  it('sendVerificationCode phone axis limit throws HTTP 429 (not 400)', async () => {
    // We need to verify the thrown exception has HTTP status 429
    const { HttpException } = await import('@nestjs/common');

    // Mock Redis that returns count > 5 for send phone axis
    const mockRedis = {
      set: vi.fn().mockResolvedValue('OK'), // cooldown passes
      eval: vi.fn().mockResolvedValue(6), // count=6 > limit=5
      pttl: vi.fn().mockResolvedValue(3000),
    };

    const { SmsService } = await import('./sms.service.js');
    const mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        const env: Record<string, string> = {
          TWILIO_ACCOUNT_SID: 'AC_test',
          TWILIO_API_KEY_SID: 'SK_test',
          TWILIO_API_KEY_SECRET: 'test-secret',
          TWILIO_VERIFY_SERVICE_SID: 'VA_test',
        };
        return env[key];
      }),
    };

    // @ts-expect-error partial mock
    const service = new SmsService(mockConfigService, mockRedis);
    try {
      await service.sendVerificationCode('+821012345678');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      // HTTP status should be 429, not 400
      expect((err as HttpException).getStatus()).toBe(429);
    }
  });

  it('verifyCode phone axis limit throws HTTP 429 (not 400)', async () => {
    const { HttpException } = await import('@nestjs/common');

    // Mock Redis that returns count > 10 for verify phone axis
    const mockRedis = {
      get: vi.fn().mockResolvedValue(null), // no prior verified flag
      eval: vi.fn().mockResolvedValue(11), // count=11 > limit=10
    };

    const { SmsService } = await import('./sms.service.js');
    const mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        const env: Record<string, string> = {
          TWILIO_ACCOUNT_SID: 'AC_test',
          TWILIO_API_KEY_SID: 'SK_test',
          TWILIO_API_KEY_SECRET: 'test-secret',
          TWILIO_VERIFY_SERVICE_SID: 'VA_test',
        };
        return env[key];
      }),
    };

    // @ts-expect-error partial mock
    const service = new SmsService(mockConfigService, mockRedis);
    try {
      await service.verifyCode('+821012345678', '123456');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
    }
  });

  it('sendVerificationCode resend cooldown throws HTTP 429 (not 400)', async () => {
    const { HttpException } = await import('@nestjs/common');

    // Mock Redis: cooldown SET NX returns null (already exists)
    const mockRedis = {
      set: vi.fn().mockResolvedValue(null), // cooldown blocked
      pttl: vi.fn().mockResolvedValue(25000),
    };

    const { SmsService } = await import('./sms.service.js');
    const mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        const env: Record<string, string> = {
          TWILIO_ACCOUNT_SID: 'AC_test',
          TWILIO_API_KEY_SID: 'SK_test',
          TWILIO_API_KEY_SECRET: 'test-secret',
          TWILIO_VERIFY_SERVICE_SID: 'VA_test',
        };
        return env[key];
      }),
    };

    // @ts-expect-error partial mock
    const service = new SmsService(mockConfigService, mockRedis);
    try {
      await service.sendVerificationCode('+821012345678');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
    }
  });
});
