import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AdminCapability, AdminCapabilityUser } from '@grabit/shared';

import { createAdminFixtureUser } from '../../modules/admin/admin-fixtures.js';
import { ADMIN_CAPABILITIES_KEY } from '../decorators/admin-capabilities.decorator.js';
import { AdminCapabilitiesGuard } from './admin-capabilities.guard.js';

function createMockReflector(capabilities?: AdminCapability[]): Reflector {
  return {
    getAllAndOverride: vi.fn().mockImplementation((key: string) => {
      if (key === ADMIN_CAPABILITIES_KEY) {
        return capabilities;
      }
      return undefined;
    }),
  } as unknown as Reflector;
}

function createMockExecutionContext(
  user?: AdminCapabilityUser,
): ExecutionContext {
  const request = { user };

  return {
    switchToHttp: vi.fn().mockReturnValue({
      getRequest: vi.fn().mockReturnValue(request),
    }),
    getHandler: vi.fn(),
    getClass: vi.fn(),
    getArgs: vi.fn(),
    getArgByIndex: vi.fn(),
    switchToRpc: vi.fn(),
    switchToWs: vi.fn(),
    getType: vi.fn().mockReturnValue('http'),
  } as unknown as ExecutionContext;
}

describe('AdminCapabilitiesGuard', () => {
  it('allows existing admin role users to satisfy every capability', () => {
    const guard = new AdminCapabilitiesGuard(
      createMockReflector(['security.manage', 'reservations.export_raw']),
    );

    expect(
      guard.canActivate(createMockExecutionContext({ id: 'admin-1', role: 'admin' })),
    ).toBe(true);
  });

  it('allows fixture bundle users only for declared capabilities', () => {
    const guard = new AdminCapabilitiesGuard(
      createMockReflector(['support.manage', 'seat.disable']),
    );

    expect(
      guard.canActivate(createMockExecutionContext(createAdminFixtureUser('operator'))),
    ).toBe(true);
  });

  it('denies fixture bundle users when any required capability is missing', () => {
    const guard = new AdminCapabilitiesGuard(
      createMockReflector(['reservations.export_raw']),
    );

    expect(
      guard.canActivate(createMockExecutionContext(createAdminFixtureUser('operator'))),
    ).toBe(false);
  });

  it('denies unauthenticated access when capabilities are required', () => {
    const guard = new AdminCapabilitiesGuard(
      createMockReflector(['event.publish']),
    );

    expect(guard.canActivate(createMockExecutionContext())).toBe(false);
  });
});
