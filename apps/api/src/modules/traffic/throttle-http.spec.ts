import { Agent } from 'node:http';
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import type { Request } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { EDGE_PROXY_SHARED_SECRET_ENV } from '../../common/request-ip.js';
import { AuthController } from '../auth/auth.controller.js';
import { AuthService } from '../auth/auth.service.js';
import { FieldCheckInController } from '../field-operations/field-check-in.controller.js';
import { FieldCheckInService } from '../field-operations/field-check-in.service.js';
import { PaymentWebhookController } from '../payment/payment-webhook.controller.js';
import { PaymentService } from '../payment/payment.service.js';
import { TossPaymentsClient } from '../payment/toss-payments.client.js';
import { TossWebhookGuard } from '../payment/toss-webhook.guard.js';
import { UserController } from '../user/user.controller.js';
import { UserService } from '../user/user.service.js';
import { ROUTE_THROTTLES } from './route-throttles.js';
import {
  TRAFFIC_RATE_LIMITED,
  TrafficDefenseService,
  type TrafficPolicyName,
} from './traffic-defense.service.js';
import { TrafficModule } from './traffic.module.js';

/**
 * Exercises the production throttler configuration end to end: the real
 * ThrottlerGuard, TrafficDefenseService trackers and policies, the real
 * controller decorators, Express `trust proxy` 1 as in main.ts, and the
 * in-memory throttler storage (same increment/TTL contract as Redis storage).
 */

/** Stands in for the global JwtAuthGuard: a verified user only when the test says so. */
@Injectable()
class TestJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const userId = req.headers['x-test-user'];
    if (typeof userId === 'string') {
      req.user = { id: userId };
    }
    return true;
  }
}

const CLOUDFLARE_PEER = '172.70.207.202';

function policyOption(name: TrafficPolicyName): { limit: number; ttl: number } {
  const policy = new TrafficDefenseService()
    .getThrottlerOptions()
    .find((option) => option.name === name);
  if (typeof policy?.limit !== 'number' || typeof policy.ttl !== 'number') {
    throw new Error(`no numeric limit/ttl for ${name}`);
  }
  return { limit: policy.limit, ttl: policy.ttl };
}

function policyLimit(name: TrafficPolicyName): number {
  return policyOption(name).limit;
}

function policyTtl(name: TrafficPolicyName): number {
  return policyOption(name).ttl;
}

