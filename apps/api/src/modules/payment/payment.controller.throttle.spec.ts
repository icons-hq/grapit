import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PaymentController } from './payment.controller.js';
import { TrafficDefenseService } from '../traffic/traffic-defense.service.js';

/**
 * Cross-unit seam (w2a × u06): the buyer payment endpoints must stay under
 * the global `default` throttler (60/min per user and route). The handoff
 * branch and its release make no provider call, so the default bucket is
 * their limit; async-return may query Toss and has its own named policy.
 * A @SkipThrottle here would leave an authenticated loop unbounded.
 */
const DEFAULT_SKIP_METADATA = 'THROTTLER:SKIPdefault';

describe('PaymentController throttling', () => {
  it.each([
    'getTossPaymentBranch',
    'releaseTossPaymentHandoff',
    'reconcileAsyncPaymentReturn',
  ] as const)('%s keeps the default throttler', (handler) => {
    expect(Reflect.getMetadata(DEFAULT_SKIP_METADATA, PaymentController)).toBeUndefined();
    expect(
      Reflect.getMetadata(DEFAULT_SKIP_METADATA, PaymentController.prototype[handler]),
    ).toBeUndefined();
  });

  it('caps async payment returns with the dedicated per-user policy', () => {
    const asyncReturn = new TrafficDefenseService()
      .getThrottlerOptions()
      .find((throttler) => throttler.name === 'async-payment-return');

    expect(asyncReturn).toMatchObject({ ttl: 60_000, limit: 6 });
  });
});
