import {
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_BUNDLE_CAPABILITIES,
  ADMIN_CAPABILITY_BUNDLES,
  type AdminCapability,
  type AdminCapabilityBundle,
  type AdminAuditEvent,
  type AdminOperationsInboxRow,
  type AdminReservationExportFilter,
  type AdminSeatOperationRequest,
  type AdminSecurityStatus,
  type AdminUserDetail,
  type AdminUserExportRequest,
  type AdminUserHardDeleteInput,
  type AdminUserHardDeleteResponse,
  type AdminUserListItem,
  type AdminUserListQuery,
  type AdminUserListResponse,
  type AdminUserPermissionUpdate,
  type AdminUserRecentReservation,
  type AdminUserReservationSummary,
  type AdminUserRole,
  type AdminUserStatsResponse,
  type AdminUserSupportThreadSummary,
  type AdminUserVerificationState,
  type AdminUserWithdrawalInput,
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
  AdminUserStatsRatio,
  AdminUserSignupTrendBucket,
  AdminUserStatsResponse,
  AdminUserExportRequest,
  AdminUserPermissionUpdate,
  AdminUserWithdrawalInput,
  AdminUserHardDeleteInput,
  AdminUserDeletionBlocker,
  AdminUserHardDeleteResponse,
} from '../schemas/admin-operations.schema';

export interface AdminCapabilityUser {
  id: string;
  email?: string;
  role?: string | null;
  /**
   * Stored bundle. DB/JWT values are plain strings, so unknown values are
   * tolerated here: they keep an explicit capability list, and otherwise grant
   * nothing (never the legacy role=admin superuser fallback).
   */
  adminCapabilityBundle?: AdminCapabilityBundle | string | null;
  adminCapabilities?: readonly AdminCapability[] | readonly string[] | null;
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
  userStats?: AdminUserStatsResponse;
  userExport?: AdminUserExportRequest;
  userPermissionUpdate?: AdminUserPermissionUpdate;
  userWithdrawal?: AdminUserWithdrawalInput;
  userHardDelete?: AdminUserHardDeleteInput;
  userHardDeleteResponse?: AdminUserHardDeleteResponse;
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

  const bundle = parseAdminCapabilityBundle(user.adminCapabilityBundle);
  const storedCapabilities = normalizeAdminCapabilities(user.adminCapabilities ?? []);

  // The `admin` bundle is the superuser contract: stored capability lists are
  // ignored. Narrowed admin permissions must use a non-admin bundle; the
  // permission update schema rejects partial lists for this bundle.
  if (bundle === 'admin') {
    return {
      bundle: 'admin',
      capabilities: ADMIN_CAPABILITIES,
      superuser: true,
    };
  }

  if (bundle) {
    const explicitCapabilities = storedCapabilities.length > 0
      ? storedCapabilities
      : ADMIN_CAPABILITY_BUNDLE_CAPABILITIES[bundle];

    return {
      bundle,
      capabilities: explicitCapabilities,
      superuser: false,
    };
  }

  if (storedCapabilities.length > 0) {
    return {
      bundle: null,
      capabilities: storedCapabilities,
      superuser: false,
    };
  }

  // A stored bundle this build does not know (a mistyped manual write, or a
  // bundle from a newer release) fails closed. Only a missing bundle is the
  // legacy role-based fallback; otherwise role=admin with an unknown bundle
  // and no capability list would read as superuser (u12 review).
  if (
    typeof user.adminCapabilityBundle === 'string'
    && user.adminCapabilityBundle.trim() !== ''
  ) {
    return {
      bundle: null,
      capabilities: [],
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

/**
 * Parses a stored/requested bundle value. Every known bundle (including
 * `scanner`) is preserved; unknown values resolve to `null`.
 */
export function parseAdminCapabilityBundle(
  bundle: unknown,
): AdminCapabilityBundle | null {
  return typeof bundle === 'string' &&
    (ADMIN_CAPABILITY_BUNDLES as readonly string[]).includes(bundle)
    ? (bundle as AdminCapabilityBundle)
    : null;
}

function normalizeAdminCapabilities(
  capabilities: readonly string[],
): readonly AdminCapability[] {
  return ADMIN_CAPABILITIES.filter((capability) => capabilities.includes(capability));
}

function isFixtureBundleRole(
  role: string | null | undefined,
): role is Exclude<AdminCapabilityBundle, 'admin'> {
  return (
    role === 'operator' ||
    role === 'reviewer' ||
    role === 'approver' ||
    role === 'finance' ||
    role === 'scanner'
  );
}
