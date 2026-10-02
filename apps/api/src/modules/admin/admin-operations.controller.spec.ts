import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AdminOperationsController } from './admin-operations.controller.js';
import type { AdminOperationsService } from './admin-operations.service.js';

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
});
