import { describe, expect, it } from 'vitest';

import { ADMIN_CAPABILITY_BUNDLE_CAPABILITIES } from '@grabit/shared';
import {
  createAdminFixtureUser,
  createAdminFixtureUsers,
} from './admin-fixtures.js';

describe('admin fixture helpers', () => {
  it('creates a superuser fixture for the existing admin role', () => {
    const admin = createAdminFixtureUser('admin');

    expect(admin.role).toBe('admin');
    expect(admin.adminCapabilityBundle).toBe('admin');
    expect(admin.adminCapabilities).toEqual(ADMIN_CAPABILITY_BUNDLE_CAPABILITIES.admin);
  });

  it('creates bundle-scoped fixture users without granting raw export to operators', () => {
    const operator = createAdminFixtureUser('operator');

    expect(operator.role).toBe('operator');
    expect(operator.adminCapabilityBundle).toBe('operator');
    expect(operator.adminCapabilities).toContain('support.manage');
    expect(operator.adminCapabilities).not.toContain('reservations.export_raw');
  });

  it('creates deterministic non-persisted fixtures for every bundle', () => {
    const fixtures = createAdminFixtureUsers();

    expect(Object.keys(fixtures)).toEqual([
      'operator',
      'reviewer',
      'approver',
      'finance',
      'admin',
    ]);
    expect(fixtures.finance.adminCapabilities).toContain('reservations.export_raw');
    expect(fixtures.finance.adminCapabilities).not.toContain('seat.disable');
  });
});
