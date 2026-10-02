import 'reflect-metadata';
import { Agent } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PaymentController } from './payment.controller.js';
import { PaymentService } from './payment.service.js';
import { AdmissionGuard } from '../queue/guards/admission.guard.js';
import { QueueService } from '../queue/queue.service.js';

/**
 * A Prepared Checkout resumed without a new prepare (confirm page `resumeOrderId`)
 * reaches the provider handoff directly. The handoff extends the payment deadline
 * and records `checkoutStartedAt`, so it must refuse a browser that payment confirm
 * would refuse, before the buyer authenticates with the provider. The binding rule
 * itself runs against PostgreSQL and Valkey in test/queue-entry.integration.spec.ts.
 */
describe('POST /payments/branch queue admission', () => {
  let app: INestApplication;
  let agent: Agent;
  const ORDER_ID = 'GRP-RESUME-1';
  const branchBody = {
    orderId: ORDER_ID,
    paymentMethod: { method: 'CARD', provider: 'CARD', currency: 'KRW' },
    successUrl: 'https://example.test/complete',
    failUrl: 'https://example.test/confirm?error=true',
  };
  const paymentService = {
    prepareTossPaymentBranch: vi.fn(),
    releaseTossPaymentHandoff: vi.fn(),
  };
  // Order binding of the browser that prepared ORDER_ID (family-pc).
  const queueService = {
    resolveBrowserIdentity: vi.fn(async (userId: string, refreshToken?: string) => ({
      userId,
      refreshTokenFamilyId: refreshToken === 'pc-refresh' ? 'family-pc' : 'family-phone',
      deviceSlotId: refreshToken === 'pc-refresh' ? 'family-pc' : 'family-phone',
    })),
    assertAdmissionForOrder: vi.fn(async (params: {
      identity: { refreshTokenFamilyId: string };
      admissionToken?: string;
    }) => {
      if (params.identity.refreshTokenFamilyId !== 'family-pc' && !params.admissionToken) {
        throw new ForbiddenException('대기열 입장 인증이 필요합니다');
      }
      return {
        queueSessionId: 'queue-session-pc',
        userId: 'buyer',
        refreshTokenFamilyId: params.identity.refreshTokenFamilyId,
        deviceSlotId: params.identity.refreshTokenFamilyId,
        admittedAt: '2026-10-01T00:00:00.000Z',
        activeUntilAt: '2026-10-01T00:10:00.000Z',
        reentryGraceUntilAt: '2026-10-01T00:13:00.000Z',
      };
    }),
    assertAdmissionForShowtime: vi.fn(),
  };

  beforeAll(async () => {
    Reflect.defineMetadata('design:paramtypes', [PaymentService], PaymentController);
    Reflect.defineMetadata('design:paramtypes', [QueueService], AdmissionGuard);
    const module = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        { provide: PaymentService, useValue: paymentService },
        { provide: QueueService, useValue: queueService },
        AdmissionGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.use((req: { user?: { id: string; role: string } }, _res: unknown, next: () => void) => {
      req.user = { id: 'buyer', role: 'user' };
      next();
    });
    await app.init();
    await app.listen(0, '127.0.0.1');
    agent = new Agent({ keepAlive: true, maxSockets: 1 });
  });

  afterAll(async () => {
    agent?.destroy();
    await app?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    paymentService.prepareTossPaymentBranch.mockResolvedValue({ orderId: ORDER_ID, method: 'CARD' });
    paymentService.releaseTossPaymentHandoff.mockResolvedValue({ orderId: ORDER_ID, released: true });
  });

  it('refuses a resume from another browser with the queue 403 before any handoff', async () => {
    const response = await request(app.getHttpServer())
      .post('/payments/branch')
      .agent(agent)
      .set('Cookie', 'refreshToken=phone-refresh')
      .send(branchBody);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('대기열 입장 인증이 필요합니다');
    expect(queueService.assertAdmissionForOrder).toHaveBeenCalledWith(expect.objectContaining({
      orderId: ORDER_ID,
      userId: 'buyer',
      admissionToken: undefined,
    }));
    expect(paymentService.prepareTossPaymentBranch).not.toHaveBeenCalled();
  });

  it('requires the browser session before checking the order', async () => {
    const response = await request(app.getHttpServer())
      .post('/payments/branch')
      .agent(agent)
      .send(branchBody);

    expect(response.status).toBe(403);
    expect(queueService.assertAdmissionForOrder).not.toHaveBeenCalled();
    expect(paymentService.prepareTossPaymentBranch).not.toHaveBeenCalled();
  });

  it('hands off for the bound browser without the admission cookie, after the queue window', async () => {
    const response = await request(app.getHttpServer())
      .post('/payments/branch')
      .agent(agent)
      .set('Cookie', 'refreshToken=pc-refresh')
      .send(branchBody);

    expect(response.status).toBe(201);
    expect(paymentService.prepareTossPaymentBranch).toHaveBeenCalledWith({
      ...branchBody,
      userId: 'buyer',
    });
  });

  it('keeps the handoff release unguarded so a refused or failed checkout can always hand the order back', async () => {
    const response = await request(app.getHttpServer())
      .post('/payments/branch/release')
      .agent(agent)
      .set('Cookie', 'refreshToken=phone-refresh')
      .send({ orderId: ORDER_ID });

    expect(response.status).toBe(200);
    expect(queueService.assertAdmissionForOrder).not.toHaveBeenCalled();
    expect(paymentService.releaseTossPaymentHandoff).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      userId: 'buyer',
    });
  });
});
