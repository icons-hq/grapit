import { BadRequestException, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminSeatOperationsController } from './admin-seat-operations.controller.js';
import { AdminSeatOperationsService } from './admin-seat-operations.service.js';

describe('AdminSeatOperationsController', () => {
  let app: INestApplication;
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
          };
          return true;
        },
      })
      .overrideGuard(AdminCapabilitiesGuard)
      .useValue({
        canActivate: () => true,
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    service.listHistory.mockReset();
    service.performOperation.mockReset();
  });

  afterAll(async () => {
    await app?.close();
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
});
