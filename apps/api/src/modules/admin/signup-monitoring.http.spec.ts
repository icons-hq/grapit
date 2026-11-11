import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { AdminUserController } from './admin-user.controller.js';
import { AdminUserService } from './admin-user.service.js';

describe('signup monitoring HTTP access', () => {
  let app: INestApplication;
  const service = { getSignupMonitoring: vi.fn().mockResolvedValue({ summary: { signups: 2 } }) };
  beforeAll(async () => {
    Reflect.defineMetadata('design:paramtypes', [AdminUserService], AdminUserController);
    Reflect.defineMetadata('design:paramtypes', [Reflector], RolesGuard);
    Reflect.defineMetadata('design:paramtypes', [Reflector], AdminCapabilitiesGuard);
    const module = await Test.createTestingModule({ controllers: [AdminUserController], providers: [{ provide: AdminUserService, useValue: service }] }).compile();
    app = module.createNestApplication();
    app.use((req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
      const kind = req.headers['x-test-user'];
      if (kind) req.user = { id: 'test', role: kind === 'customer' ? 'user' : 'admin', adminCapabilities: kind === 'auditor' ? ['audit.read'] : ['field.scan.verify'] };
      next();
    });
    app.useGlobalGuards({ canActivate: (ctx) => { if (!ctx.switchToHttp().getRequest().user) throw new UnauthorizedException(); return true; } });
    await app.init(); await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { await app?.close(); });
  it('requires authentication, admin role and audit.read', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/admin/users/signup-monitoring')).status).toBe(401);
    for (const kind of ['customer', 'scanner']) expect((await request(server).get('/admin/users/signup-monitoring').set('x-test-user', kind)).status).toBe(403);
    const response = await request(server).get('/admin/users/signup-monitoring?period=24h').set('x-test-user', 'auditor');
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    expect(service.getSignupMonitoring).toHaveBeenLastCalledWith({ period: '24h' });
  });
  it('rejects invalid ranges and routes before the user-id handler', async () => {
    expect((await request(app.getHttpServer()).get('/admin/users/signup-monitoring?period=announcement').set('x-test-user', 'auditor')).status).toBe(400);
  });
});
