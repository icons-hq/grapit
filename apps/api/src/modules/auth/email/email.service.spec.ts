import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service.js';

// Mock the resend module — hoisted by vitest so the import in email.service picks up the mock
vi.mock('resend', () => {
  const sendMock = vi.fn();
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: { send: sendMock },
    })),
    __sendMock: sendMock,
  };
});

vi.mock('@sentry/nestjs', () => {
  const captureExceptionMock = vi.fn();
  const scopeStub = {
    setTag: vi.fn(),
    setLevel: vi.fn(),
    setContext: vi.fn(),
  };
  const withScopeMock = vi.fn((cb: (scope: typeof scopeStub) => void) => {
    cb(scopeStub);
  });
  return {
    captureException: captureExceptionMock,
    withScope: withScopeMock,
    __captureExceptionMock: captureExceptionMock,
    __withScopeMock: withScopeMock,
    __scopeStub: scopeStub,
  };
});

import * as resendModule from 'resend';
import * as sentryModule from '@sentry/nestjs';

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: vi.fn(<T>(key: string, defaultValue?: T): T | undefined => {
      const v = env[key];
      return (v !== undefined ? v : defaultValue) as T | undefined;
    }),
  } as unknown as ConfigService;
}

describe('EmailService', () => {
  const sentryMod = sentryModule as unknown as {
    __captureExceptionMock: ReturnType<typeof vi.fn>;
    __withScopeMock: ReturnType<typeof vi.fn>;
    __scopeStub: {
      setTag: ReturnType<typeof vi.fn>;
      setLevel: ReturnType<typeof vi.fn>;
      setContext: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DEV mode: no RESEND_API_KEY + NODE_ENV=development → returns success without calling Resend', async () => {
    const config = makeConfig({ NODE_ENV: 'development' });
    const svc = new EmailService(config);
    const result = await svc.sendPasswordResetEmail('user@example.com', 'https://app.test/reset?t=abc');
    expect(result).toEqual({ success: true });
    expect((resendModule as unknown as { Resend: ReturnType<typeof vi.fn> }).Resend).not.toHaveBeenCalled();
    expect(sentryMod.__captureExceptionMock).not.toHaveBeenCalled();
  });

  it('PROD mode: RESEND_API_KEY + RESEND_FROM_EMAIL set + NODE_ENV=production → calls Resend.emails.send with react template and correct from', async () => {
    const config = makeConfig({
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM_EMAIL: 'no-reply@heygrabit.com',
      NODE_ENV: 'production',
    });
    const mod = resendModule as unknown as { __sendMock: ReturnType<typeof vi.fn> };
    mod.__sendMock.mockResolvedValueOnce({ data: { id: 'mock-id' }, error: null });

    const svc = new EmailService(config);
    const result = await svc.sendPasswordResetEmail('user@example.com', 'https://app.test/reset?t=abc');

    expect(mod.__sendMock).toHaveBeenCalledTimes(1);
    const callArg = mod.__sendMock.mock.calls[0]?.[0] as { from: string; to: string; subject: string; react: unknown };
    expect(callArg.from).toBe('no-reply@heygrabit.com');
    expect(callArg.to).toBe('user@example.com');
    expect(callArg.subject).toContain('비밀번호 재설정');
    expect(callArg.react).toBeDefined();
    expect(result).toEqual({ success: true, id: 'mock-id' });
    expect(sentryMod.__captureExceptionMock).not.toHaveBeenCalled();
  });

  it('PROD mode: sendEmailVerificationEmail uses localized verification copy and react template', async () => {
    const config = makeConfig({
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM_EMAIL: 'no-reply@heygrabit.com',
      NODE_ENV: 'production',
    });
    const svc = new EmailService(config);
    const sendEmailVerificationEmail = (svc as unknown as {
      sendEmailVerificationEmail?: (to: string, verificationCode: string, locale: string) => Promise<unknown>;
    }).sendEmailVerificationEmail;
    expect(sendEmailVerificationEmail).toEqual(expect.any(Function));

    const mod = resendModule as unknown as { __sendMock: ReturnType<typeof vi.fn> };
    mod.__sendMock.mockResolvedValueOnce({ data: { id: 'verification-id' }, error: null });
    const result = await sendEmailVerificationEmail!.call(
      svc,
      'user@example.com',
      '123456',
      'zh-TW',
    );

    const callArg = mod.__sendMock.mock.calls[0]?.[0] as { subject: string; react: unknown };
    expect(callArg.subject).toContain('Grabit');
    expect(callArg.subject).toContain('驗證');
    expect(callArg.react).toBeDefined();
    expect(result).toEqual({ success: true, id: 'verification-id' });
  });

  it('DEV mode: sendEmailVerificationEmail does not log the raw verification code', async () => {
    const config = makeConfig({ NODE_ENV: 'development' });
    const logSpy = vi.spyOn(Logger.prototype, 'log');
    const svc = new EmailService(config);
    const sendEmailVerificationEmail = (svc as unknown as {
      sendEmailVerificationEmail?: (to: string, verificationCode: string, locale: string) => Promise<unknown>;
    }).sendEmailVerificationEmail;
    expect(sendEmailVerificationEmail).toEqual(expect.any(Function));

    await sendEmailVerificationEmail!.call(
      svc,
      'user@example.com',
      '987654',
      'ko',
    );

    const serializedLogs = JSON.stringify(logSpy.mock.calls);
    expect(serializedLogs).not.toContain('987654');

    logSpy.mockRestore();
  });

  it('PROD misconfig (API_KEY): no RESEND_API_KEY + NODE_ENV=production → throws on construction', () => {
    const config = makeConfig({ NODE_ENV: 'production' });
    expect(() => new EmailService(config)).toThrow(/RESEND_API_KEY is required outside development\/test environments/);
  });

  it('PROD misconfig (FROM_EMAIL unset): RESEND_API_KEY set + RESEND_FROM_EMAIL unset + NODE_ENV=production → throws on construction', () => {
    const config = makeConfig({ RESEND_API_KEY: 're_test_key', NODE_ENV: 'production' });
    expect(() => new EmailService(config)).toThrow(/RESEND_FROM_EMAIL must be a valid email outside development\/test/);
  });

  it('PROD misconfig (FROM_EMAIL invalid): RESEND_API_KEY set + RESEND_FROM_EMAIL is not an email + NODE_ENV=production → throws on construction', () => {
    const config = makeConfig({
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM_EMAIL: 'not-an-email',
      NODE_ENV: 'production',
    });
    expect(() => new EmailService(config)).toThrow(/RESEND_FROM_EMAIL must be a valid email outside development\/test/);
  });

  it('STAGING misconfig (API_KEY): no RESEND_API_KEY + NODE_ENV=staging → throws on construction (tightened guard)', () => {
    const config = makeConfig({ NODE_ENV: 'staging' });
    expect(() => new EmailService(config)).toThrow(/RESEND_API_KEY is required outside development\/test environments/);
  });

  it('TEST mode: no RESEND_API_KEY + NODE_ENV=test → constructs successfully in DEV MOCK mode', () => {
    const config = makeConfig({ NODE_ENV: 'test' });
    expect(() => new EmailService(config)).not.toThrow();
  });

  it('PROD non-retryable error: Resend returns { error } → returns { success: false, error } without retry', async () => {
    const config = makeConfig({
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM_EMAIL: 'no-reply@heygrabit.com',
      NODE_ENV: 'production',
    });
    const mod = resendModule as unknown as { __sendMock: ReturnType<typeof vi.fn> };
    mod.__sendMock.mockResolvedValueOnce({ data: null, error: { message: 'permanent error' } });

    const svc = new EmailService(config);
    const result = await svc.sendPasswordResetEmail('user@example.com', 'https://app.test/reset?t=abc');

    expect(mod.__sendMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: false, error: 'permanent error' });
  });

  it('PROD non-retryable error: Sentry.captureException called with Error wrapping Resend error.message', async () => {
    const config = makeConfig({
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM_EMAIL: 'no-reply@heygrabit.com',
      NODE_ENV: 'production',
    });
    const mod = resendModule as unknown as { __sendMock: ReturnType<typeof vi.fn> };
    mod.__sendMock.mockResolvedValueOnce({ data: null, error: { message: 'permanent error' } });

    const svc = new EmailService(config);
    await svc.sendPasswordResetEmail('user@example.com', 'https://app.test/reset?t=abc');

    expect(sentryMod.__withScopeMock).toHaveBeenCalledTimes(1);
    expect(sentryMod.__captureExceptionMock).toHaveBeenCalledTimes(1);
    const capturedArg = sentryMod.__captureExceptionMock.mock.calls[0]?.[0];
    expect(capturedArg).toBeInstanceOf(Error);
    expect((capturedArg as Error).message).toContain('Resend send failed');
    expect((capturedArg as Error).message).toContain('permanent error');
  });

  it('PROD non-retryable error: PII masking — setContext receives toDomain only, not full address', async () => {
    const config = makeConfig({
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM_EMAIL: 'no-reply@heygrabit.com',
      NODE_ENV: 'production',
    });
    const mod = resendModule as unknown as { __sendMock: ReturnType<typeof vi.fn> };
    mod.__sendMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    const svc = new EmailService(config);
    await svc.sendPasswordResetEmail('user@example.com', 'https://app.test/reset?t=abc');

    expect(sentryMod.__scopeStub.setContext).toHaveBeenCalledWith('email', {
      from: 'no-reply@heygrabit.com',
      toDomain: 'example.com',
      attempts: 1,
    });
    const allSetContextCalls = sentryMod.__scopeStub.setContext.mock.calls;
    const allSetTagCalls = sentryMod.__scopeStub.setTag.mock.calls;
    const serialized = JSON.stringify([allSetContextCalls, allSetTagCalls]);
    expect(serialized).not.toContain('user@example.com');
    expect(sentryMod.__scopeStub.setTag).toHaveBeenCalledWith('component', 'email-service');
    expect(sentryMod.__scopeStub.setTag).toHaveBeenCalledWith('provider', 'resend');
    expect(sentryMod.__scopeStub.setLevel).toHaveBeenCalledWith('error');
  });

  // [WR-01] Bounded retry behaviour for transient Resend failures.
  describe('retry on transient errors', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('PROD retryable error: rate_limit_exceeded on attempt 1 → backoff → succeeds on attempt 2 (no Sentry capture)', async () => {
      const config = makeConfig({
        RESEND_API_KEY: 're_test_key',
        RESEND_FROM_EMAIL: 'no-reply@heygrabit.com',
        NODE_ENV: 'production',
      });
      const mod = resendModule as unknown as { __sendMock: ReturnType<typeof vi.fn> };
      mod.__sendMock
        .mockResolvedValueOnce({ data: null, error: { message: 'rate_limit_exceeded' } })
        .mockResolvedValueOnce({ data: { id: 'mock-id-2' }, error: null });

      const svc = new EmailService(config);
      const promise = svc.sendPasswordResetEmail('user@example.com', 'https://app.test/reset?t=abc');

      // Drain attempt 1 + 250ms backoff + attempt 2.
      await vi.advanceTimersByTimeAsync(250);
      const result = await promise;

      expect(mod.__sendMock).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true, id: 'mock-id-2' });
      expect(sentryMod.__captureExceptionMock).not.toHaveBeenCalled();
    });

    it('PROD retryable error: 503 on every attempt → exhausts MAX_SEND_ATTEMPTS=3 → captures Sentry with attempts=3', async () => {
      const config = makeConfig({
        RESEND_API_KEY: 're_test_key',
        RESEND_FROM_EMAIL: 'no-reply@heygrabit.com',
        NODE_ENV: 'production',
      });
      const mod = resendModule as unknown as { __sendMock: ReturnType<typeof vi.fn> };
      mod.__sendMock.mockResolvedValue({ data: null, error: { message: 'upstream 503 service unavailable' } });

      const svc = new EmailService(config);
      const promise = svc.sendPasswordResetEmail('user@example.com', 'https://app.test/reset?t=abc');

      // Drain 250ms + 500ms backoffs (between attempts 1→2 and 2→3).
      await vi.advanceTimersByTimeAsync(750);
      const result = await promise;

      expect(mod.__sendMock).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ success: false, error: 'upstream 503 service unavailable' });
      expect(sentryMod.__captureExceptionMock).toHaveBeenCalledTimes(1);
      expect(sentryMod.__scopeStub.setContext).toHaveBeenCalledWith('email', {
        from: 'no-reply@heygrabit.com',
        toDomain: 'example.com',
        attempts: 3,
      });
    });

    it('PROD non-retryable error: does not retry → exactly 1 send call, immediate Sentry capture', async () => {
      const config = makeConfig({
        RESEND_API_KEY: 're_test_key',
        RESEND_FROM_EMAIL: 'no-reply@heygrabit.com',
        NODE_ENV: 'production',
      });
      const mod = resendModule as unknown as { __sendMock: ReturnType<typeof vi.fn> };
      mod.__sendMock.mockResolvedValue({ data: null, error: { message: 'invalid recipient' } });

      const svc = new EmailService(config);
      const promise = svc.sendPasswordResetEmail('user@example.com', 'https://app.test/reset?t=abc');

      // No backoff expected — non-retryable returns on attempt 1. Advance timers anyway to be sure.
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;

      expect(mod.__sendMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: false, error: 'invalid recipient' });
      expect(sentryMod.__captureExceptionMock).toHaveBeenCalledTimes(1);
      expect(sentryMod.__scopeStub.setContext).toHaveBeenCalledWith('email', {
        from: 'no-reply@heygrabit.com',
        toDomain: 'example.com',
        attempts: 1,
      });
    });
  });
});
