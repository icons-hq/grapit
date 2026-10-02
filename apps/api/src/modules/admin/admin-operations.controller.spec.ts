import 'reflect-metadata';
import { Agent } from 'node:http';
import type { Request } from 'express';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminCapabilitiesGuard } from '../../common/guards/admin-capabilities.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AdminOperationsController } from './admin-operations.controller.js';
import { AdminOperationsService } from './admin-operations.service.js';

function createRequest(options: {
  peerIp: string;
  headers?: Record<string, string>;
}): Request {
  const headers = options.headers ?? {};
  return {
    ip: options.peerIp,
    headers,
    socket: { remoteAddress: options.peerIp },
    get: vi.fn((name: string) => headers[name.toLowerCase()]),
  } as unknown as Request;
}

function createController() {
  const service = {
    escalateThread: vi.fn().mockResolvedValue({ id: 'thread-1', escalationState: 'manual_escalated' }),
    updateThreadStatus: vi.fn().mockResolvedValue({ id: 'thread-1', status: 'resolved' }),
    reassignThread: vi.fn().mockResolvedValue({ id: 'thread-1', assigneeUserId: null }),
  };
  return {
    service,
    controller: new AdminOperationsController(service as unknown as AdminOperationsService),
  };
}

describe('AdminOperationsController audit request context (audit #123)', () => {
  it('ignores a client-supplied X-Forwarded-For value from a non-proxy peer', async () => {
    const { service, controller } = createController();
    const request = createRequest({
      peerIp: '198.51.100.20',
      headers: {
        'x-forwarded-for': '1.2.3.4',
        'user-agent': 'Admin Console',
      },
    });

    await controller.escalateThread('thread-1', 'admin-1', { reason: 'payment issue' }, request);
    await controller.updateThreadStatus(
      'thread-1',
      'admin-1',
      { status: 'resolved', reason: 'done' },
      request,
    );
    await controller.reassignThread(
      'thread-1',
      'admin-1',
      { assigneeUserId: null, reason: 'unassign' },
      request,
    );

    const expectedContext = { ipAddress: '198.51.100.20', userAgent: 'Admin Console' };
    expect(service.escalateThread).toHaveBeenCalledWith(
      'thread-1',
      'admin-1',
      { reason: 'payment issue' },
      expectedContext,
    );
    expect(service.updateThreadStatus.mock.calls[0]?.[3]).toEqual(expectedContext);
    expect(service.reassignThread.mock.calls[0]?.[3]).toEqual(expectedContext);
  });

  it('uses the trusted client IP behind Cloudflare and bounds the user agent to the audit column', async () => {
    const { service, controller } = createController();
    const request = createRequest({
      // Cloudflare edge address (173.245.48.0/20).
      peerIp: '173.245.48.10',
      headers: {
        'cf-connecting-ip': '203.0.113.77',
        'x-forwarded-for': '1.2.3.4, 173.245.48.10',
        'user-agent': 'A'.repeat(800),
      },
    });

    await controller.escalateThread('thread-1', 'admin-1', { reason: 'payment issue' }, request);

    const context = service.escalateThread.mock.calls[0]?.[3] as {
      ipAddress: string;
      userAgent: string;
    };
    expect(context.ipAddress).toBe('203.0.113.77');
    expect(context.userAgent).toHaveLength(500);
  });

  it('records the trusted peer IP, not a client-supplied X-Forwarded-For entry (audit #5)', async () => {
    const { service, controller } = createController();

    await controller.escalateThread(
      'thread-1',
      'admin-1',
      { reason: 'needs finance review' },
      createRequest({
        peerIp: '203.0.113.99',
        headers: {
          'x-forwarded-for': '198.51.100.1, 203.0.113.99',
          'user-agent': 'Vitest Browser',
        },
      }),
    );

    expect(service.escalateThread).toHaveBeenCalledWith(
      'thread-1',
      'admin-1',
      { reason: 'needs finance review' },
      { ipAddress: '203.0.113.99', userAgent: 'Vitest Browser' },
    );
  });
});

describe('GET /admin/operations/inbox priority validation (u15)', () => {
  let app: INestApplication;
  let agent: Agent;
  const service = {
    listInbox: vi.fn(async () => ({ rows: [], totals: { all: 0, escalated: 0, overdue: 0, dueSoon: 0 } })),
  };

  beforeAll(async () => {
    Reflect.defineMetadata('design:paramtypes', [AdminOperationsService], AdminOperationsController);
    const module = await Test.createTestingModule({
      controllers: [AdminOperationsController],
      providers: [{ provide: AdminOperationsService, useValue: service }],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminCapabilitiesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
    // One listening server and one keep-alive socket for the whole suite.
    await app.listen(0, '127.0.0.1');
    agent = new Agent({ keepAlive: true, maxSockets: 1 });
  });

  afterAll(async () => {
    agent?.destroy();
    await app?.close();
  });

  beforeEach(() => service.listInbox.mockClear());

  it('rejects an unknown priority with 400 instead of treating it as normal', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/operations/inbox')
      .query({ priority: 'urgent' })
      .agent(agent);

    expect(response.status).toBe(400);
    expect(service.listInbox).not.toHaveBeenCalled();
  });

  it.each(['normal', 'due_soon', 'overdue', 'escalated'])('accepts the %s priority filter', async (priority) => {
    const response = await request(app.getHttpServer())
      .get('/admin/operations/inbox')
      .query({ priority })
      .agent(agent);

    expect(response.status).toBe(200);
    expect(service.listInbox).toHaveBeenCalledWith(expect.objectContaining({ priority }));
  });

  it('keeps the inbox unfiltered when no priority is given', async () => {
    const response = await request(app.getHttpServer()).get('/admin/operations/inbox').agent(agent);

    expect(response.status).toBe(200);
    expect(service.listInbox).toHaveBeenCalledWith(expect.objectContaining({ priority: undefined }));
  });
});
