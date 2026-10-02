import { describe, expect, it } from 'vitest';
import { canUseAdminBookingBypass } from './admin-booking-bypass.js';

describe('canUseAdminBookingBypass', () => {
  it('allows a full admin bundle and the legacy full admin', () => {
    expect(canUseAdminBookingBypass({
      id: 'admin-1', role: 'admin', adminCapabilityBundle: 'admin', adminCapabilities: [],
    })).toBe(true);
    expect(canUseAdminBookingBypass({
      id: 'admin-2', role: 'admin', adminCapabilityBundle: null, adminCapabilities: [],
    })).toBe(true);
  });

  it.each(['scanner', 'finance', 'operator', 'reviewer', 'approver'])(
    'denies the restricted %s bundle even though it carries role=admin (audit #25)',
    (bundle) => {
      expect(canUseAdminBookingBypass({
        id: 'staff-1', role: 'admin', adminCapabilityBundle: bundle, adminCapabilities: [],
      })).toBe(false);
    },
  );

  it('denies an admin limited to explicit capabilities', () => {
    expect(canUseAdminBookingBypass({
      id: 'staff-2',
      role: 'admin',
      adminCapabilityBundle: null,
      adminCapabilities: ['field.scan.verify', 'field.scan.consume'],
    })).toBe(false);
  });

  it('fails closed when capability claims were not forwarded', () => {
    expect(canUseAdminBookingBypass({ id: 'admin-3', role: 'admin' })).toBe(false);
    expect(canUseAdminBookingBypass({ id: 'admin-4', role: 'admin', adminCapabilityBundle: null })).toBe(false);
  });

  it('denies buyers and missing actors', () => {
    expect(canUseAdminBookingBypass({
      id: 'buyer-1', role: 'user', adminCapabilityBundle: 'admin', adminCapabilities: [],
    })).toBe(false);
    expect(canUseAdminBookingBypass(undefined)).toBe(false);
    expect(canUseAdminBookingBypass(null)).toBe(false);
  });
});
