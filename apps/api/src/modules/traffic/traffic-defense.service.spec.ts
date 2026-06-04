import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SECURITY_BLOCKED,
  SECURITY_CHALLENGE_REQUIRED,
  TRAFFIC_RATE_LIMITED,
  TrafficDefenseService,
} from './traffic-defense.service.js';

function createRequest(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    originalUrl: '/api/v1/booking/seats/lock',
    headers: {},
    cookies: {},
    body: {},
    query: {},
    ip: '203.0.113.10',
    socket: {
      remoteAddress: '203.0.113.10',
    },
    ...overrides,
  };
}

describe('TrafficDefenseService', () => {
  it('defines the booking-critical throttler policies', () => {
    const service = new TrafficDefenseService();

    expect(service.getThrottlerOptions().map((policy) => policy.name)).toEqual(
      expect.arrayContaining([
        'queue-entry',
        'lock-seat',
        'prepare-reservation',
        'confirm-payment',
        'signup',
      ]),
    );
  });

  it('does not apply traffic-defense throttling to signup SMS verification endpoints', () => {
    const service = new TrafficDefenseService();

    expect(service.getThrottlerOptions().map((policy) => policy.name)).not.toContain('sms');
  });

  it('does not count CORS preflight requests against queue-entry throttling', () => {
    const service = new TrafficDefenseService();
    const queueEntry = service
      .getThrottlerOptions()
      .find((policy) => policy.name === 'queue-entry');

    expect(
      queueEntry?.skipIf?.(
        createExecutionContext(
          createRequest({
            method: 'OPTIONS',
            originalUrl:
              '/api/v1/queue/performances/18a3bcc6-5e75-463d-abfd-634601328754/enter',
          }),
        ),
      ),
    ).toBe(true);
  });

  it('uses authenticated userId first for queue-entry tracker resolution', () => {
    const service = new TrafficDefenseService();

    const tracker = service.resolveTracker(
      'queue-entry',
      createRequest({
        method: 'GET',
        originalUrl: '/api/v1/queue/entry',
        user: { id: 'user-1' },
        cookies: { refreshToken: 'refresh-cookie' },
      }),
    );

    expect(tracker).toContain('queue-entry');
    expect(tracker).toContain('user:user-1');
  });

  it('uses authenticated userId first for the global default throttler', () => {
    const service = new TrafficDefenseService();

    const tracker = service.resolveDefaultTracker(
      createRequest({
        user: { id: 'user-1' },
        cookies: { refreshToken: 'refresh-cookie' },
      }),
    );

    expect(tracker).toBe('default:user:user-1');
  });

  it('does not count CORS preflight requests against the global default throttler', () => {
    const service = new TrafficDefenseService();

    expect(
      service.shouldSkipDefaultThrottle(
        createExecutionContext(createRequest({ method: 'OPTIONS' })),
      ),
    ).toBe(true);
  });

  it('falls back to a hashed session cookie for the global default throttler', () => {
    const service = new TrafficDefenseService();

    const tracker = service.resolveDefaultTracker(
      createRequest({
        cookies: { refreshToken: 'refresh-cookie' },
      }),
    );

    expect(tracker).toContain('default:session:');
    expect(tracker).not.toContain('refresh-cookie');
  });

  it('falls back to session cookie + IP for anonymous queue-entry requests before admission exists', () => {
    const service = new TrafficDefenseService();

    const tracker = service.resolveTracker(
      'queue-entry',
      createRequest({
        method: 'GET',
        originalUrl: '/api/v1/queue/entry',
        cookies: { refreshToken: 'refresh-cookie' },
        headers: { 'x-queue-admission-token': 'late-admission-token' },
      }),
    );

    expect(tracker).toContain('queue-entry');
    expect(tracker).toContain('session-ip');
    expect(tracker).toContain('203.0.113.10');
    expect(tracker).not.toContain('late-admission-token');
  });

  it('uses admission token before plain IP on booking mutation trackers when session identity is unavailable', () => {
    const service = new TrafficDefenseService();

    const tracker = service.resolveTracker(
      'confirm-payment',
      createRequest({
        originalUrl: '/api/v1/payments/confirm',
        headers: { 'x-queue-admission-token': 'admission-123' },
      }),
    );

    expect(tracker).toContain('confirm-payment');
    expect(tracker).toContain('admission');
    expect(tracker).not.toContain('ip:203.0.113.10');
  });

  it('returns TRAFFIC_RATE_LIMITED for retryable throttle outcomes', () => {
    const service = new TrafficDefenseService();

    expect(service.rateLimited('lock-seat')).toEqual({
      action: 'rate-limit',
      code: TRAFFIC_RATE_LIMITED,
      policy: 'lock-seat',
    });
  });

  it('returns SECURITY_CHALLENGE_REQUIRED for suspicious repeated booking attempts', () => {
    const service = new TrafficDefenseService();

    expect(
      service.evaluateSecurityDecision('prepare-reservation', {
        repeatedAttempts: 6,
        distinctAccountCount: 2,
        distinctDeviceCount: 2,
      }),
    ).toEqual({
      action: 'challenge',
      code: SECURITY_CHALLENGE_REQUIRED,
      policy: 'prepare-reservation',
    });
  });

  it('returns SECURITY_BLOCKED for clear macro behavior', () => {
    const service = new TrafficDefenseService();

    expect(
      service.evaluateSecurityDecision('confirm-payment', {
        repeatedAttempts: 12,
        distinctAccountCount: 3,
        distinctPhoneCount: 2,
        distinctPaymentMethodCount: 2,
      }),
    ).toEqual({
      action: 'block',
      code: SECURITY_BLOCKED,
      policy: 'confirm-payment',
    });
  });

  it('does not hardcode Enterprise-only cf.bot_management fields in runtime code', async () => {
    const source = await readFile(resolve(__dirname, 'traffic-defense.service.ts'), 'utf-8');

    expect(source).not.toContain('cf.bot_management.');
  });

  it('wires traffic defense into AppModule throttler configuration', async () => {
    const appModuleSource = await readFile(
      resolve(__dirname, '../../app.module.ts'),
      'utf-8',
    );

    expect(appModuleSource).toContain('TrafficModule');
    expect(appModuleSource).toContain('TrafficDefenseService');
    expect(appModuleSource).toContain('resolveDefaultTracker');
  });
});

function createExecutionContext(request: ReturnType<typeof createRequest>) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as never;
}
