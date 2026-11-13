import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AudienceController, AdminAudienceController } from './audience.controller.js';
import { AudienceService } from './audience.service.js';
import { CreativeReportService } from './creative-report.service.js';
import { Ga4InterestService } from './ga4-interest.service.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';

describe('audience HTTP permissions and consent boundary', () => {
  let app: INestApplication;
  const id = randomUUID();
  const audience = { tags: vi.fn().mockResolvedValue([]), profiles: vi.fn().mockResolvedValue({ rows: [] }), overview: vi.fn().mockResolvedValue({ activeProfiles: 0 }), profile: vi.fn(), preferences: vi.fn(), savePreferences: vi.fn().mockResolvedValue({}), withdraw: vi.fn() };
  beforeAll(async () => {
    Reflect.defineMetadata('design:paramtypes', [Reflector], RolesGuard); Reflect.defineMetadata('design:paramtypes', [Reflector], AdminCapabilitiesGuard);
    const module = await Test.createTestingModule({ controllers: [AudienceController, AdminAudienceController], providers: [
      { provide: AudienceService, useValue: audience }, { provide: CreativeReportService, useValue: { report: vi.fn().mockResolvedValue({ rows: [] }) } }, { provide: Ga4InterestService, useValue: { publicConfig: () => ({ enabled: false }), report: vi.fn() } },
    ] }).compile();
    app = module.createNestApplication();
    app.use((req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => { const role = req.headers['x-test-role']; if (role) req.user = { id, role: role === 'member' ? 'user' : 'admin', adminCapabilities: role === 'owner' ? ['audit.read', 'security.manage'] : role === 'auditor' ? ['audit.read'] : ['security.manage'] }; next(); });
    const reflector = new Reflector(); app.useGlobalGuards({ canActivate(ctx) { if (reflector.getAllAndOverride(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true; if (!ctx.switchToHttp().getRequest().user) throw new UnauthorizedException(); return true; } });
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  it('keeps public catalog free of members and enforces both permissions for profiles', async () => {
    expect((await request(app.getHttpServer()).get('/analytics/audience/catalog')).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/analytics/audience/me')).status).toBe(401);
    for (const role of ['member', 'auditor', 'security']) expect((await request(app.getHttpServer()).get('/admin/analytics/audience/profiles').set('x-test-role', role)).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/admin/analytics/audience/profiles').set('x-test-role', 'owner')).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/admin/analytics/audience/overview').set('x-test-role', 'auditor')).status).toBe(200);
  });
  it('requires explicit current consent and derives the account from authentication', async () => {
    const put = () => request(app.getHttpServer()).put('/analytics/audience/me').set('x-test-role', 'member');
    const body = { tagIds: [], consentVersion: 'interests-v1', collectionConsent: true, useBehavior: false };
    expect((await put().send({ ...body, collectionConsent: false })).status).toBe(400);
    expect((await put().send({ ...body, userId: randomUUID() })).status).toBe(400);
    expect((await put().send({ ...body, consentVersion: 'old' })).status).toBe(400);
    expect((await put().send(body)).status).toBe(200); expect(audience.savePreferences).toHaveBeenCalledWith(id, body);
  });
});
