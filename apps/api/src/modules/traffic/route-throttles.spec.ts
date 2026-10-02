import { RequestMethod, type ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { BenefitRedemptionController } from '../field-operations/benefit-redemption.controller.js';
import { FieldCheckInController } from '../field-operations/field-check-in.controller.js';
import { FieldMonitorController } from '../field-operations/field-monitor.controller.js';
import { OfflineSyncController } from '../field-operations/offline-sync.controller.js';
import { AuthController } from '../auth/auth.controller.js';
import { PaymentWebhookController } from '../payment/payment-webhook.controller.js';
import { UserController } from '../user/user.controller.js';
import {
  ROUTE_THROTTLES,
  resolveCurrentUserProfileTracker,
  resolveFieldOperationsTracker,
} from './route-throttles.js';
import { THROTTLE_EMAIL_BODY_METADATA, toThrottleIpKey } from './throttle-identity.js';
import { TrafficDefenseService, type TrafficPolicyName } from './traffic-defense.service.js';

const DEFAULT_SKIP_METADATA = 'THROTTLER:SKIPdefault';
const DEFAULT_LIMIT_METADATA = 'THROTTLER:LIMITdefault';
const DEFAULT_TRACKER_METADATA = 'THROTTLER:TRACKERdefault';
/** `RouteParamtypes.BODY` in @nestjs/common. */
const BODY_ROUTE_PARAM_TYPE = 3;

/** The schema of the route's `@Body(new ZodValidationPipe(schema))`. */
function bodyValidationSchema(controller: object, handlerName: string): unknown {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handlerName) ?? {}) as Record<
    string,
    { pipes?: unknown[] }
  >;
  const body = Object.entries(args).find(([key]) => key.startsWith(`${BODY_ROUTE_PARAM_TYPE}:`))?.[1];
  const pipe = body?.pipes?.find((candidate) => candidate instanceof ZodValidationPipe);
  return (pipe as { schema?: unknown } | undefined)?.schema;
}

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

  it('gives GET /users/me a per-user-and-network bucket, not the 60/min per-account default (audit #15)', () => {
    expect(Reflect.getMetadata(DEFAULT_LIMIT_METADATA, UserController.prototype.getProfile)).toBe(
      ROUTE_THROTTLES.currentUserProfile.limit,
    );
    expect(Reflect.getMetadata(DEFAULT_TRACKER_METADATA, UserController.prototype.getProfile)).toBe(
      ROUTE_THROTTLES.currentUserProfile.getTracker,
    );
    expect(ROUTE_THROTTLES.currentUserProfile.limit).toBeGreaterThanOrEqual(
      ROUTE_THROTTLES.fieldOperations.limit,
    );
    // Profile writes keep the default.
    expect(Reflect.getMetadata(DEFAULT_LIMIT_METADATA, UserController.prototype.updateProfile))
      .toBeUndefined();
  });

  it.each([
    ['requestAccountEmailVerification', ROUTE_THROTTLES.accountEmailVerificationSend.limit],
    ['verifyAccountEmailVerification', ROUTE_THROTTLES.accountEmailVerificationVerify.limit],
  ] as const)('limits signed-in %s below the 60/min default (audit #12)', (handler, limit) => {
    expect(Reflect.getMetadata(DEFAULT_LIMIT_METADATA, AuthController.prototype[handler])).toBe(limit);
    expect(limit).toBeLessThan(60);
  });

  it('makes every route with an address-wide mail policy declare the body schema it validates (review r3)', () => {
    // The throttle runs before the route's validation pipe. Only a declared
    // schema keeps bodies the route rejects out of the address budget, and it
    // has to be the very schema the route validates with.
    const service = new TrafficDefenseService();
    const addressPolicies = service
      .getThrottlerOptions()
      .filter((option) => service.getPolicyIdentity(option.name as TrafficPolicyName) === 'email');
    expect(addressPolicies.length).toBeGreaterThan(0);

    const controllerPath = Reflect.getMetadata(PATH_METADATA, AuthController) as string;
    const prototype = AuthController.prototype as unknown as Record<string, unknown>;
    const covered: string[] = [];
    for (const handlerName of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[handlerName];
      const path: unknown =
        handlerName === 'constructor' ? undefined : Reflect.getMetadata(PATH_METADATA, handler as object);
      if (typeof handler !== 'function' || typeof path !== 'string') {
        continue;
      }

      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      const request = {
        method,
        route: { path: `/api/v1/${controllerPath}/${path}` },
        body: { email: 'probe@example.com' },
        headers: {},
        ip: '198.51.100.7',
        socket: { remoteAddress: '198.51.100.7' },
        user: { id: 'user-1' },
      };
      const context = {
        getType: () => 'http',
        getHandler: () => handler,
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;
      if (!addressPolicies.some((option) => option.skipIf?.(context) === false)) {
        continue;
      }

      covered.push(handlerName);
      const declared: unknown = Reflect.getMetadata(THROTTLE_EMAIL_BODY_METADATA, handler);
      expect(declared, handlerName).toBeDefined();
      expect(declared, handlerName).toBe(bodyValidationSchema(AuthController, handlerName));
    }

    expect(covered.sort()).toEqual([
      'requestAccountEmailVerification',
      'requestEmailVerification',
      'requestReset',
      'resendEmailVerification',
    ]);
  });

  it('tracks the profile call per user and client network', () => {
    const request = (userId: string | undefined, ip: string) =>
      ({
        ip,
        socket: { remoteAddress: ip },
        headers: {},
        ...(userId ? { user: { id: userId } } : {}),
      }) as never;

    expect(resolveCurrentUserProfileTracker(request('scanner-1', '198.51.100.7'))).toBe(
      'profile:user:scanner-1:ip:198.51.100.7',
    );
    expect(resolveCurrentUserProfileTracker(request(undefined, '198.51.100.7'))).toBe(
      'profile:ip:198.51.100.7',
    );
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
