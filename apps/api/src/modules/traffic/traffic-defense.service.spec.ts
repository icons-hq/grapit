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
        'login-account',
        'password-reset-email',
        'email-verification-send',
        'email-verification-verify',
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

  it('tracks anonymous default throttling by trusted IP, ignoring client-chosen cookies (audit #5)', () => {
    const service = new TrafficDefenseService();

    const trackers = ['session', 'queueSessionId', 'refreshToken'].map((cookieName) =>
      service.resolveDefaultTracker(
        createRequest({
          originalUrl: '/api/v1/auth/login',
          cookies: { [cookieName]: `random-${cookieName}-${Math.random()}` },
        }),
      ),
    );

    expect(new Set(trackers)).toEqual(new Set(['default:ip:203.0.113.10']));
  });

  it('tracks anonymous policy requests by trusted IP, ignoring cookies and admission tokens', () => {
    const service = new TrafficDefenseService();
    const policies = ['queue-entry', 'signup', 'confirm-payment'] as const;

    for (const policy of policies) {
      const first = service.resolveTracker(
        policy,
        createRequest({
          cookies: { session: 'random-a', refreshToken: 'random-a' },
          headers: { 'x-queue-admission-token': 'admission-a' },
          body: { admissionToken: 'admission-a' },
        }),
      );
      const second = service.resolveTracker(
        policy,
        createRequest({
          cookies: { queueSessionId: 'random-b' },
          headers: { 'x-queue-admission-token': 'admission-b' },
          query: { admissionToken: 'admission-b' },
        }),
      );

      expect(first).toBe(`${policy}:ip:203.0.113.10`);
      expect(second).toBe(first);
    }
  });

  it('groups IPv6 clients by /64 so address rotation inside one subscriber prefix shares a bucket', () => {
    const service = new TrafficDefenseService();
    const tracker = (ip: string) =>
      service.resolveDefaultTracker(createRequest({ ip, socket: { remoteAddress: ip } }));

    expect(tracker('2001:db8:1:2:aaaa::1')).toBe('default:ip:2001:db8:1:2::/64');
    expect(tracker('2001:db8:1:2:bbbb:cccc:dddd:eeee')).toBe('default:ip:2001:db8:1:2::/64');
    expect(tracker('2001:db8:1:3::1')).toBe('default:ip:2001:db8:1:3::/64');
  });

  it('skips cookie-less POST /auth/refresh, which is a no-op 204 (audit #158)', () => {
    const service = new TrafficDefenseService();
    const refresh = (overrides: Record<string, unknown>) =>
      service.shouldSkipDefaultThrottle(
        createExecutionContext(createRequest({ originalUrl: '/api/v1/auth/refresh', ...overrides })),
      );

    expect(refresh({})).toBe(true);
    expect(refresh({ cookies: { refreshToken: '' } })).toBe(true);
    expect(refresh({ cookies: { session: 'not-a-refresh-cookie' } })).toBe(true);
    expect(refresh({ cookies: { refreshToken: 'refresh-cookie' } })).toBe(false);
    expect(
      service.shouldSkipDefaultThrottle(
        createExecutionContext(createRequest({ originalUrl: '/api/v1/auth/login' })),
      ),
    ).toBe(false);
  });

  it('keys login-account and code-verify buckets by normalized email + IP', () => {
    const service = new TrafficDefenseService();
    const login = (email: string, ip = '203.0.113.10') =>
      service.resolveTracker(
        'login-account',
        createRequest({
          originalUrl: '/api/v1/auth/login',
          body: { email },
          ip,
          socket: { remoteAddress: ip },
        }),
      );

    expect(login('Victim@Example.com ')).toBe(login('victim@example.com'));
    expect(login('victim@example.com')).not.toContain('victim@example.com');
    expect(login('victim@example.com', '198.51.100.9')).not.toBe(login('victim@example.com'));
    expect(login('victim@example.com')).toMatch(/^login-account:email-ip:[0-9a-f]{32}:203\.0\.113\.10$/);
  });

  it('keys mail-sending buckets by normalized email across IPs', () => {
    const service = new TrafficDefenseService();
    const send = (email: string, ip: string) =>
      service.resolveTracker(
        'email-verification-send',
        createRequest({
          originalUrl: '/api/v1/auth/email-verification/resend',
          body: { email },
          ip,
          socket: { remoteAddress: ip },
        }),
      );

    expect(send('victim@example.com', '203.0.113.10')).toBe(
      send('VICTIM@example.com', '198.51.100.9'),
    );
    expect(send('victim@example.com', '203.0.113.10')).toMatch(
      /^email-verification-send:email:[0-9a-f]{32}$/,
    );
  });

  it('applies identity policies only to their routes and only when the request names an email', () => {
    const service = new TrafficDefenseService();
    const policy = (name: string) =>
      service.getThrottlerOptions().find((option) => option.name === name);
    const skip = (name: string, overrides: Record<string, unknown>) =>
      policy(name)?.skipIf?.(createExecutionContext(createRequest(overrides)));

    expect(skip('login-account', { originalUrl: '/api/v1/auth/login', body: { email: 'a@b.co' } }))
      .toBe(false);
    expect(skip('login-account', { originalUrl: '/api/v1/auth/login', body: {} })).toBe(true);
    expect(skip('login-account', { originalUrl: '/api/v1/auth/register', body: { email: 'a@b.co' } }))
      .toBe(true);
    expect(
      skip('email-verification-send', {
        originalUrl: '/api/v1/auth/email-verification/request',
        body: { email: 'a@b.co' },
      }),
    ).toBe(false);
    expect(
      skip('email-verification-verify', {
        originalUrl: '/api/v1/auth/email-verification/verify',
        body: { token: 'link-token-from-email-0123456789abcdef' },
      }),
    ).toBe(true);
    expect(
      skip('password-reset-email', {
        originalUrl: '/api/v1/auth/password-reset/request',
        body: { email: 'a@b.co' },
      }),
    ).toBe(false);
  });

  it('reads the login email where passport-local does: body first, then query (review r1)', () => {
    const service = new TrafficDefenseService();
    const loginAccount = service
      .getThrottlerOptions()
      .find((option) => option.name === 'login-account');
    const login = (overrides: Record<string, unknown>) =>
      createRequest({ originalUrl: '/api/v1/auth/login', ...overrides });
    const tracker = (overrides: Record<string, unknown>) =>
      service.resolveTracker('login-account', login(overrides));
    const victimKey = tracker({ body: { email: 'victim@example.com', password: 'guess' } });

    // `POST /auth/login?email=victim` with only a password in the body
    expect(tracker({ body: { password: 'guess' }, query: { email: 'Victim@Example.com' } }))
      .toBe(victimKey);
    expect(
      loginAccount?.skipIf?.(
        createExecutionContext(login({ body: { password: 'guess' }, query: { email: 'victim@example.com' } })),
      ),
    ).toBe(false);
    // passport-local falls through falsy body values to the query string
    expect(tracker({ body: { email: '', password: 'guess' }, query: { email: 'victim@example.com' } }))
      .toBe(victimKey);
    // and prefers a body value, so the query cannot move the bucket
    expect(tracker({ body: { email: 'victim@example.com' }, query: { email: 'other@example.com' } }))
      .toBe(victimKey);
    // arrays/objects are not credentials for passport-local either
    expect(
      loginAccount?.skipIf?.(
        createExecutionContext(login({ body: { email: ['victim@example.com'] }, query: {} })),
      ),
    ).toBe(true);
  });

  it('keeps body-only email policies on the body the handler validates', () => {
    const service = new TrafficDefenseService();
    const reset = (overrides: Record<string, unknown>) =>
      createRequest({ originalUrl: '/api/v1/auth/password-reset/request', ...overrides });
    const resetPolicy = service
      .getThrottlerOptions()
      .find((option) => option.name === 'password-reset-email');

    // The handler mails body.email; a query value must not shift that bucket...
    expect(
      service.resolveTracker(
        'password-reset-email',
        reset({ body: { email: 'victim@example.com' }, query: { email: 'other@example.com' } }),
      ),
    ).toBe(
      service.resolveTracker('password-reset-email', reset({ body: { email: 'victim@example.com' } })),
    );
    // ...nor charge a victim's budget for a request that sends no mail.
    expect(
      resetPolicy?.skipIf?.(
        createExecutionContext(reset({ body: {}, query: { email: 'victim@example.com' } })),
      ),
    ).toBe(true);
  });

  it('applies the per-address mail and code policies to signed-in account email routes', () => {
    const service = new TrafficDefenseService();
    const skip = (name: string, originalUrl: string) =>
      service
        .getThrottlerOptions()
        .find((option) => option.name === name)
        ?.skipIf?.(
          createExecutionContext(
            createRequest({ originalUrl, user: { id: 'user-1' }, body: { email: 'a@b.co' } }),
          ),
        );

    expect(skip('email-verification-send', '/api/v1/auth/email-verification/account-email/request'))
      .toBe(false);
    expect(skip('email-verification-verify', '/api/v1/auth/email-verification/account-email/verify'))
      .toBe(false);
    expect(
      service.resolveTracker(
        'email-verification-send',
        createRequest({
          originalUrl: '/api/v1/auth/email-verification/account-email/request',
          user: { id: 'user-1' },
          body: { email: 'A@B.co' },
        }),
      ),
    ).toBe(
      service.resolveTracker(
        'email-verification-send',
        createRequest({
          originalUrl: '/api/v1/auth/email-verification/resend',
          body: { email: 'a@b.co' },
        }),
      ),
    );
  });

  it('shares the email-verification-send bucket between request and resend', () => {
    const service = new TrafficDefenseService();
    const option = service
      .getThrottlerOptions()
      .find((policy) => policy.name === 'email-verification-send');
    const contextFor = (handlerName: string) =>
      ({
        getClass: () => ({ name: 'AuthController' }),
        getHandler: () => ({ name: handlerName }),
      }) as never;

    expect(option?.generateKey).toBeTypeOf('function');
    expect(
      option?.generateKey?.(contextFor('requestEmailVerification'), 'tracker', 'email-verification-send'),
    ).toBe(
      option?.generateKey?.(contextFor('resendEmailVerification'), 'tracker', 'email-verification-send'),
    );
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
    const config = new TrafficDefenseService().getThrottlerModuleConfig();

    expect(appModuleSource).toContain('TrafficModule');
    expect(appModuleSource).toContain('TrafficDefenseService');
    expect(appModuleSource).toContain('trafficDefense.getThrottlerModuleConfig()');
    expect(config.errorMessage).toBe(TRAFFIC_RATE_LIMITED);
    expect(config.throttlers.map((throttler) => throttler.name)).toEqual([
      'default',
      ...new TrafficDefenseService().getThrottlerOptions().map((policy) => policy.name),
    ]);
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
