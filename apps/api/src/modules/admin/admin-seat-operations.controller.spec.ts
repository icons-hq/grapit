import { type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { AdminCapability } from '@grabit/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminSeatOperationsController } from './admin-seat-operations.controller.js';
import { AdminSeatOperationsService } from './admin-seat-operations.service.js';

describe('AdminSeatOperationsController', () => {
  let app: INestApplication;
  let capabilities: AdminCapability[] | undefined;
  let service: {
    listHistory: Mock;
    performOperation: Mock;
  };

  beforeAll(async () => {
    service = {
      listHistory: vi.fn(),
      performOperation: vi.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AdminSeatOperationsController],
      providers: [
        {
          provide: AdminSeatOperationsService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = {
            id: 'admin-1',
            email: 'admin@grapit.test',
            role: 'admin',
            roles: ['admin'],
            adminCapabilities: capabilities,
          };
          return true;
        },
      })
      .overrideGuard(AdminCapabilitiesGuard)
      .useValue(new AdminCapabilitiesGuard(new Reflector()))
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    capabilities = undefined;
    service.listHistory.mockReset();
    service.performOperation.mockReset();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each<AdminCapability>(['seat.disable', 'seat.reactivate', 'seat.manual_open'])(
    'allows history with only %s without allowing other mutations', async (capability) => {
      capabilities = [capability];
      service.listHistory.mockResolvedValue({ rows: [] });
      const res = await request(app.getHttpServer()).get('/admin/seat-operations/history')
        .query({ showtimeId: '00000000-0000-4000-8000-000000000001' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ rows: [] });
      for (const operation of ['disable', 'reactivate'] as const) {
        if (capability === `seat.${operation}`) continue;
        const denied = await request(app.getHttpServer()).post(`/admin/seat-operations/${operation}`)
          .send({ showtimeId: '00000000-0000-4000-8000-000000000001', seatKey: '1F:A-10', reason: 'test', confirmed: true });
        expect(denied.status).toBe(403);
      }
      expect(service.performOperation).not.toHaveBeenCalled();
    },
  );

  it('denies history without a seat capability', async () => {
    capabilities = ['reservations.read'];
    const res = await request(app.getHttpServer()).get('/admin/seat-operations/history')
      .query({ showtimeId: '00000000-0000-4000-8000-000000000001' });
    expect(res.status).toBe(403);
    expect(service.listHistory).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed history showtimeId before calling the service', async () => {
    service.listHistory.mockResolvedValue({ rows: [] });

    const res = await request(app.getHttpServer())
      .get('/admin/seat-operations/history')
      .query({ showtimeId: 'showtime-1', seatKey: '1F:A-10' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      message: 'Validation failed',
    });
    expect(service.listHistory).not.toHaveBeenCalled();
  });

  it.each([
    ['disable', '/admin/seat-operations/disable'],
    ['reactivate', '/admin/seat-operations/reactivate'],
  ])(
    'returns 400 for malformed %s showtimeId before calling the service',
    async (_label, path) => {
      service.performOperation.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post(path)
        .send({
          showtimeId: 'showtime-1',
          seatKey: '1F:A-10',
          reason: '시야 제한',
          confirmed: true,
        });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        message: 'Validation failed',
      });
      expect(service.performOperation).not.toHaveBeenCalled();
    },
  );
});
