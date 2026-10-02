import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import type { AdminCapabilityUser } from '@grabit/shared';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { createAdminFixtureUser } from './admin-fixtures.js';
import { AdminDashboardController } from './admin-dashboard.controller.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminDiagnosticsController } from './admin-diagnostics.controller.js';

const sentry = vi.hoisted(() => ({ captureException: vi.fn(() => 'event-1') }));
vi.mock('@sentry/nestjs', () => sentry);

const USERS: Record<string, AdminCapabilityUser> = {
  // Production field scanner: admin role with only field.scan.* capabilities.
  scanner: {
    id: 'scanner-account',
    role: 'admin',
    adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync'],
  },
  operator: { ...createAdminFixtureUser('operator'), role: 'admin' },
  superuser: { ...createAdminFixtureUser('admin'), role: 'admin' },
  // Legacy admin with no bundle or capabilities stays a superuser.
  legacyAdmin: { id: 'legacy-admin', role: 'admin' },
};

describe('Admin dashboard and diagnostics HTTP access', () => {
  let app: INestApplication;
  const dashboard = {
    getSummary: vi.fn(),
    getRevenueTrend: vi.fn(),
    getGenreDistribution: vi.fn(),
    getPaymentDistribution: vi.fn(),
    getTopPerformances: vi.fn(),
  };

  beforeAll(async () => {
    // Vitest does not emit decorator metadata; restore what tsc emits in production.
    Reflect.defineMetadata('design:paramtypes', [Reflector], RolesGuard);
    Reflect.defineMetadata('design:paramtypes', [Reflector], AdminCapabilitiesGuard);
    const module = await Test.createTestingModule({
      controllers: [AdminDashboardController, AdminDiagnosticsController],
      providers: [{ provide: AdminDashboardService, useValue: dashboard }],
    }).compile();
    app = module.createNestApplication();
    app.use((req: { user?: AdminCapabilityUser; headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.user = USERS[req.headers['x-test-user'] ?? ''];
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    for (const fn of Object.values(dashboard)) fn.mockReset().mockResolvedValue([]);
    sentry.captureException.mockClear();
  });

  it.each([
    '/admin/dashboard/summary',
    '/admin/dashboard/revenue?period=30d',
    '/admin/dashboard/genre?period=30d',
    '/admin/dashboard/payment?period=30d',
    '/admin/dashboard/top-performances',
  ])('denies the field scanner token %s before reading sales data', async (path) => {
    const response = await request(app.getHttpServer()).get(path).set('x-test-user', 'scanner');

    expect(response.status).toBe(403);
    for (const fn of Object.values(dashboard)) expect(fn).not.toHaveBeenCalled();
  });

  it('serves the dashboard to admins with reservations.read and to legacy admins', async () => {
    for (const user of ['operator', 'superuser', 'legacyAdmin']) {
      const response = await request(app.getHttpServer())
        .get('/admin/dashboard/summary')
        .set('x-test-user', user);
      expect(response.status, user).toBe(200);
    }
    expect(dashboard.getSummary).toHaveBeenCalledTimes(3);
  });

  it('lets only security.manage holders send a Sentry diagnostic event', async () => {
    for (const user of ['scanner', 'operator']) {
      const response = await request(app.getHttpServer())
        .get('/admin/_sentry-test')
        .set('x-test-user', user);
      expect(response.status, user).toBe(403);
    }
    expect(sentry.captureException).not.toHaveBeenCalled();

    const response = await request(app.getHttpServer())
      .get('/admin/_sentry-test')
      .set('x-test-user', 'superuser');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ eventId: 'event-1' });
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
