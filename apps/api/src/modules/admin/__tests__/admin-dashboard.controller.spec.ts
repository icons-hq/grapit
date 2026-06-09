import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  type INestApplication,
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import request from 'supertest';
import { AdminDashboardController } from '../admin-dashboard.controller.js';
import { AdminDashboardService } from '../admin-dashboard.service.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { DRIZZLE } from '../../../database/drizzle.provider.js';
import { CacheService } from '../../performance/cache.service.js';

/**
 * AdminDashboardController access control — review HIGH 3.
 *
 * RED Wave 1 spec: 대표 엔드포인트 GET /admin/dashboard/summary로 3케이스 고정.
 *  - unauth → 401 (RolesGuard override throws UnauthorizedException)
 *  - user role → 403 (RolesGuard override throws ForbiddenException)
 *  - admin role → 200 (skeleton throws 500 → RED now, GREEN after Plan 02 Task 02-02)
 *
 * 테스트가 skeleton 상태에서 admin 케이스가 500으로 실패 → 파일 단위 RED.
 * Plan 02가 handler body를 구현하면 GREEN으로 전환.
 */
type RoleMode = 'anonymous' | 'user' | 'admin';

describe('AdminDashboardController (access control)', () => {
  let app: INestApplication;
  let mode: RoleMode = 'admin';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AdminDashboardController],
      providers: [
        AdminDashboardService,
        // service constructor의 @Inject(DRIZZLE)과 CacheService 충족용 더미.
        // Plan 02가 handler body를 구현하면 service.getSummary()는 readThrough로 감싸지고,
        // cache hit 경로를 타면 DB는 호출되지 않는다. 따라서 cache.get이 더미 summary 값을
        // 반환하도록 설정하면 DRIZZLE이 stub이어도 admin 케이스가 200으로 통과한다.
        { provide: DRIZZLE, useValue: {} },
        {
          provide: CacheService,
          useValue: {
            get: async () => ({
              todayBookings: 0,
              todayCancellationEvents: 0,
              todayGrossRevenue: 0,
              todayNegativeCancellationRevenue: 0,
              todayNetRevenue: 0,
            }),
            set: async () => undefined,
            invalidate: async () => undefined,
            invalidatePattern: async () => undefined,
          },
        },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          if (mode === 'anonymous') {
            throw new UnauthorizedException();
          }
          req.user =
            mode === 'admin'
              ? { id: 'admin-1', roles: ['admin'] }
              : { id: 'user-1', roles: ['user'] };
          if (!req.user.roles.includes('admin')) {
            throw new ForbiddenException();
          }
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 401 for unauthenticated request', async () => {
    mode = 'anonymous';
    const res = await request(app.getHttpServer()).get('/admin/dashboard/summary');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin authenticated user', async () => {
    mode = 'user';
    const res = await request(app.getHttpServer()).get('/admin/dashboard/summary');
    expect(res.status).toBe(403);
  });

  it('returns 200 for admin role (will GREEN once Plan 02 implements handler)', async () => {
    mode = 'admin';
    const res = await request(app.getHttpServer()).get('/admin/dashboard/summary');
    // RED now (skeleton throws 500). GREEN after Plan 02.
    expect(res.status).toBe(200);
  });
});
