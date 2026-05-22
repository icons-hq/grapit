import {
  ADMIN_CAPABILITY_BUNDLE_CAPABILITIES,
  type AdminCapability,
  type AdminCapabilityBundle,
  type AdminCapabilityUser,
} from '@grabit/shared';

export interface AdminFixtureUser extends AdminCapabilityUser {
  id: string;
  email: string;
  role: AdminCapabilityBundle;
  adminCapabilityBundle: AdminCapabilityBundle;
  adminCapabilities: readonly AdminCapability[];
}

export function createAdminFixtureUser(
  bundle: AdminCapabilityBundle,
  overrides: Partial<AdminFixtureUser> = {},
): AdminFixtureUser {
  return {
    id: `${bundle}-fixture-user`,
    email: `${bundle}@grabit.test`,
    role: bundle,
    adminCapabilityBundle: bundle,
    adminCapabilities: ADMIN_CAPABILITY_BUNDLE_CAPABILITIES[bundle],
    ...overrides,
  };
}

export function createAdminFixtureUsers(): Record<
  AdminCapabilityBundle,
  AdminFixtureUser
> {
  return {
    operator: createAdminFixtureUser('operator'),
    reviewer: createAdminFixtureUser('reviewer'),
    approver: createAdminFixtureUser('approver'),
    finance: createAdminFixtureUser('finance'),
    scanner: createAdminFixtureUser('scanner'),
    admin: createAdminFixtureUser('admin'),
  };
}
