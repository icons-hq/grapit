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
import { ROUTE_THROTTLES } from './route-throttles.js';
import {
  TRAFFIC_RATE_LIMITED,
  TrafficDefenseService,
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

describe('throttling over HTTP', () => {
  let app: NestExpressApplication;
  const authService = {
    login: vi.fn(),
    refreshTokens: vi.fn(),
    register: vi.fn(),
    requestEmailVerification: vi.fn(),
    resendEmailVerification: vi.fn(),
    verifyEmailVerificationCode: vi.fn(),
    verifyEmailVerificationToken: vi.fn(),
    requestPasswordReset: vi.fn(),
    checkEmailAvailability: vi.fn(),
  };
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
    authService.requestPasswordReset.mockResolvedValue(undefined);
    paymentService.recordWebhookEvent.mockResolvedValue({
      state: 'duplicate-processed',
      eventId: 'evt-1',
      processingResultCode: 'ALREADY_PROCESSED',
    });
    fieldCheckInService.verify.mockResolvedValue({ outcome: 'processable' });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRootAsync({
          imports: [TrafficModule],
          inject: [TrafficDefenseService],
          useFactory: (trafficDefense: TrafficDefenseService) =>
            trafficDefense.getThrottlerModuleConfig(),
        }),
      ],
      controllers: [AuthController, PaymentWebhookController, FieldCheckInController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: configService },
        { provide: PaymentService, useValue: paymentService },
        { provide: TossPaymentsClient, useValue: {} },
        { provide: FieldCheckInService, useValue: fieldCheckInService },
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

    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.set('trust proxy', 1);
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterEach(async () => {
    delete process.env[EDGE_PROXY_SHARED_SECRET_ENV];
    await app?.close();
  });

  function post(path: string, ip: string) {
    return request(app.getHttpServer()).post(`/api/v1${path}`).set('X-Forwarded-For', ip);
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
      const statuses = await sendMany(10, () =>
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

    it('keeps refresh with a cookie per IP with room for many users behind one NAT', async () => {
      const statuses = await sendMany(120, (index) =>
        post('/auth/refresh', '198.51.100.7').set('Cookie', `refreshToken=user-${index}`),
      );

      expect(statuses.every((status) => status === 200)).toBe(true);
      expect(ROUTE_THROTTLES.authRefresh.limit).toBeGreaterThan(60);
    });
  });
});
