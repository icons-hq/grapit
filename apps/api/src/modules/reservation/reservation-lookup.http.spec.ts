import 'reflect-metadata';
import { Agent } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ReservationController } from './reservation.controller.js';
import { ReservationService } from './reservation.service.js';
import { RefundService } from '../refund/refund.service.js';
import { AdmissionGuard } from '../queue/guards/admission.guard.js';

describe('Reservation lookup HTTP representation', () => {
  let app: INestApplication;
  let agent: Agent;
  const service = { getReservationByOrderId: vi.fn() };
  beforeAll(async () => {
    Reflect.defineMetadata('design:paramtypes', [ReservationService, RefundService], ReservationController);
    const module = await Test.createTestingModule({ controllers: [ReservationController], providers: [
      { provide: ReservationService, useValue: service }, { provide: RefundService, useValue: {} },
    ] }).overrideGuard(AdmissionGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication();
    app.use((req: { user?: { id: string } }, _res: unknown, next: () => void) => { req.user = { id: 'buyer' }; next(); });
    await app.init();
    // One listening server and one keep-alive socket for the whole file instead
    // of supertest listening on and closing an ephemeral port per request.
    await app.listen(0, '127.0.0.1');
    agent = new Agent({ keepAlive: true, maxSockets: 1 });
  });
  afterAll(async () => {
    agent?.destroy();
    await app?.close();
  });
  it('returns parseable JSON null when the owner has no matching order', async () => {
    service.getReservationByOrderId.mockResolvedValue(null);
    const response = await request(app.getHttpServer()).get('/reservations?orderId=not-created&locale=en').agent(agent);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(JSON.parse(response.text)).toBeNull();
  });
  it('keeps an existing order as its original JSON object', async () => {
    service.getReservationByOrderId.mockResolvedValue({ id: 'existing-order', status: 'PENDING_PAYMENT' });
    const response = await request(app.getHttpServer()).get('/reservations?orderId=existing&locale=en').agent(agent);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'existing-order', status: 'PENDING_PAYMENT' });
  });
});
