import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector, APP_GUARD } from '@nestjs/core';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AnalyticsController, AdminAnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsVisitorService } from './analytics-visitor.service.js';
import { AnalyticsReportService } from './analytics-report.service.js';
import { analyticsBodyParser } from '../../config/analytics-body-parser.js';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';

const body = () => ({ collectionConsent: true, overseasConsent: true, consentVersion: 'analytics-v2-replay', consentedAt: new Date().toISOString(), visitorId: randomUUID(), sessionId: randomUUID(),
  touch: { landingPath: '/', referrerHost: null, source: null, medium: null, campaign: null, term: null, content: null },
  device: 'desktop', browser: 'chrome', os: 'macos', screen: 'large', language: 'ko',
  events: [{ id: randomUUID(), pageId: randomUUID(), name: 'page_view', path: '/', previousPath: null, props: {}, at: new Date().toISOString() }] });
describe('analytics HTTP boundary', () => {
  let app: INestApplication;
  const service = { collectReplay: vi.fn().mockResolvedValue({ stored: true }), collectCounts: vi.fn().mockResolvedValue(true), configureAggregate: vi.fn(), collect: vi.fn().mockResolvedValue(true), identify: vi.fn().mockResolvedValue(true), config: vi.fn().mockResolvedValue({ enabled: false }), configure: vi.fn(), withdraw: vi.fn().mockResolvedValue({ deleted: true }) };
  const reports = { report: vi.fn().mockResolvedValue({ summary: {} }) };
  beforeAll(async () => {
    vi.stubEnv('FRONTEND_URL', 'https://heygrabit.com');
    Reflect.defineMetadata('design:paramtypes', [Reflector], RolesGuard); Reflect.defineMetadata('design:paramtypes', [Reflector], AdminCapabilitiesGuard);
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60000, limit: 500 }], getTracker: (req) => req.headers['x-test-network'] ?? 'test' })],
      controllers: [AnalyticsController, AdminAnalyticsController], providers: [{ provide: AnalyticsService, useValue: service }, { provide: AnalyticsReportService, useValue: reports }, { provide: AnalyticsVisitorService, useValue: { sessions: vi.fn().mockResolvedValue({ sessions: [], nextBefore: null }), detail: vi.fn(), replay: vi.fn() } }, { provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();
    app = module.createNestApplication(); app.use('/analytics', analyticsBodyParser());
    app.use((req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
      const kind = req.headers['x-test-user'];
      if (kind) req.user = { id: 'test-user', role: kind === 'customer' ? 'user' : 'admin', adminCapabilities: kind === 'owner' ? ['audit.read', 'security.manage'] : kind === 'auditor' ? ['audit.read'] : kind === 'security' ? ['security.manage'] : ['field.scan.verify'] };
      next();
    });
    const reflector = new Reflector();
    app.useGlobalGuards({ canActivate(ctx) { if (reflector.getAllAndOverride(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true; if (!ctx.switchToHttp().getRequest().user) throw new UnauthorizedException(); return true; } });
    await app.init(); await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); });
  it('accepts category counts while rejecting identifiers and browser privacy signals', async () => {
    const payload = { counts: [{ page: 'home', name: 'page_view', count: 1 }] };
    const endpoint = () => request(app.getHttpServer()).post('/analytics/counts').set('origin', 'https://heygrabit.com');
    expect((await endpoint().send({ ...payload, visitorId: randomUUID() })).status).toBe(400);
    expect((await endpoint().set('dnt', '1').send(payload)).status).toBe(204);
    expect(service.collectCounts).not.toHaveBeenCalled();
    expect((await endpoint().send(payload)).status).toBe(204); expect(service.collectCounts).toHaveBeenCalledWith(payload);
  });
  it('rejects raw query values, foreign properties, invalid origins, oversized batches and bodies before storage', async () => {
    const data = body(); data.events[0]!.path = '/?ticket=do-not-store';
    let response = await request(app.getHttpServer()).post('/analytics/events').set('origin', 'https://heygrabit.com').send(data);
    expect(response.status).toBe(400); expect(service.collect).not.toHaveBeenCalled();
    response = await request(app.getHttpServer()).post('/analytics/events').set('origin', 'https://evil.invalid').send(body()); expect(response.status).toBe(403);
    response = await request(app.getHttpServer()).post('/analytics/events').set('origin', 'https://heygrabit.com').send({ ...body(), email: 'private@example.com' }); expect(response.status).toBe(400);
    response = await request(app.getHttpServer()).post('/analytics/events').set('origin', 'https://heygrabit.com').send({ ...body(), events: Array(21).fill(body().events[0]) }); expect(response.status).toBe(400);
    response = await request(app.getHttpServer()).post('/analytics/events').set('origin', 'https://heygrabit.com').send({ payload: 'x'.repeat(17000) }); expect(response.status).toBe(413);
  });
  it('drops bots, prefetch and browser privacy signals without recording', async () => {
    for (const [header, value] of [['user-agent', 'Googlebot'], ['purpose', 'prefetch'], ['next-router-prefetch', '1'], ['dnt', '1'], ['sec-gpc', '1']]) {
      expect((await request(app.getHttpServer()).post('/analytics/events').set('origin', 'https://heygrabit.com').set(header!, value!).send(body())).status).toBe(204);
    }
    expect(service.collect).not.toHaveBeenCalled();
  });
  it('enforces the dedicated 60-batch/minute throttle', async () => {
    for (let i = 0; i < 60; i++) expect((await request(app.getHttpServer()).post('/analytics/events').set('origin', 'https://heygrabit.com').set('x-test-network', 'burst').send(body())).status).toBe(204);
    expect((await request(app.getHttpServer()).post('/analytics/events').set('origin', 'https://heygrabit.com').set('x-test-network', 'burst').send(body())).status).toBe(429);
  });
  it('requires verified identity for linking, audit.read for reports and security.manage for the switch', async () => {
    const server = app.getHttpServer(); const query = '/admin/analytics?since=2026-11-10T00:00:00Z&until=2026-11-11T00:00:00Z';
    expect((await request(server).get(query)).status).toBe(401);
    expect((await request(server).get(query).set('x-test-user', 'scanner')).status).toBe(403);
    expect((await request(server).get(query).set('x-test-user', 'customer')).status).toBe(403);
    expect((await request(server).get(query).set('x-test-user', 'auditor')).status).toBe(200);
    expect((await request(server).put('/admin/analytics/settings').set('x-test-user', 'auditor').send({ enabled: false })).status).toBe(403);
    expect((await request(server).put('/admin/analytics/settings').set('x-test-user', 'security').send({ enabled: true })).status).toBe(400);
    expect((await request(server).put('/admin/analytics/settings').set('x-test-user', 'security').send({ enabled: false })).status).toBe(200);
    const { visitorId, sessionId } = body();
    expect((await request(server).post('/analytics/identify').set('origin', 'https://heygrabit.com').send({ visitorId, sessionId, consentVersion: 'analytics-v2-replay' })).status).toBe(401);
    expect((await request(server).post('/analytics/withdraw').set('origin', 'https://heygrabit.com').send({ visitorId, sessionId, consentVersion: 'analytics-v2-replay' })).body).toEqual({ deleted: true });
  });
  it('requires both personal-data permissions and sanitizes replay before storage', async () => {
    const query = '/admin/analytics/visitors?since=2026-11-10T00:00:00Z&until=2026-11-11T00:00:00Z';
    for (const kind of ['auditor', 'security', 'customer']) expect((await request(app.getHttpServer()).get(query).set('x-test-user', kind)).status).toBe(403);
    expect((await request(app.getHttpServer()).get(query).set('x-test-user', 'owner')).status).toBe(200);
    const input = { id: randomUUID(), recordingId: randomUUID(), pageId: randomUUID(), visitorId: randomUUID(), sessionId: randomUUID(), consentVersion: 'analytics-v2-replay', path: '/', events: [{ type: 4, timestamp: Date.now(), data: { href: 'https://private.test/?email=secret', width: 390, height: 844 } }] };
    const result = await request(app.getHttpServer()).post('/analytics/replay').set('origin', 'https://heygrabit.com').send(input);
    expect(result.status).toBe(200); expect(service.collectReplay).toHaveBeenCalledOnce();
    expect(JSON.stringify(service.collectReplay.mock.calls)).not.toMatch(/private.test|email=secret/);
    const missingConsent = body(); delete (missingConsent as Partial<typeof missingConsent>).overseasConsent;
    expect((await request(app.getHttpServer()).post('/analytics/events').set('origin', 'https://heygrabit.com').send(missingConsent)).status).toBe(400);
  });
});
