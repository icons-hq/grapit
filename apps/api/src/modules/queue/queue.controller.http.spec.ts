import 'reflect-metadata';
import { Agent } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter.js';
import { QueueController } from './queue.controller.js';
import { QueueService } from './queue.service.js';

const performanceId = '550e8400-e29b-41d4-a716-446655440000';

function admissionCookie(response: request.Response): string | undefined {
  const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  return cookies.find((cookie) => cookie.startsWith('grabit_queue_admission='));
}

const waitingSnapshot = {
  queueSessionId: 'queue-session-1',
  state: 'WAITING',
  position: 42,
  waitingCount: 300,
  etaSeconds: 780,
  etaMinSeconds: 0,
  etaUnavailable: false,
  remainingSeats: 100,
  autoEnter: false,
  admittedAt: null,
  activeUntilAt: null,
  reentryGraceUntilAt: null,
};

describe('Queue entry HTTP contract', () => {
  let app: INestApplication;
  let agent: Agent;
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
    // One listening server and one keep-alive socket for the whole file instead
    // of supertest listening on and closing an ephemeral port per request.
    await app.listen(0, '127.0.0.1');
    agent = new Agent({ keepAlive: true, maxSockets: 1 });
  });

  afterAll(async () => {
    agent?.destroy();
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
      const response = await request(app.getHttpServer())
        .post(`/queue/performances/${rawId}/enter`)
        .agent(agent);

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
      .agent(agent)
      .set('Cookie', ['refreshToken=refresh-cookie']);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      statusCode: 403,
      message: '예매는 추후 오픈 예정입니다',
      errorCode: 'BOOKING_NOT_OPEN',
      // The global filter keeps extra exception fields (audit #157), so the
      // web reads the open time and server clock straight from the 403 body.
      bookingStartsAt: '2026-06-04T10:00:00.000Z',
      serverNow: '2026-06-04T09:59:00.000Z',
    });
    // The web still falls back to this server timestamp to correct its clock.
    expect(Date.parse(response.body.timestamp)).not.toBeNaN();
  });

  it('returns the wait estimate state with the queue snapshot', async () => {
    queueService.enterPerformanceQueue.mockResolvedValue({
      ...waitingSnapshot,
      admissionToken: 'opaque-token',
    });

    const response = await request(app.getHttpServer())
      .post(`/queue/performances/${performanceId}/enter`)
      .agent(agent)
      .set('Cookie', ['refreshToken=refresh-cookie']);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      queueSessionId: 'queue-session-1',
      position: 42,
      etaSeconds: 780,
      etaMinSeconds: 0,
      etaUnavailable: false,
    });
    expect(response.body).not.toHaveProperty('admissionToken');
    expect(queueService.enterPerformanceQueue).toHaveBeenCalledWith(
      expect.objectContaining({ performanceId }),
    );
  });

  it('keeps the admission cookie of a WAITING session for the 30-minute idle window', async () => {
    queueService.enterPerformanceQueue.mockResolvedValue({
      ...waitingSnapshot,
      admissionToken: 'opaque-token',
    });
    queueService.getQueueSessionStatus.mockResolvedValue(waitingSnapshot);

    const entered = await request(app.getHttpServer())
      .post(`/queue/performances/${performanceId}/enter`)
      .agent(agent)
      .set('Cookie', ['refreshToken=refresh-cookie']);
    const polled = await request(app.getHttpServer())
      .get('/queue/sessions/queue-session-1')
      .agent(agent)
      .set('Cookie', ['refreshToken=refresh-cookie', 'grabit_queue_admission=opaque-token']);

    expect(entered.status).toBe(201);
    expect(polled.status).toBe(200);
    for (const response of [entered, polled]) {
      expect(admissionCookie(response)).toContain('Max-Age=1800;');
      expect(admissionCookie(response)).toContain('HttpOnly');
      expect(admissionCookie(response)).toContain('Path=/api/v1');
    }
  });

  it('keeps the 13-minute admission cookie once admitted and returns the recovery order', async () => {
    const admitted = {
      ...waitingSnapshot,
      state: 'ADMITTED',
      position: 0,
      autoEnter: true,
      admittedAt: '2026-10-02T11:00:00.000Z',
      activeUntilAt: '2026-10-02T11:10:00.000Z',
      reentryGraceUntilAt: '2026-10-02T11:13:00.000Z',
    };
    queueService.enterPerformanceQueue.mockResolvedValueOnce({
      ...admitted,
      admissionToken: 'opaque-token',
    });
    queueService.enterPerformanceQueue.mockResolvedValueOnce({
      ...admitted,
      state: 'PAYMENT_RECOVERY',
      autoEnter: false,
      recoveryOrderId: 'ORDER-1',
      admissionToken: 'opaque-token',
    });

    const entered = await request(app.getHttpServer())
      .post(`/queue/performances/${performanceId}/enter`)
      .agent(agent)
      .set('Cookie', ['refreshToken=refresh-cookie']);
    const recovery = await request(app.getHttpServer())
      .post(`/queue/performances/${performanceId}/enter`)
      .agent(agent)
      .set('Cookie', ['refreshToken=refresh-cookie']);

    expect(admissionCookie(entered)).toContain('Max-Age=780;');
    expect(entered.body).not.toHaveProperty('recoveryOrderId');
    expect(admissionCookie(recovery)).toContain('Max-Age=780;');
    expect(recovery.body).toMatchObject({
      state: 'PAYMENT_RECOVERY',
      autoEnter: false,
      recoveryOrderId: 'ORDER-1',
    });
  });

  it('closes the status poll with NO_BOOKABLE_SHOWTIME once every showtime has started', async () => {
    queueService.getQueueSessionStatus.mockRejectedValue(
      new ForbiddenException({
        message: '이미 시작된 회차는 예매할 수 없습니다.',
        errorCode: 'NO_BOOKABLE_SHOWTIME',
      }),
    );

    const response = await request(app.getHttpServer())
      .get('/queue/sessions/queue-session-1')
      .agent(agent)
      .set('Cookie', ['refreshToken=refresh-cookie', 'grabit_queue_admission=opaque-token']);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      message: '이미 시작된 회차는 예매할 수 없습니다.',
      errorCode: 'NO_BOOKABLE_SHOWTIME',
    });
  });
});
