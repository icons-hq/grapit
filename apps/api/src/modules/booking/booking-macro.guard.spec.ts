import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { BookingController } from './booking.controller.js';
import { BookingService } from './booking.service.js';
import { BookingMacroController, BookingMacroGuard } from './booking-macro.guard.js';
import { BookingMacroService } from '../traffic/booking-macro.service.js';
import { AdmissionGuard } from '../queue/guards/admission.guard.js';
import { ReservationController } from '../reservation/reservation.controller.js';

const showtimeId = '550e8400-e29b-41d4-a716-446655440000';
const macro = { beforeNewSeat: vi.fn(), verify: vi.fn() };
const lockSeat = vi.fn().mockResolvedValue({ success: true });
let app: INestApplication;

beforeAll(async () => {
  // Vitest transpiles these classes without Nest's production decorator metadata.
  Reflect.defineMetadata('design:paramtypes', [BookingService], BookingController);
  Reflect.defineMetadata('design:paramtypes', [BookingMacroService], BookingMacroController);
  Reflect.defineMetadata('design:paramtypes', [BookingMacroService], BookingMacroGuard);
  const module = await Test.createTestingModule({
    controllers: [BookingController, BookingMacroController],
    providers: [BookingMacroGuard, { provide: BookingService, useValue: { lockSeat } }, { provide: BookingMacroService, useValue: macro }],
  }).overrideGuard(AdmissionGuard).useValue({
    canActivate(context: ExecutionContext) {
      const req = context.switchToHttp().getRequest<Request>() as Request & { queueAdmission: { queueSessionId: string } };
      req.user = { id: 'buyer', role: 'user' };
      req.queueAdmission = { queueSessionId: 'original-admission' };
      return true;
    },
  }).compile();
  app = module.createNestApplication();
  await app.init();
});
afterAll(() => app?.close());

it('checks actual seat lock requests after admission, then resumes using the same admission', async () => {
  const server = app.getHttpServer();
  macro.beforeNewSeat.mockRejectedValueOnce(new ForbiddenException('SECURITY_CHALLENGE_REQUIRED'));
  await request(server).post('/booking/seats/lock').send({ showtimeId, seatId: 'A1' }).expect(403);
  expect(lockSeat).not.toHaveBeenCalled();
  await request(server).post('/booking/seats/verify').send({ showtimeId, token: 'fixture' }).expect(204);
  expect(macro.verify.mock.calls[0]![0].queueAdmission.queueSessionId).toBe('original-admission');
  await request(server).post('/booking/seats/lock').send({ showtimeId, seatId: 'A1' }).expect(201);
  expect(lockSeat).toHaveBeenCalledOnce();
  expect(macro.beforeNewSeat.mock.calls[1]![0].queueAdmission.queueSessionId).toBe('original-admission');
});

it('keeps verification out of prepared orders and payment confirmation', () => {
  for (const handler of [ReservationController.prototype.prepareReservation, ReservationController.prototype.confirmPayment]) {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([AdmissionGuard]);
  }
});
