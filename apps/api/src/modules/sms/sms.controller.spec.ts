import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 10.1: Twilio Verify env(ACCOUNT_SID/API_KEY/VERIFY_SERVICE_SID)으로 mock 마이그레이션.
// Infobip env는 더 이상 사용되지 않음.

/**
 * Unit tests for sms.controller.ts Plan 10-06 changes:
 * 1. Hotfix 260517 skips signup SMS IP throttling
 * 2. sendCodeSchema accepts both Korean local and E.164 international numbers
 * 3. sms.service.ts keeps IP-independent app-side SMS limits (audit #36)
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

// ---- 3. sms.service.ts app-side SMS limits (audit #36) ----
function twilioConfig(overrides: Record<string, string> = {}) {
  const env: Record<string, string> = {
    TWILIO_ACCOUNT_SID: 'AC_test',
    TWILIO_API_KEY_SID: 'SK_test',
    TWILIO_API_KEY_SECRET: 'test-secret',
    TWILIO_VERIFY_SERVICE_SID: 'VA_test',
    ...overrides,
  };
  return { get: vi.fn().mockImplementation((key: string) => env[key]) };
}

describe('SmsService app-side SMS limits', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('enforces the per-phone resend cooldown by default even though the controller skips IP throttling', async () => {
    const { HttpException } = await import('@nestjs/common');
    const mockRedis = {
      set: vi.fn().mockResolvedValue(null),
      eval: vi.fn().mockResolvedValue(1),
      pttl: vi.fn().mockResolvedValue(25_000),
    };

    const { SmsService } = await import('./sms.service.js');
    const { TwilioVerifyClient } = await import('./twilio-verify-client.js');
    const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification');

    // @ts-expect-error partial mock
    const service = new SmsService(twilioConfig(), mockRedis);
    const error = await service.sendVerificationCode('+821012345678').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as InstanceType<typeof HttpException>).getStatus()).toBe(429);
    expect((error as InstanceType<typeof HttpException>).getResponse()).toMatchObject({
      retryAfterMs: 25_000,
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('enforces the per-phone verify limit by default', async () => {
    const { HttpException } = await import('@nestjs/common');
    const mockRedis = {
      set: vi.fn().mockResolvedValue('OK'),
      // send-code left the pending marker, so the verify limit is reached.
      get: vi.fn().mockResolvedValue('1'),
      eval: vi.fn().mockResolvedValue(11),
    };

    const { SmsService } = await import('./sms.service.js');
    const { TwilioVerifyClient } = await import('./twilio-verify-client.js');
    const checkSpy = vi.spyOn(TwilioVerifyClient.prototype, 'checkVerification');

    // @ts-expect-error partial mock
    const service = new SmsService(twilioConfig(), mockRedis);
    const error = await service.verifyCode('+821012345678', '123456').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as InstanceType<typeof HttpException>).getStatus()).toBe(429);
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it('SMS_LOCAL_RATE_LIMITS_ENABLED=false bypasses only the per-phone limits, not the global send budgets', async () => {
    const mockRedis = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
      pttl: vi.fn().mockResolvedValue(3000),
    };

    const { SmsService, smsPendingVerificationKey } = await import('./sms.service.js');
    const { TwilioVerifyClient } = await import('./twilio-verify-client.js');
    const sendSpy = vi.spyOn(TwilioVerifyClient.prototype, 'sendVerification')
      .mockResolvedValueOnce({
        sid: 'VE_kill_switch',
        status: 'pending',
        channel: 'sms',
      });

    // @ts-expect-error partial mock
    const service = new SmsService(twilioConfig({ SMS_LOCAL_RATE_LIMITS_ENABLED: 'false' }), mockRedis);
    const result = await service.sendVerificationCode('+821012345678');

    expect(result.success).toBe(true);
    expect(sendSpy).toHaveBeenCalledWith('+821012345678');
    // No resend cooldown; only the pending marker verify-code needs.
    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalledWith(
      smsPendingVerificationKey('+821012345678'), '1', 'PX', 600_000, 'NX',
    );
    expect(mockRedis.eval).toHaveBeenCalledTimes(2);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      expect.stringMatching(/^sms:global-send:\d+$/),
      120,
    );
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      expect.stringMatching(/^sms:global-send-hour:\d+$/),
      7_200,
    );
  });
});
