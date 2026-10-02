import {
  resolveAdminCapabilitySnapshot,
  type AdminCapability,
  type AdminCapabilityBundle,
} from '@grabit/shared';

/**
 * Actor claims needed to decide Admin Booking Bypass. The JWT strategy always
 * provides both capability claims (`null`/`[]` for a legacy full admin).
 */
export type AdminBookingBypassActor = {
  id?: string;
  role?: string | null;
  adminCapabilityBundle?: string | null;
  adminCapabilities?: readonly string[] | null;
};

/**
 * Admin Booking Bypass (CONTEXT.md) lets an authorized admin skip the queue,
 * the Sitewide Booking Gate, Performance Publication and the sale start time
 * for Admin Pre-Open Booking Smoke. Only full admins (`superuser`) qualify:
 * restricted bundles such as scanner/finance/operator also carry
 * role='admin' and must book like a Buyer.
 *
 * Fails closed when the capability claims were not forwarded: without them a
 * restricted bundle account is indistinguishable from a full admin.
 */
export function canUseAdminBookingBypass(
  actor: AdminBookingBypassActor | null | undefined,
): boolean {
  if (!actor || actor.role !== 'admin') {
    return false;
  }
  if (actor.adminCapabilityBundle === undefined || !Array.isArray(actor.adminCapabilities)) {
    return false;
  }

  return resolveAdminCapabilitySnapshot({
    id: actor.id ?? '',
    role: actor.role,
    adminCapabilityBundle: actor.adminCapabilityBundle as AdminCapabilityBundle | null,
    adminCapabilities: actor.adminCapabilities as readonly AdminCapability[],
  }).superuser;
}
