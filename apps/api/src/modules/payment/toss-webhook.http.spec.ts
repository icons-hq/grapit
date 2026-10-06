import { Agent } from 'node:http';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import { PaymentService } from './payment.service.js';
import { TossPaymentsClient } from './toss-payments.client.js';
import { TossWebhookGuard } from './toss-webhook.guard.js';

describe('Toss webhook HTTP acknowledgement', () => {
  let app: INestApplication;
  let agent: Agent | undefined;
  const service = {
    recordWebhookEvent: vi.fn(),
    findAsyncPaymentProgress: vi.fn(),
    upsertAsyncPaymentProgress: vi.fn(),
    markWebhookEventProcessed: vi.fn(),
    markWebhookEventFailed: vi.fn(),
  };
  const provider = { queryPayment: vi.fn() };
  const event = {
    eventId: 'http-webhook-event',
    eventType: 'PAYMENT_STATUS_CHANGED',
    data: {
      paymentKey: 'test-payment-key',
      orderId: 'test-order',
      status: 'DONE',
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentWebhookController],
      providers: [
        { provide: PaymentService, useValue: service },
        { provide: TossPaymentsClient, useValue: provider },
      ],
    })
      .overrideGuard(TossWebhookGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    // One listening server and one keep-alive socket for the whole file: without
    // it supertest listens on and closes a new ephemeral port per request, and a
    // pooled keep-alive socket of a closed server can fail a request with
    // "socket hang up" (D8).
    await app.listen(0, '127.0.0.1');
    agent = new Agent({ keepAlive: true, maxSockets: 1 });
  });

  beforeEach(() => {
    vi.resetAllMocks();
    service.recordWebhookEvent.mockResolvedValue({
      state: 'inserted', eventId: event.eventId,
    });
    service.findAsyncPaymentProgress.mockResolvedValue(null);
    provider.queryPayment.mockResolvedValue({
      ...event.data, totalAmount: 382000, approvedAt: '2026-09-21T06:00:00Z',
    });
  });

  afterAll(async () => {
    agent?.destroy();
    agent = undefined;
    await app?.close();
  });

  it('acknowledges an applied payment event with the provider-required HTTP 200', async () => {
    const response = await request(app.getHttpServer())
      .post('/payments/toss/webhook').agent(agent).send(event);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ acknowledged: true, duplicate: false });
  });

  it('acknowledges an already processed event with HTTP 200', async () => {
    service.recordWebhookEvent.mockResolvedValue({
      state: 'duplicate-processed', eventId: event.eventId,
    });
    const response = await request(app.getHttpServer())
      .post('/payments/toss/webhook').agent(agent).send(event);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ acknowledged: true, duplicate: true });
  });

  it('keeps a provider verification failure retryable instead of acknowledging it', async () => {
    provider.queryPayment.mockRejectedValue(new Error('Provider unavailable'));
    const response = await request(app.getHttpServer())
      .post('/payments/toss/webhook').agent(agent).send(event);
    expect(response.status).toBe(500);
    expect(response.body).not.toHaveProperty('acknowledged', true);
  });

  it('rejects a malformed event before acknowledging it', async () => {
    const response = await request(app.getHttpServer())
      .post('/payments/toss/webhook').agent(agent).send({ ...event, data: {} });
    expect(response.status).toBe(400);
  });
});