describe('throttling over HTTP', () => {
  let app: NestExpressApplication;
  // One listening server and one kept-alive connection per test: these specs
  // send thousands of requests, and supertest otherwise opens a new listener
  // and socket per request, which can run out of ports under the full suite.
  let agent: Agent | undefined;
  const authService = {
    login: vi.fn(),
    refreshTokens: vi.fn(),
    register: vi.fn(),
    requestEmailVerification: vi.fn(),
    resendEmailVerification: vi.fn(),
    verifyEmailVerificationCode: vi.fn(),
    verifyEmailVerificationToken: vi.fn(),
    requestAccountEmailVerification: vi.fn(),
    verifyAccountEmailVerificationCode: vi.fn(),
    requestPasswordReset: vi.fn(),
    checkEmailAvailability: vi.fn(),
  };
  const userService = { getUserProfile: vi.fn() };
  const paymentService = {
    recordWebhookEvent: vi.fn(),
    markWebhookEventProcessed: vi.fn(),
    markWebhookEventFailed: vi.fn(),
    findAsyncPaymentProgress: vi.fn(),
  };
  const fieldCheckInService = { verify: vi.fn(), consume: vi.fn(), listShowtimes: vi.fn() };
  const configService = { get: (_key: string, fallback?: unknown) => fallback };

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env[EDGE_PROXY_SHARED_SECRET_ENV];
    authService.login.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'rotated-refresh-token',
      user: { id: 'user-1' },
    });
    authService.refreshTokens.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'rotated-refresh-token',
    });
    authService.resendEmailVerification.mockResolvedValue({
      expiresAt: new Date('2026-10-02T00:10:00.000Z'),
    });
    authService.requestEmailVerification.mockResolvedValue({
      expiresAt: new Date('2026-10-02T00:10:00.000Z'),
    });
    authService.verifyEmailVerificationCode.mockResolvedValue({ verified: true });
    authService.verifyEmailVerificationToken.mockResolvedValue({ verified: true });
    authService.requestAccountEmailVerification.mockResolvedValue({
      expiresAt: new Date('2026-10-02T00:10:00.000Z'),
    });
    authService.verifyAccountEmailVerificationCode.mockResolvedValue({ verified: true });
    authService.requestPasswordReset.mockResolvedValue(undefined);
    userService.getUserProfile.mockResolvedValue({ id: 'scanner-1' });
    paymentService.recordWebhookEvent.mockResolvedValue({
      state: 'duplicate-processed',
      eventId: 'evt-1',
      processingResultCode: 'ALREADY_PROCESSED',
    });
    fieldCheckInService.verify.mockResolvedValue({ outcome: 'processable' });
    fieldCheckInService.consume.mockResolvedValue({ outcome: 'admitted' });
    fieldCheckInService.listShowtimes.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRootAsync({
          imports: [TrafficModule],
          inject: [TrafficDefenseService],
          useFactory: (trafficDefense: TrafficDefenseService) =>
            trafficDefense.getThrottlerModuleConfig(),
        }),
      ],
      controllers: [
        AuthController,
        PaymentWebhookController,
        FieldCheckInController,
        UserController,
      ],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: configService },
        { provide: PaymentService, useValue: paymentService },
        { provide: TossPaymentsClient, useValue: {} },
        { provide: FieldCheckInService, useValue: fieldCheckInService },
        { provide: UserService, useValue: userService },
        // Same order as AppModule: authenticate first, then throttle.
        { provide: APP_GUARD, useClass: TestJwtGuard },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    })
      .overrideGuard(AuthGuard('local'))
      .useValue({ canActivate: () => true })
      .overrideGuard(TossWebhookGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminCapabilitiesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    // The unit test transform emits no decorator metadata, so constructor
    // injection by type is unavailable; wire the controllers' collaborators.
    Object.assign(moduleRef.get(AuthController), { authService, configService });
    Object.assign(moduleRef.get(FieldCheckInController), { fieldCheckInService });
    Object.assign(moduleRef.get(UserController), { userService });

    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.set('trust proxy', 1);
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.listen(0, '127.0.0.1');
    agent = new Agent({ keepAlive: true, maxSockets: 1 });
  });

  afterEach(async () => {
    delete process.env[EDGE_PROXY_SHARED_SECRET_ENV];
    agent?.destroy();
    agent = undefined;
    await app?.close();
  });

  function post(path: string, ip: string) {
    return postRaw(`/api/v1${path}`, ip);
  }

  /** POST to a full path, for spellings of the global prefix itself. */
  function postRaw(fullPath: string, ip: string) {
    return request(app.getHttpServer())
      .post(fullPath)
      .agent(agent)
      .set('X-Forwarded-For', ip);
  }

  function get(path: string, ip: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .agent(agent)
      .set('X-Forwarded-For', ip);
  }

  function randomCookie(): string {
    const value = Math.random().toString(36).slice(2);
    return `session=${value}; queueSessionId=${value}; refreshToken=${value}`;
  }

  async function sendMany(count: number, send: (index: number) => request.Test) {
    const statuses: number[] = [];
    for (let index = 0; index < count; index += 1) {
      statuses.push((await send(index)).status);
    }
    return statuses;
  }

  describe('anonymous auth endpoints are tracked by trusted IP, not client cookies (#5)', () => {
    it('blocks login credential stuffing that rotates cookies on every request', async () => {
      const limit = ROUTE_THROTTLES.authLogin.limit;
      const statuses = await sendMany(limit, (index) =>
        post('/auth/login', '198.51.100.7')
          .set('Cookie', randomCookie())
          .send({ email: `victim-${index}@example.com`, password: 'guess' }),
      );
      expect(statuses.every((status) => status === 200)).toBe(true);

      const blocked = await post('/auth/login', '198.51.100.7')
        .set('Cookie', randomCookie())
        .send({ email: 'one-more@example.com', password: 'guess' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.message).toBe(TRAFFIC_RATE_LIMITED);

      const otherClient = await post('/auth/login', '198.51.100.8')
        .send({ email: 'one-more@example.com', password: 'guess' });
      expect(otherClient.status).toBe(200);
    });

    it('caps password guesses per account and IP without locking the account out elsewhere', async () => {
      const statuses = await sendMany(policyLimit('login-account'), () =>
        post('/auth/login', '198.51.100.7')
          .set('Cookie', randomCookie())
          .send({ email: 'Victim@Example.com', password: 'guess' }),
      );
      expect(statuses.every((status) => status === 200)).toBe(true);

      const blocked = await post('/auth/login', '198.51.100.7')
        .send({ email: ' victim@example.com ', password: 'guess' });
      expect(blocked.status).toBe(429);

      const ownerElsewhere = await post('/auth/login', '203.0.113.20')
        .send({ email: 'victim@example.com', password: 'right' });
      expect(ownerElsewhere.status).toBe(200);
    });

    it('caps password guesses that name the account in the query string (review r1)', async () => {
      // passport-local reads `email` from the body, then from the query string.
      const limit = policyLimit('login-account');
      const statuses = await sendMany(limit, (index) =>
        index % 2 === 0
          ? post('/auth/login?email=Victim@Example.com', '198.51.100.7').send({ password: 'guess' })
          : post('/auth/login', '198.51.100.7').send({ email: 'victim@example.com', password: 'guess' }),
      );
      expect(statuses.every((status) => status === 200)).toBe(true);

      const blocked = await post('/auth/login?email=victim@example.com', '198.51.100.7')
        .set('Cookie', randomCookie())
        .send({ password: 'guess' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.message).toBe(TRAFFIC_RATE_LIMITED);

      const ownerElsewhere = await post('/auth/login', '203.0.113.20')
        .send({ email: 'victim@example.com', password: 'right' });
      expect(ownerElsewhere.status).toBe(200);
    });

    it('blocks signup bursts that rotate cookies and admission tokens', async () => {
      // The throttle guard runs before validation, so an invalid body still counts.
      const statuses = await sendMany(20, (index) =>
        post('/auth/register', '198.51.100.7')
          .set('Cookie', randomCookie())
          .set('x-queue-admission-token', `admission-${index}`)
          .send({ email: `bot-${index}@example.com`, admissionToken: `admission-${index}` }),
      );
      expect(statuses).not.toContain(429);

      const blocked = await post('/auth/register', '198.51.100.7')
        .set('Cookie', randomCookie())
        .set('x-queue-admission-token', 'admission-new')
        .send({ email: 'bot-new@example.com' });
      expect(blocked.status).toBe(429);
    });

    it('caps password reset mail per address across IPs', async () => {
      const statuses = await sendMany(3, (index) =>
        post('/auth/password-reset/request', `198.51.100.${10 + index}`)
          .send({ email: 'victim@example.com' }),
      );
      expect(statuses.every((status) => status === 200)).toBe(true);

      const blocked = await post('/auth/password-reset/request', '198.51.100.99')
        .set('Cookie', randomCookie())
        .send({ email: 'VICTIM@example.com' });
      expect(blocked.status).toBe(429);
      expect(authService.requestPasswordReset).toHaveBeenCalledTimes(3);
    });

    it('does not let a Cloudflare peer pick its bucket with True-Client-IP or X-Forwarded-For (#152)', async () => {
      const limit = ROUTE_THROTTLES.authLogin.limit;
      const spoofed = (index: number) => `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}`;
      const statuses = await sendMany(limit, (index) =>
        post('/auth/login', `${spoofed(index)}, ${CLOUDFLARE_PEER}`)
          .set('True-Client-IP', spoofed(index))
          .send({ email: `victim-${index}@example.com`, password: 'guess' }),
      );
      expect(statuses.every((status) => status === 200)).toBe(true);

      const blocked = await post('/auth/login', `198.18.9.9, ${CLOUDFLARE_PEER}`)
        .set('True-Client-IP', '198.18.9.9')
        .send({ email: 'one-more@example.com', password: 'guess' });
      expect(blocked.status).toBe(429);
    });

    it('buckets edge-forwarded visitors separately only when the edge secret matches (#152)', async () => {
      process.env[EDGE_PROXY_SHARED_SECRET_ENV] = 'edge-secret-value';
      const limit = ROUTE_THROTTLES.authLogin.limit;
      const viaEdge = (ip: string) =>
        post('/auth/login', `${ip}, ${CLOUDFLARE_PEER}`)
          .set('x-grabit-edge-secret', 'edge-secret-value')
          .set('x-grabit-client-ip', ip);

      await sendMany(limit, (index) =>
        viaEdge('198.51.100.7').send({ email: `user-${index}@example.com`, password: 'pw' }),
      );
      expect(
        (await viaEdge('198.51.100.7').send({ email: 'x@example.com', password: 'pw' })).status,
      ).toBe(429);
      expect(
        (await viaEdge('198.51.100.8').send({ email: 'x@example.com', password: 'pw' })).status,
      ).toBe(200);

      // A forged client IP without the secret lands in the peer's bucket.
      const forged = await sendMany(limit + 1, (index) =>
        post('/auth/login', `198.18.0.${index % 250}, ${CLOUDFLARE_PEER}`)
          .set('x-grabit-edge-secret', 'wrong-secret')
          .set('x-grabit-client-ip', `198.18.1.${index % 250}`)
          .set('cf-connecting-ip', `198.18.2.${index % 250}`)
          .send({ email: `forged-${index}@example.com`, password: 'pw' }),
      );
      expect(forged.at(-1)).toBe(429);
    });
  });

  describe('identity policies hold on every path spelling that reaches the handler (review r2)', () => {
    // Express 5 routes case-insensitively and ignores a trailing slash, so
    // all of these reach the same handler and must hit the same policy.
    it('caps password guesses on case-variant login paths', async () => {
      const spellings = [
        '/api/v1/auth/LOGIN',
        '/api/v1/auth/Login/',
        '/API/V1/AUTH/login',
        '/api/v1/auth/login',
      ];
      const limit = policyLimit('login-account');
      expect(limit).toBeLessThan(ROUTE_THROTTLES.authLogin.limit);
      const statuses = await sendMany(limit, (index) =>
        postRaw(spellings[index % spellings.length]!, '198.51.100.7')
          .send({ email: 'victim@example.com', password: 'guess' }),
      );
      expect(statuses.every((status) => status === 200)).toBe(true);

      const blocked = await postRaw('/api/v1/Auth/lOgIn', '198.51.100.7')
        .send({ email: 'victim@example.com', password: 'guess' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.message).toBe(TRAFFIC_RATE_LIMITED);
    });

    it('caps verification mail per address on case-variant request/resend paths', async () => {
      const spellings = [
        '/auth/Email-Verification/resend',
        '/auth/email-verification/RESEND/',
        '/auth/EMAIL-VERIFICATION/Request',
        '/auth/email-verification/resend',
        '/Auth/email-verification/request',
      ];
      const limit = policyLimit('email-verification-send');
      const statuses = await sendMany(limit, (index) =>
        post(spellings[index % spellings.length]!, `198.51.100.${index + 1}`)
          .send({ email: 'victim@example.com' }),
      );
      expect(statuses.every((status) => status === 200)).toBe(true);

      const blocked = await post('/auth/Email-Verification/RESEND', '192.0.2.77')
        .send({ email: 'victim@example.com' });
      expect(blocked.status).toBe(429);
      expect(
        authService.requestEmailVerification.mock.calls.length +
          authService.resendEmailVerification.mock.calls.length,
      ).toBe(limit);
    });

    it('caps password reset mail per address on case-variant paths', async () => {
      const spellings = [
        '/auth/Password-Reset/request',
        '/auth/password-reset/REQUEST/',
        '/AUTH/PASSWORD-RESET/REQUEST',
      ];
      const limit = policyLimit('password-reset-email');
      const statuses = await sendMany(limit, (index) =>
        post(spellings[index % spellings.length]!, `198.51.100.${index + 1}`)
          .send({ email: 'victim@example.com' }),
      );
      expect(statuses.every((status) => status === 200)).toBe(true);

      const blocked = await post('/auth/Password-Reset/Request', '192.0.2.77')
        .send({ email: 'victim@example.com' });
      expect(blocked.status).toBe(429);
      expect(authService.requestPasswordReset).toHaveBeenCalledTimes(limit);
    });
  });

  describe('email verification mail is rate limited (#12)', () => {
    it('stops a resend flood to one address from one IP', async () => {
      const statuses = await sendMany(5, () =>
        post('/auth/email-verification/resend', '198.51.100.7')
          .set('Cookie', randomCookie())
          .send({ email: 'victim@example.com' }),
      );
      expect(statuses.every((status) => status === 200)).toBe(true);

      const blocked = await post('/auth/email-verification/resend', '198.51.100.7')
        .send({ email: 'victim@example.com' });
      expect(blocked.status).toBe(429);
      expect(authService.resendEmailVerification).toHaveBeenCalledTimes(5);
    });

    it('shares the per-address budget across request/resend and across IPs', async () => {
      await sendMany(3, (index) =>
        post('/auth/email-verification/request', `198.51.100.${index + 1}`)
          .send({ email: 'victim@example.com' }),
      );
      await sendMany(2, (index) =>
        post('/auth/email-verification/resend', `203.0.113.${index + 1}`)
          .send({ email: 'Victim@Example.com' }),
      );

      const blocked = await post('/auth/email-verification/resend', '192.0.2.77')
        .send({ email: 'victim@example.com' });
      expect(blocked.status).toBe(429);
      expect(
        authService.requestEmailVerification.mock.calls.length +
          authService.resendEmailVerification.mock.calls.length,
      ).toBe(5);
    });

    it('caps how many addresses one IP can mail', async () => {
      const limit = ROUTE_THROTTLES.authEmailVerificationSend.limit;
      const statuses = await sendMany(limit, (index) =>
        post('/auth/email-verification/resend', '198.51.100.7')
          .send({ email: `user-${index}@example.com` }),
      );
      expect(statuses.every((status) => status === 200)).toBe(true);

      const blocked = await post('/auth/email-verification/resend', '198.51.100.7')
        .send({ email: 'fresh-target@example.com' });
      expect(blocked.status).toBe(429);
    });

    it('caps account-email mail per signed-in user, and per user and address', async () => {
      const perUser = ROUTE_THROTTLES.accountEmailVerificationSend.limit;
      const toDistinct = await sendMany(perUser, (index) =>
        post('/auth/email-verification/account-email/request', '198.51.100.7')
          .set('x-test-user', 'user-1')
          .send({ email: `new-${index}@example.com` }),
      );
      expect(toDistinct.every((status) => status === 200)).toBe(true);
      const overUser = await post('/auth/email-verification/account-email/request', '198.51.100.8')
        .set('x-test-user', 'user-1')
        .send({ email: 'another@example.com' });
      expect(overUser.status).toBe(429);

      const perAddress = policyLimit('account-email-send');
      expect(perAddress).toBeLessThan(perUser);
      const toOneAddress = await sendMany(perAddress, (index) =>
        post('/auth/email-verification/account-email/request', `192.0.2.${index + 1}`)
          .set('x-test-user', 'user-2')
          .send({ email: index % 2 === 0 ? 'Target@example.com' : 'target@example.com' }),
      );
      expect(toOneAddress.every((status) => status === 200)).toBe(true);
      const overAddress = await post('/auth/email-verification/account-email/request', '192.0.2.99')
        .set('x-test-user', 'user-2')
        .send({ email: 'target@example.com' });
      expect(overAddress.status).toBe(429);
      expect(authService.requestAccountEmailVerification).toHaveBeenCalledTimes(perUser + perAddress);
    });

    it('does not let account-email requests from another account lock the address owner out (review r2)', async () => {
      // account-email/request answers 409 for an address another user owns and
      // sends nothing, so it must not spend that owner's resend budget.
      const perAddress = policyLimit('account-email-send');
      const attacker = await sendMany(perAddress + 3, () =>
        post('/auth/email-verification/account-email/request', '203.0.113.66')
          .set('x-test-user', 'attacker-1')
          .send({ email: 'victim@example.com' }),
      );
      expect(attacker.slice(0, perAddress).every((status) => status === 200)).toBe(true);
      expect(attacker.at(-1)).toBe(429);

      const ownerResend = await post('/auth/email-verification/resend', '198.51.100.7')
        .send({ email: 'victim@example.com' });
      expect(ownerResend.status).toBe(200);
      expect(authService.resendEmailVerification).toHaveBeenCalledTimes(1);

      // Nor does it share a bucket with the owner's own account-email flow.
      const owner = await post('/auth/email-verification/account-email/request', '198.51.100.7')
        .set('x-test-user', 'victim-1')
        .send({ email: 'victim@example.com' });
      expect(owner.status).toBe(200);
    });

    it('caps account-email code guesses per signed-in user', async () => {
      const perUser = ROUTE_THROTTLES.accountEmailVerificationVerify.limit;
      const statuses = await sendMany(perUser, (index) =>
        post('/auth/email-verification/account-email/verify', `198.51.100.${(index % 200) + 1}`)
          .set('x-test-user', 'user-1')
          .send({ email: `target-${index}@example.com`, code: '000000' }),
      );
      expect(statuses.every((status) => status === 200)).toBe(true);

      const blocked = await post('/auth/email-verification/account-email/verify', '203.0.113.9')
        .set('x-test-user', 'user-1')
        .send({ email: 'target-new@example.com', code: '000000' });
      expect(blocked.status).toBe(429);
    });

    it('caps code guesses per address and IP without locking the owner out elsewhere', async () => {
      const statuses = await sendMany(10, () =>
        post('/auth/email-verification/verify', '198.51.100.7')
          .send({ email: 'victim@example.com', code: '000000' }),
      );
      expect(statuses.every((status) => status === 200)).toBe(true);

      const blocked = await post('/auth/email-verification/verify', '198.51.100.7')
        .send({ email: 'victim@example.com', code: '000001' });
      expect(blocked.status).toBe(429);

      const owner = await post('/auth/email-verification/verify', '203.0.113.20')
        .send({ email: 'victim@example.com', code: '123456' });
      expect(owner.status).toBe(200);
    });

    it('lets as many signups behind one NAT verify their codes as may sign up there (review r2)', async () => {
      // Every signup verifies once, so the per-IP verify ceiling must not sit
      // below the per-IP signup allowance over the same window.
      const verifyPerIp = ROUTE_THROTTLES.authEmailVerificationVerify;
      const signupPerWindow = policyLimit('signup') * (verifyPerIp.ttl / policyTtl('signup'));
      expect(verifyPerIp.limit).toBeGreaterThanOrEqual(signupPerWindow);

      const statuses = await sendMany(verifyPerIp.limit, (index) =>
        post('/auth/email-verification/verify', '198.51.100.7')
          .send({ email: `member-${index}@example.com`, code: '123456' }),
      );
      expect(statuses).not.toContain(429);

      const ceiling = await post('/auth/email-verification/verify', '198.51.100.7')
        .send({ email: 'one-more@example.com', code: '123456' });
      expect(ceiling.status).toBe(429);
    });
  });

  describe('field check-in is not capped by the 60/min default (#15)', () => {
    it('lets one shared scanner account verify far beyond 60 calls per minute', async () => {
      const limit = ROUTE_THROTTLES.fieldOperations.limit;
      expect(limit).toBeGreaterThanOrEqual(600);

      const statuses = await sendMany(limit, (index) =>
        post('/field/check-in/verify', '198.51.100.7')
          .set('x-test-user', 'scanner-1')
          .send({ token: `ticket-token-${index}` }),
      );
      expect(statuses).not.toContain(429);
      expect(fieldCheckInService.verify).toHaveBeenCalledTimes(limit);

      // A runaway client still hits a ceiling, scoped to its own network.
      const runaway = await post('/field/check-in/verify', '198.51.100.7')
        .set('x-test-user', 'scanner-1')
        .send({ token: 'ticket-token-next' });
      expect(runaway.status).toBe(429);

      const otherVenue = await post('/field/check-in/verify', '203.0.113.20')
        .set('x-test-user', 'scanner-1')
        .send({ token: 'ticket-token-next' });
      expect(otherVenue.status).not.toBe(429);
    });
  });

  describe('a shared scanner account reloading the check-in page per scan (#15, review r1)', () => {
    it('admits more than 60 people a minute through the full page-load sequence', async () => {
      // Camera QR link -> new page load: AuthInitializer refresh + users/me,
      // then showtimes, verify, consume, and the verify refetch after consume.
      const admissions = 120;
      const gateIp = '198.51.100.7';
      const showtimeId = '18a3bcc6-5e75-463d-abfd-634601328754';
      const statuses: number[] = [];
      for (let index = 0; index < admissions; index += 1) {
        const token = `ticket-token-${index}`;
        statuses.push(
          (await post('/auth/refresh', gateIp).set('Cookie', `refreshToken=gate-${index % 4}`)).status,
          (await get('/users/me', gateIp).set('x-test-user', 'scanner-1')).status,
          (await get('/field/check-in/showtimes', gateIp).set('x-test-user', 'scanner-1')).status,
          (
            await post('/field/check-in/verify', gateIp)
              .set('x-test-user', 'scanner-1')
              .send({ token, showtimeId })
          ).status,
          (
            await post('/field/check-in/consume', gateIp)
              .set('x-test-user', 'scanner-1')
              .send({ token, showtimeId, deviceAttemptId: `attempt-${index}`, confirmed: true })
          ).status,
          (
            await post('/field/check-in/verify', gateIp)
              .set('x-test-user', 'scanner-1')
              .send({ token, showtimeId })
          ).status,
        );
      }

      expect(statuses).not.toContain(429);
      expect(statuses.every((status) => status === 200 || status === 201)).toBe(true);
      expect(userService.getUserProfile).toHaveBeenCalledTimes(admissions);
      expect(fieldCheckInService.consume).toHaveBeenCalledTimes(admissions);
    });

    it('keeps a ceiling on the profile call per account and network', async () => {
      const limit = ROUTE_THROTTLES.currentUserProfile.limit;
      const statuses = await sendMany(limit, () =>
        get('/users/me', '198.51.100.7').set('x-test-user', 'scanner-1'),
      );
      expect(statuses).not.toContain(429);

      expect((await get('/users/me', '198.51.100.7').set('x-test-user', 'scanner-1')).status)
        .toBe(429);
      expect((await get('/users/me', '203.0.113.20').set('x-test-user', 'scanner-1')).status)
        .toBe(200);
    });
  });

  describe('Toss webhooks are not IP throttled (#20)', () => {
    it('acknowledges a webhook burst from one Toss IP without 429', async () => {
      const statuses = await sendMany(150, (index) =>
        post('/payments/toss/webhook', '13.124.18.147').send({
          eventId: `evt-${index}`,
          eventType: 'PAYMENT_STATUS_CHANGED',
          data: { paymentKey: `pk-${index}`, orderId: `order-${index}`, status: 'DONE' },
        }),
      );

      expect(statuses.every((status) => status === 200)).toBe(true);
    });
  });

  describe('shared NAT headroom for refresh (#158)', () => {
    it('does not count cookie-less refresh calls, which are a no-op', async () => {
      const statuses = await sendMany(80, () => post('/auth/refresh', '198.51.100.7'));

      expect(statuses.every((status) => status === 204)).toBe(true);
      expect(authService.refreshTokens).not.toHaveBeenCalled();
    });

    it('reports the per-IP bucket on email-availability, which the runbook IP probe reads', async () => {
      // docs/runbooks/managed-demo-cost-floor.md compares X-RateLimit-Remaining
      // across networks to prove the API sees distinct client IPs.
      const probe = (ip: string) => get('/auth/email-availability?email=ip-probe@example.com', ip);
      const first = await probe('198.51.100.7');
      const second = await probe('198.51.100.7');
      const otherNetwork = await probe('203.0.113.20');

      expect(first.status).toBe(200);
      expect(first.headers['x-ratelimit-limit']).toBe(
        String(ROUTE_THROTTLES.authEmailAvailability.limit),
      );
      expect(Number(first.headers['x-ratelimit-remaining'])).toBe(
        ROUTE_THROTTLES.authEmailAvailability.limit - 1,
      );
      expect(Number(second.headers['x-ratelimit-remaining'])).toBe(
        ROUTE_THROTTLES.authEmailAvailability.limit - 2,
      );
      expect(otherNetwork.headers['x-ratelimit-remaining']).toBe(first.headers['x-ratelimit-remaining']);
    });

    it('keeps refresh with a cookie per IP with room for many users behind one NAT', async () => {
      const statuses = await sendMany(120, (index) =>
        post('/auth/refresh', '198.51.100.7').set('Cookie', `refreshToken=user-${index}`),
      );

      expect(statuses.every((status) => status === 200)).toBe(true);
      expect(ROUTE_THROTTLES.authRefresh.limit).toBeGreaterThan(60);
    });
  });
});
