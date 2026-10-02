import { describe, expect, it, vi } from 'vitest';
import { AdminOperationsController } from './admin-operations.controller.js';
import type { AdminOperationsService } from './admin-operations.service.js';

describe('AdminOperationsController audit request context', () => {
  it('records the trusted peer IP, not a client-supplied X-Forwarded-For entry', async () => {
    const service = { escalateThread: vi.fn().mockResolvedValue({ ok: true }) };
    const controller = new AdminOperationsController(
      service as unknown as AdminOperationsService,
    );

    await controller.escalateThread(
      'thread-1',
      'admin-1',
      { reason: 'needs finance review' },
      {
        ip: '203.0.113.99',
        headers: {
          'x-forwarded-for': '198.51.100.1, 203.0.113.99',
          'user-agent': 'Vitest Browser',
        },
        socket: { remoteAddress: '203.0.113.99' },
      } as never,
    );

    expect(service.escalateThread).toHaveBeenCalledWith(
      'thread-1',
      'admin-1',
      { reason: 'needs finance review' },
      { ipAddress: '203.0.113.99', userAgent: 'Vitest Browser' },
    );
  });
});
