import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 10.1: Twilio Verify env(ACCOUNT_SID/API_KEY/VERIFY_SERVICE_SID)으로 mock 마이그레이션.
// Infobip env는 더 이상 사용되지 않음.

/**
 * Unit tests for sms.controller.ts Plan 10-06 changes:
 * 1. Hotfix 260517 skips signup SMS IP throttling
 * 2. sendCodeSchema accepts both Korean local and E.164 international numbers
 * 3. sms.service.ts local SMS rate limits are bypassed for signup recovery
 */

// ---- 1. Decorator metadata tests ----
const DEFAULT_SKIP_METADATA = 'THROTTLER:SKIPdefault';

describe('SmsController @SkipThrottle decorators', () => {
  it('sendCode skips the default throttler', async () => {
    const { SmsController } = await import('./sms.controller.js');
    expect(Reflect.getMetadata(DEFAULT_SKIP_METADATA, SmsController.prototype.sendCode))
      .toBe(true);
  });

  it('verifyCode skips the default throttler', async () => {
    const { SmsController } = await import('./sms.controller.js');
    expect(Reflect.getMetadata(DEFAULT_SKIP_METADATA, SmsController.prototype.verifyCode))
      .toBe(true);
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

// ---- 3. sms.service.ts local SMS rate limit bypass tests ----
describe('SmsService local SMS rate limit hotfix', () => {
  it('sendVerificationCode does not block on local cooldown or phone-axis counters', async () => {
    const mockRedis = {
      set: vi.fn().mockResolvedValue(null),
      eval: vi.fn().mockResolvedValue(999),
      pttl: vi.fn().mockResolvedValue(3000),
    };

    const { SmsService } = await import('./sms.service.js');
    const { TwilioVerifyClient } = await import('./twilio-verify-client.js');
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
    const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
      .mockResolvedValueOnce({
        sid: 'VE_hotfix',
        status: 'pending',
        channel: 'sms',
      });

    // @ts-expect-error partial mock
    const service = new SmsService(mockConfigService, mockRedis);
    const result = await service.sendVerificationCode('+821012345678');

    expect(result.success).toBe(true);
    expect(sendSpy).toHaveBeenCalledWith('+821012345678');
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it('verifyCode does not block on local phone-axis counters', async () => {
    const mockRedis = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(999),
    };

    const { SmsService } = await import('./sms.service.js');
    const { TwilioVerifyClient } = await import('./twilio-verify-client.js');
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
    vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification')
      .mockResolvedValueOnce({
        sid: 'VE_hotfix',
        status: 'approved',
        valid: true,
      });

    // @ts-expect-error partial mock
    const service = new SmsService(mockConfigService, mockRedis);
    const result = await service.verifyCode('+821012345678', '123456');

    expect(result.verified).toBe(true);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });
});
