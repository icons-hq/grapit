import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { QueueController } from './queue.controller.js';
import { QueueService } from './queue.service.js';

const performanceId = '550e8400-e29b-41d4-a716-446655440000';

describe('Queue entry HTTP contract', () => {
  let app: INestApplication;
  const queueService = {
    resolveBrowserIdentity: vi.fn(),
    enterPerformanceQueue: vi.fn(),
    getQueueSessionStatus: vi.fn(),
  };

  beforeAll(async () => {
    Reflect.defineMetadata('design:paramtypes', [QueueService], QueueController);
    const module = await Test.createTestingModule({
      controllers: [QueueController],
      providers: [{ provide: QueueService, useValue: queueService }],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.use((req: { user?: { id: string; role?: string } }, _res: unknown, next: () => void) => {
      req.user = { id: 'buyer-1', role: 'user' };
      next();
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    queueService.resolveBrowserIdentity.mockResolvedValue({
      userId: 'buyer-1',
      refreshTokenFamilyId: 'family-1',
      deviceSlotId: 'family-1',
    });
  });

  it.each(['not-a-uuid', 'performance-1', "1'%20OR%20'1'%3D'1"])(
    'rejects a malformed performance id with 400 before any DB or queue work (%s)',
    async (rawId) => {
      const response = await request(app.getHttpServer()).post(
        `/queue/performances/${rawId}/enter`,
      );

      expect(response.status).toBe(400);
      expect(queueService.resolveBrowserIdentity).not.toHaveBeenCalled();
      expect(queueService.enterPerformanceQueue).not.toHaveBeenCalled();
    },
  );

  it('keeps the not-open errorCode and server timestamp in the filtered 403 body', async () => {
    queueService.enterPerformanceQueue.mockRejectedValue(
      new ForbiddenException({
        message: '예매는 추후 오픈 예정입니다',
        errorCode: 'BOOKING_NOT_OPEN',
        bookingStartsAt: '2026-06-04T10:00:00.000Z',
        serverNow: '2026-06-04T09:59:00.000Z',
      }),
    );

    const response = await request(app.getHttpServer())
      .post(`/queue/performances/${performanceId}/enter`)
      .set('Cookie', ['refreshToken=refresh-cookie']);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      statusCode: 403,
      message: '예매는 추후 오픈 예정입니다',
      errorCode: 'BOOKING_NOT_OPEN',
    });
    // The web falls back to this server timestamp to correct its clock even
    // when extra exception fields are stripped by the global filter.
    expect(Date.parse(response.body.timestamp)).not.toBeNaN();
  });

  it('returns the wait estimate state with the queue snapshot', async () => {
    queueService.enterPerformanceQueue.mockResolvedValue({
      queueSessionId: 'queue-session-1',
      admissionToken: 'opaque-token',
      state: 'WAITING',
      position: 42,
      waitingCount: 300,
      etaSeconds: 0,
      etaPending: true,
      remainingSeats: 100,
      autoEnter: false,
      admittedAt: null,
      activeUntilAt: null,
      reentryGraceUntilAt: null,
    });

    const response = await request(app.getHttpServer())
      .post(`/queue/performances/${performanceId}/enter`)
      .set('Cookie', ['refreshToken=refresh-cookie']);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      queueSessionId: 'queue-session-1',
      position: 42,
      etaSeconds: 0,
      etaPending: true,
    });
    expect(response.body).not.toHaveProperty('admissionToken');
    expect(queueService.enterPerformanceQueue).toHaveBeenCalledWith(
      expect.objectContaining({ performanceId }),
    );
  });
});
