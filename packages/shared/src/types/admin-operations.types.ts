import {
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_BUNDLE_CAPABILITIES,
  type AdminCapability,
  type AdminCapabilityBundle,
  type AdminAuditEvent,
  type AdminOperationsInboxRow,
  type AdminReservationExportFilter,
  type AdminSeatOperationRequest,
  type AdminSecurityStatus,
  type AdminUserDetail,
  type AdminUserListItem,
  type AdminUserListQuery,
  type AdminUserListResponse,
  type AdminUserPermissionUpdate,
  type AdminUserRecentReservation,
  type AdminUserReservationSummary,
  type AdminUserRole,
  type AdminUserSupportThreadSummary,
  type AdminUserVerificationState,
} from '../schemas/admin-operations.schema';

export type {
  AdminCapability,
  AdminCapabilityBundle,
  AdminPublishLifecycle,
  AdminSupportCategory,
  AdminCsCategory,
  AdminOperationsInboxRow,
  AdminFaqAuthoringInput,
  AdminNoticeAuthoringInput,
  AdminAuditAction,
  AdminAuditEvent,
  AdminAllowlistRecord,
  AdminReservationExportFilter,
  AdminSeatOperationRequest,
  AdminSeatOperationHistory,
  AdminSecurityStatus,
  AdminUserRole,
  AdminUserListQuery,
  AdminUserVerificationState,
  AdminUserReservationSummary,
  AdminUserListItem,
  AdminUserRecentReservation,
  AdminUserSupportThreadSummary,
  AdminUserDetail,
  AdminUserListResponse,
  AdminUserPermissionUpdate,
} from '../schemas/admin-operations.schema';

export interface AdminCapabilityUser {
  id: string;
  email?: string;
  role?: string | null;
  adminCapabilityBundle?: AdminCapabilityBundle | null;
  adminCapabilities?: readonly AdminCapability[] | null;
}

export interface AdminCapabilitySnapshot {
  bundle: AdminCapabilityBundle | null;
  capabilities: readonly AdminCapability[];
  superuser: boolean;
}

export interface AdminOperationsContract {
  capabilities: readonly AdminCapability[];
  bundles: typeof ADMIN_CAPABILITY_BUNDLE_CAPABILITIES;
  inboxRows: AdminOperationsInboxRow[];
  auditEvents: AdminAuditEvent[];
  exportFilter?: AdminReservationExportFilter;
  seatOperation?: AdminSeatOperationRequest;
  securityStatus: AdminSecurityStatus;
  userListQuery?: AdminUserListQuery;
  userListItems?: AdminUserListItem[];
  userDetail?: AdminUserDetail;
  userPermissionUpdate?: AdminUserPermissionUpdate;
}

export function resolveAdminCapabilitySnapshot(
  user: AdminCapabilityUser | null | undefined,
): AdminCapabilitySnapshot {
  if (!user) {
    return {
      bundle: null,
      capabilities: [],
      superuser: false,
    };
  }

  if (user.adminCapabilityBundle === 'admin') {
    return {
      bundle: 'admin',
      capabilities: ADMIN_CAPABILITIES,
      superuser: true,
    };
  }

  if (user.adminCapabilityBundle) {
    const explicitCapabilities = user.adminCapabilities?.length
      ? normalizeAdminCapabilities(user.adminCapabilities)
      : ADMIN_CAPABILITY_BUNDLE_CAPABILITIES[user.adminCapabilityBundle];

    return {
      bundle: user.adminCapabilityBundle,
      capabilities: explicitCapabilities,
      superuser: false,
    };
  }

  if (user.adminCapabilities?.length) {
    return {
      bundle: null,
      capabilities: normalizeAdminCapabilities(user.adminCapabilities),
      superuser: false,
    };
  }

  if (user.role === 'admin') {
    return {
      bundle: 'admin',
      capabilities: ADMIN_CAPABILITIES,
      superuser: true,
    };
  }

  if (isFixtureBundleRole(user.role)) {
    return {
      bundle: user.role,
      capabilities: ADMIN_CAPABILITY_BUNDLE_CAPABILITIES[user.role],
      superuser: false,
    };
  }

  return {
    bundle: null,
    capabilities: [],
    superuser: false,
  };
}

export function hasAdminCapability(
  user: AdminCapabilityUser | null | undefined,
  capability: AdminCapability,
): boolean {
  return resolveAdminCapabilitySnapshot(user).capabilities.includes(capability);
}

function normalizeAdminCapabilities(
  capabilities: readonly AdminCapability[],
): readonly AdminCapability[] {
  const validCapabilities = new Set<AdminCapability>(ADMIN_CAPABILITIES);
  return ADMIN_CAPABILITIES.filter(
    (capability) =>
      validCapabilities.has(capability) && capabilities.includes(capability),
  );
}

function isFixtureBundleRole(
  role: string | null | undefined,
): role is Exclude<AdminCapabilityBundle, 'admin'> {
  return role === 'operator' || role === 'reviewer' || role === 'approver' || role === 'finance';
}
