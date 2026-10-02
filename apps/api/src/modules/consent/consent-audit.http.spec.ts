import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Agent } from 'node:http';
import request from 'supertest';
import type { AdminCapabilityUser } from '@grabit/shared';
import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { createAdminFixtureUser } from '../admin/admin-fixtures.js';
import { ConsentAuditController } from './consent-audit.controller.js';
import { ConsentService } from './consent.service.js';

const USERS: Record<string, AdminCapabilityUser> = {
  // Production field scanner: admin role with only field.scan.* capabilities.
  scanner: {
    id: 'scanner-account',
    role: 'admin',
    adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync'],
  },
  reviewer: { ...createAdminFixtureUser('reviewer'), role: 'admin' },
};

describe('Admin consent audit HTTP access', () => {
  let app: INestApplication;
  let agent: Agent;
  const service = { queryConsentAudit: vi.fn() };

  beforeAll(async () => {
    // Vitest does not emit decorator metadata; restore what tsc emits in production.
    Reflect.defineMetadata('design:paramtypes', [ConsentService], ConsentAuditController);
    Reflect.defineMetadata('design:paramtypes', [Reflector], RolesGuard);
    Reflect.defineMetadata('design:paramtypes', [Reflector], AdminCapabilitiesGuard);
    const module = await Test.createTestingModule({
      controllers: [ConsentAuditController],
      providers: [{ provide: ConsentService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.use((req: { user?: AdminCapabilityUser; headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.user = USERS[req.headers['x-test-user'] ?? ''];
      next();
    });
    await app.init();
    // One listening server and one keep-alive socket for the file. Without it supertest
    // listens on and closes a new ephemeral port per request, which intermittently
    // fails with "socket hang up" when a pooled socket of a closed server is reused.
    await app.listen(0, '127.0.0.1');
    agent = new Agent({ keepAlive: true, maxSockets: 1 });
  });

  afterAll(async () => {
    agent?.destroy();
    await app?.close();
  });

  beforeEach(() => {
    service.queryConsentAudit.mockReset().mockResolvedValue({
      items: [],
      nextCursor: null,
      defaultWindowFrom: '2026-09-24T00:00:00.000Z',
    });
  });

  it('rejects the field scanner token without reading any consent row', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/consent-audit').agent(agent)
      .set('x-test-user', 'scanner');

    expect(response.status).toBe(403);
    expect(service.queryConsentAudit).not.toHaveBeenCalled();
  });

  it('serves an audit reader one default-sized page', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/consent-audit').agent(agent)
      .set('x-test-user', 'reviewer');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], nextCursor: null, defaultWindowFrom: '2026-09-24T00:00:00.000Z' });
    expect(service.queryConsentAudit).toHaveBeenCalledWith({ limit: 100 });
  });

  it('rejects an oversized page and a malformed user id before querying', async () => {
    for (const query of ['limit=501', 'userId=user_123']) {
      const response = await request(app.getHttpServer())
        .get(`/admin/consent-audit?${query}`).agent(agent)
        .set('x-test-user', 'reviewer');
      expect(response.status, query).toBe(400);
    }
    expect(service.queryConsentAudit).not.toHaveBeenCalled();
  });
});
