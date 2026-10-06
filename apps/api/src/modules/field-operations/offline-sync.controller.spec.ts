import 'reflect-metadata';
import { Agent } from 'node:http';
import { type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AdminCapability } from '@grabit/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { OfflineSyncController } from './offline-sync.controller.js';
import { OfflineSyncService } from './offline-sync.service.js';

const SHOWTIME_ID = '00000000-0000-4000-8000-000000000001';

function syncBody() {
  return {
    attempts: [{
      deviceAttemptId: 'device-attempt-1',
      scannerUserId: 'scanner-1',
      showtimeId: SHOWTIME_ID,
      attemptedAt: '2026-10-02T10:00:00.000Z',
      token: 'opaque-qr-token',
      redactedTokenRef: 'qr:redacted',
      syncState: 'pending',
    }],
  };
}

// Syncing a pending attempt confirms venue entry, so field.scan.sync alone must
// not bypass field.scan.consume (audit #111).
describe('OfflineSyncController permissions', () => {
  let app: INestApplication;
  let agent: Agent;
  let user: Record<string, unknown>;
  const service = { syncPendingAttempts: vi.fn() };

  beforeAll(async () => {
    Reflect.defineMetadata('design:paramtypes', [OfflineSyncService], OfflineSyncController);
    const moduleRef = await Test.createTestingModule({
      controllers: [OfflineSyncController],
      providers: [{ provide: OfflineSyncService, useValue: service }],
    })
      .overrideGuard(RolesGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = user;
          return true;
        },
      })
      .overrideGuard(AdminCapabilitiesGuard)
      .useValue(new AdminCapabilitiesGuard(new Reflector()))
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    // One listening server and one keep-alive socket for the suite. Without it
    // supertest listens on and closes a new ephemeral port per request.
    await app.listen(0, '127.0.0.1');
    agent = new Agent({ keepAlive: true, maxSockets: 1 });
  });

  beforeEach(() => {
    service.syncPendingAttempts.mockReset().mockResolvedValue({ results: [] });
  });

  afterAll(async () => {
    agent?.destroy();
    await app?.close();
  });

  it.each<[string, AdminCapability[]]>([
    ['sync without entry permission', ['field.scan.verify', 'field.scan.sync']],
    ['entry without sync permission', ['field.scan.verify', 'field.scan.consume']],
  ])('rejects %s before any pending attempt is processed', async (_label, capabilities) => {
    user = { id: 'scanner-1', role: 'admin', adminCapabilities: capabilities };

    const response = await request(app.getHttpServer())
      .post('/field/check-in/offline-sync')
      .agent(agent)
      .send(syncBody());

    expect(response.status).toBe(403);
    expect(service.syncPendingAttempts).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>]>([
    ['custom sync and entry permissions', { adminCapabilities: ['field.scan.sync', 'field.scan.consume'] }],
    ['the scanner bundle', { adminCapabilityBundle: 'scanner' }],
  ])('syncs with %s', async (_label, grant) => {
    user = { id: 'scanner-1', role: 'admin', ...grant };

    const response = await request(app.getHttpServer())
      .post('/field/check-in/offline-sync')
      .agent(agent)
      .send(syncBody());

    expect(response.status).toBe(201);
    expect(service.syncPendingAttempts).toHaveBeenCalledTimes(1);
  });
});
