import { resolveAdminCapabilitySnapshot, type UserProfile } from '@grabit/shared';

/** Match the API: only full admins with explicit capability claims may bypass sales gates. */
export function canUseAdminBookingBypass(user: UserProfile | null | undefined): boolean {
  if (!user || user.role !== 'admin') return false;
  if (user.adminCapabilityBundle === undefined || !Array.isArray(user.adminCapabilities)) return false;
  return resolveAdminCapabilitySnapshot(user).superuser;
}
