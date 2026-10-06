import { describe, expect, it, vi } from 'vitest';
import { QueueController } from './queue.controller.js';

function createQueueService() {
  return {
    resolveBrowserIdentity: vi.fn().mockResolvedValue({
      userId: 'user-1',
      refreshTokenFamilyId: 'family-1',
      deviceSlotId: 'family-1',
    }),
    enterPerformanceQueue: vi.fn().mockResolvedValue({
      queueSessionId: 'queue-session-1',
      admissionToken: 'opaque-admission-token',
      state: 'WAITING',
      position: 1,
      waitingCount: 1,
      etaSeconds: 10,
      remainingSeats: 10,
      autoEnter: false,
      admittedAt: null,
      activeUntilAt: null,
      reentryGraceUntilAt: null,
    }),
  };
}

function enter(user: Record<string, unknown>) {
  const queueService = createQueueService();
  const controller = new QueueController(queueService as never);
  const response = { cookie: vi.fn() };
  const request = { user, cookies: { refreshToken: 'refresh-cookie' } };
  return {
    queueService,
    result: controller.enterQueue('performance-1', request as never, response as never),
  };
}

describe('QueueController enterQueue admin bypass', () => {
  it('lets a full admin skip the queue and the sale-open gate', async () => {
    const { queueService, result } = enter({
      id: 'admin-1', role: 'admin', adminCapabilityBundle: 'admin', adminCapabilities: [],
    });
    await result;

    expect(queueService.enterPerformanceQueue).toHaveBeenCalledWith(expect.objectContaining({
      bypassQueue: true,
      actorRole: 'admin',
    }));
  });

  it('queues a restricted scanner admin like a Buyer, with the sale-open gate applied (audit #25)', async () => {
    const { queueService, result } = enter({
      id: 'scanner-1', role: 'admin', adminCapabilityBundle: 'scanner', adminCapabilities: [],
    });
    await result;

    const params = queueService.enterPerformanceQueue.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.bypassQueue).toBe(false);
    expect(params.actorRole).toBeUndefined();
  });
});
