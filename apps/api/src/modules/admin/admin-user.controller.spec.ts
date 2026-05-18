import { describe, expect, it, vi } from 'vitest';

import { AdminUserController } from './admin-user.controller.js';
import type { AdminUserService } from './admin-user.service.js';

function createRequest() {
  return {
    headers: {},
    get: vi.fn((header: string) => {
      const values: Record<string, string> = {
        'user-agent': 'Vitest Admin Browser',
        'x-request-id': 'req-admin-users',
      };
      return values[header.toLowerCase()] ?? undefined;
    }),
    ip: '203.0.113.10',
  };
}

describe('AdminUserController', () => {
  it('delegates user list queries to the admin user service', async () => {
    const service = {
      listUsers: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      }),
    } as unknown as AdminUserService;
    const controller = new AdminUserController(service);

    await controller.listUsers({
      search: 'fan',
      verification: 'all',
      page: 1,
      limit: 20,
    });

    expect(service.listUsers).toHaveBeenCalledWith({
      search: 'fan',
      verification: 'all',
      page: 1,
      limit: 20,
    });
  });

  it('delegates user detail lookups to the admin user service', async () => {
    const service = {
      getUserDetail: vi.fn().mockResolvedValue({ id: 'user-1' }),
    } as unknown as AdminUserService;
    const controller = new AdminUserController(service);

    await controller.getUserDetail('user-1');

    expect(service.getUserDetail).toHaveBeenCalledWith('user-1');
  });

  it('passes actor, reasoned permission body, and request metadata to permission updates', async () => {
    const service = {
      updatePermissions: vi.fn().mockResolvedValue({ id: 'target-user' }),
    } as unknown as AdminUserService;
    const controller = new AdminUserController(service);
    const body = {
      role: 'admin' as const,
      adminCapabilityBundle: 'operator' as const,
      adminCapabilities: ['support.manage' as const],
      reason: 'CS operator rotation',
      confirmed: true as const,
    };

    await controller.updatePermissions(
      'target-user',
      { id: 'actor-admin', email: 'admin@example.com', role: 'admin' },
      body,
      createRequest() as never,
    );

    expect(service.updatePermissions).toHaveBeenCalledWith(
      'actor-admin',
      'target-user',
      body,
      expect.objectContaining({
        userAgent: 'Vitest Admin Browser',
        requestId: 'req-admin-users',
      }),
    );
  });

  it('passes actor, reason, and request metadata to admin user withdrawal', async () => {
    const service = {
      withdrawUser: vi.fn().mockResolvedValue({ id: 'target-user' }),
    } as unknown as AdminUserService;
    const controller = new AdminUserController(service);
    const body = {
      reason: '사용자 요청',
      confirmed: true as const,
    };

    await controller.withdrawUser(
      'target-user',
      { id: 'actor-admin', email: 'admin@example.com', role: 'admin' },
      body,
      createRequest() as never,
    );

    expect(service.withdrawUser).toHaveBeenCalledWith(
      'actor-admin',
      'target-user',
      body,
      expect.objectContaining({
        userAgent: 'Vitest Admin Browser',
        requestId: 'req-admin-users',
      }),
    );
  });

  it('passes actor, reason, and request metadata to hard delete', async () => {
    const service = {
      hardDeleteUser: vi.fn().mockResolvedValue({
        deleted: true,
        userId: 'target-user',
        blockers: [],
      }),
    } as unknown as AdminUserService;
    const controller = new AdminUserController(service);
    const body = {
      reason: '테스트 데이터 정리',
      confirmed: true as const,
    };

    await controller.hardDeleteUser(
      'target-user',
      { id: 'actor-admin', email: 'admin@example.com', role: 'admin' },
      body,
      createRequest() as never,
    );

    expect(service.hardDeleteUser).toHaveBeenCalledWith(
      'actor-admin',
      'target-user',
      body,
      expect.objectContaining({
        userAgent: 'Vitest Admin Browser',
        requestId: 'req-admin-users',
      }),
    );
  });
});
