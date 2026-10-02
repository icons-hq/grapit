import { describe, expect, it } from 'vitest';
import { BenefitRedemptionController } from '../field-operations/benefit-redemption.controller.js';
import { FieldCheckInController } from '../field-operations/field-check-in.controller.js';
import { FieldMonitorController } from '../field-operations/field-monitor.controller.js';
import { OfflineSyncController } from '../field-operations/offline-sync.controller.js';
import { PaymentWebhookController } from '../payment/payment-webhook.controller.js';
import { ROUTE_THROTTLES, resolveFieldOperationsTracker } from './route-throttles.js';
import { toThrottleIpKey } from './throttle-identity.js';

const DEFAULT_SKIP_METADATA = 'THROTTLER:SKIPdefault';
const DEFAULT_LIMIT_METADATA = 'THROTTLER:LIMITdefault';
const DEFAULT_TRACKER_METADATA = 'THROTTLER:TRACKERdefault';

describe('route throttle overrides', () => {
  it.each([
    ['FieldCheckInController', FieldCheckInController],
    ['OfflineSyncController', OfflineSyncController],
    ['BenefitRedemptionController', BenefitRedemptionController],
    ['FieldMonitorController', FieldMonitorController],
  ])('%s uses the field-operations throttle instead of the 60/min default (audit #15)', (_name, controller) => {
    expect(Reflect.getMetadata(DEFAULT_LIMIT_METADATA, controller)).toBe(
      ROUTE_THROTTLES.fieldOperations.limit,
    );
    expect(Reflect.getMetadata(DEFAULT_TRACKER_METADATA, controller)).toBe(
      ROUTE_THROTTLES.fieldOperations.getTracker,
    );
    expect(ROUTE_THROTTLES.fieldOperations.limit).toBeGreaterThanOrEqual(600);
  });

  it('skips the default throttler for the Toss webhook only (audit #20)', () => {
    expect(
      Reflect.getMetadata(
        DEFAULT_SKIP_METADATA,
        PaymentWebhookController.prototype.handleTossWebhook,
      ),
    ).toBe(true);
    expect(Reflect.getMetadata(DEFAULT_SKIP_METADATA, PaymentWebhookController)).toBeUndefined();
  });

  it('tracks field operations per scanner account and client network', () => {
    const request = (userId: string | undefined, ip: string) =>
      ({
        ip,
        socket: { remoteAddress: ip },
        headers: {},
        ...(userId ? { user: { id: userId } } : {}),
      }) as never;

    expect(resolveFieldOperationsTracker(request('scanner-1', '198.51.100.7'))).toBe(
      'field:user:scanner-1:ip:198.51.100.7',
    );
    expect(resolveFieldOperationsTracker(request('scanner-1', '203.0.113.20'))).not.toBe(
      resolveFieldOperationsTracker(request('scanner-1', '198.51.100.7')),
    );
    expect(resolveFieldOperationsTracker(request(undefined, '198.51.100.7'))).toBe(
      'field:ip:198.51.100.7',
    );
  });

  it('keeps IPv4 keys and folds IPv6 keys to their /64 prefix', () => {
    expect(toThrottleIpKey('198.51.100.7')).toBe('198.51.100.7');
    expect(toThrottleIpKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(toThrottleIpKey('2001:0db8:0000:0042:ffff:0000:0000:0001')).toBe('2001:db8:0:42::/64');
    expect(toThrottleIpKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(toThrottleIpKey('0.0.0.0')).toBe('0.0.0.0');
  });
});
