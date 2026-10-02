import type { ThrottlerGetTrackerFunction } from '@nestjs/throttler';
import {
  resolveThrottleIpKey,
  resolveThrottleUserId,
  type ThrottleRequestLike,
} from './throttle-identity.js';

/**
 * Route-level overrides for the global `default` throttler.
 *
 * Use them as `@Throttle({ default: ROUTE_THROTTLES.<name> })`. The default
 * throttler buckets per route (controller + handler) and per tracker. Unless
 * an override names its own tracker, anonymous requests are tracked by the
 * trusted client IP and authenticated requests by the verified user id
 * (`TrafficDefenseService.resolveDefaultTracker`). Identity-scoped buckets
 * (email, email + IP) are separate named policies in `TrafficDefenseService`.
 */
type RouteThrottleOptions = {
  limit: number;
  ttl: number;
  getTracker?: ThrottlerGetTrackerFunction;
};

const MINUTE_MS = 60_000;
const FIFTEEN_MINUTES_MS = 15 * MINUTE_MS;

/**
 * Field check-in, offline sync, benefit redemption and monitor calls are made
 * by a shared scanner account from several gate devices at once, and one
 * admission costs several calls. Bucket them per account and network instead
 * of per account, so gates in another venue or on another network do not share
 * a bucket, and leave headroom far above physical gate throughput.
 */
export function resolveFieldOperationsTracker(req: ThrottleRequestLike): string {
  const ipKey = resolveThrottleIpKey(req);
  const userId = resolveThrottleUserId(req);
  return userId ? `field:user:${userId}:ip:${ipKey}` : `field:ip:${ipKey}`;
}

export const ROUTE_THROTTLES = {
  /**
   * POST /auth/refresh with a refresh cookie, per client IP. AuthInitializer
   * refreshes on every full page load, so a shared NAT needs headroom. A
   * request without the cookie is a no-op 204 and skips throttling
   * (`TrafficDefenseService.shouldSkipDefaultThrottle`).
   */
  authRefresh: { limit: 600, ttl: MINUTE_MS },
  /** POST /auth/login per client IP; the `login-account` policy caps email + IP. */
  authLogin: { limit: 100, ttl: MINUTE_MS },
  /** GET /auth/email-availability per client IP (account enumeration ceiling). */
  authEmailAvailability: { limit: 10, ttl: MINUTE_MS },
  /** POST /auth/password-reset/request per client IP; `password-reset-email` caps each address. */
  authPasswordResetRequest: { limit: 10, ttl: FIFTEEN_MINUTES_MS },
  /** POST /auth/password-reset/confirm per client IP. */
  authPasswordResetConfirm: { limit: 3, ttl: FIFTEEN_MINUTES_MS },
  /**
   * POST /auth/email-verification/request and /resend, each per client IP.
   * `email-verification-send` caps each address across IPs.
   */
  authEmailVerificationSend: { limit: 20, ttl: FIFTEEN_MINUTES_MS },
  /** POST /auth/email-verification/verify per client IP; `email-verification-verify` caps email + IP. */
  authEmailVerificationVerify: { limit: 30, ttl: FIFTEEN_MINUTES_MS },
  /** Field operations per scanner account and client network (see resolveFieldOperationsTracker). */
  fieldOperations: {
    limit: 600,
    ttl: MINUTE_MS,
    getTracker: (req) => resolveFieldOperationsTracker(req as ThrottleRequestLike),
  },
} as const satisfies Record<string, RouteThrottleOptions>;
