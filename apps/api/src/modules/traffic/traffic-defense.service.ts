import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions, ThrottlerOptions } from '@nestjs/throttler';
import { AUTH_COOKIE_NAME } from '@grabit/shared/constants/index.js';
import type { Request } from 'express';
import { resolveRoutePath } from './route-path.js';
import {
  hashThrottleIdentity,
  resolveThrottleEmail,
  resolveThrottleIpKey,
  resolveThrottleUserId,
  resolveValidatedThrottleEmail,
  THROTTLE_EMAIL_BODY_METADATA,
  type ThrottleEmailBodySchema,
  type ThrottleEmailSource,
} from './throttle-identity.js';

export const TRAFFIC_RATE_LIMITED = 'TRAFFIC_RATE_LIMITED';
export const SECURITY_CHALLENGE_REQUIRED = 'SECURITY_CHALLENGE_REQUIRED';
export const SECURITY_BLOCKED = 'SECURITY_BLOCKED';

const TRAFFIC_POLICY_NAMES = [
  'queue-entry',
  'lock-seat',
  'prepare-reservation',
  'confirm-payment',
  'async-payment-return',
  'signup',
  'login-account',
  'password-reset-email',
  'email-verification-send',
  'email-verification-verify',
  // Keep after account-email-send: throttlers with the same ttl run in this
  // order, and a request that account-email-send rejects must not reach and
  // spend the cross-account address bucket.
  'account-email-send',
  'account-email-address',
] as const;

export type TrafficPolicyName = (typeof TRAFFIC_POLICY_NAMES)[number];
export type TrafficDecisionCode =
  | typeof TRAFFIC_RATE_LIMITED
  | typeof SECURITY_CHALLENGE_REQUIRED
  | typeof SECURITY_BLOCKED;

type RequestLike = Request & {
  user?: { id?: string; userId?: string };
  cookies?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  /** Set by the Express router to the route that dispatched the request. */
  route?: { path?: unknown };
};

/**
 * Policies match against the route template that dispatched the request
 * (`/api/v1/auth/login`, `/api/v1/queue/performances/:performanceId/enter`),
 * lower-cased, without a trailing slash. Patterns must be lower-case.
 */
type PolicyRouteMatcher = {
  method: string;
  patterns: RegExp[];
};

/**
 * Who a policy bucket belongs to.
 * - `principal`: the JWT-verified user, otherwise the trusted client IP.
 * - `email`: the normalized request email across every IP (and account). Only
 *   for routes whose side effect lands on that address (mail sends), so one
 *   address cannot be flooded from many IPs or accounts. The route's default
 *   bucket still caps how many addresses one IP or user can target. Since
 *   anyone can spend this budget, the route must declare its body schema with
 *   `@ThrottleEmailBody` (bodies it rejects are not counted) and should mail
 *   every address whose owner can use the flow: then whoever spends an
 *   owner's budget also hands the owner fresh codes or links and shows them
 *   what is going on.
 * - `email-ip`: the normalized request email from one client IP. Used where a
 *   cross-IP cap would let anyone lock a victim out (login, code verify).
 * - `user-email`: the normalized request email per JWT-verified user (per
 *   client IP when anonymous). One account's share of an address.
 * Identity policies skip requests that carry no usable email, or that the
 * route's declared body schema rejects; the route's default bucket still
 * applies to them.
 */
export type PolicyIdentity = 'principal' | 'email' | 'email-ip' | 'user-email';

type TrafficPolicyDefinition = {
  ttl: number;
  limit: number;
  matchers: PolicyRouteMatcher[];
  identity?: PolicyIdentity;
  /**
   * Where the matched routes read the email (identities other than `principal`).
   * Must be the same source the handler or strategy uses. Defaults to `body`.
   */
  emailSource?: ThrottleEmailSource;
  /** One bucket for every matched route instead of one bucket per route. */
  shareBucketAcrossRoutes?: boolean;
};

const MINUTE_MS = 60_000;
const FIFTEEN_MINUTES_MS = 15 * MINUTE_MS;

export type TrafficDecision =
  | { action: 'allow'; policy: TrafficPolicyName }
  | { action: 'rate-limit'; code: typeof TRAFFIC_RATE_LIMITED; policy: TrafficPolicyName }
  | {
      action: 'challenge';
      code: typeof SECURITY_CHALLENGE_REQUIRED;
      policy: TrafficPolicyName;
    }
  | { action: 'block'; code: typeof SECURITY_BLOCKED; policy: TrafficPolicyName };

export type TrafficMacroSignalSnapshot = {
  repeatedAttempts: number;
  distinctAccountCount?: number;
  distinctPhoneCount?: number;
  distinctEmailCount?: number;
  distinctPaymentMethodCount?: number;
  distinctDeviceCount?: number;
  distinctAdmissionTokenCount?: number;
  forceChallenge?: boolean;
  forceBlock?: boolean;
};

const TRAFFIC_POLICIES: Record<TrafficPolicyName, TrafficPolicyDefinition> = {
  'queue-entry': {
    ttl: 60_000,
    limit: 20,
    matchers: [
      {
        method: 'GET',
        patterns: [/\/booking$/, /\/queue\/entry$/],
      },
      {
        method: 'POST',
        patterns: [/\/queue\/entry$/, /\/queue\/performances\/[^/]+\/enter$/],
      },
    ],
  },
  'lock-seat': {
    ttl: 15_000,
    limit: 12,
    matchers: [
      {
        method: 'POST',
        patterns: [/\/booking\/seats\/lock$/],
      },
    ],
  },
  'prepare-reservation': {
    ttl: 60_000,
    limit: 8,
    matchers: [
      {
        method: 'POST',
        patterns: [/\/reservations\/prepare$/],
      },
    ],
  },
  'confirm-payment': {
    ttl: 60_000,
    limit: 6,
    matchers: [
      {
        method: 'POST',
        patterns: [/\/payments\/confirm$/],
      },
    ],
  },
  // The pending return page reconciles once per mount; each call may query Toss.
  'async-payment-return': {
    ttl: 60_000,
    limit: 6,
    matchers: [
      {
        method: 'POST',
        patterns: [/\/payments\/async-return$/],
      },
    ],
  },
  signup: {
    // Per client IP. Registration also requires a verified phone, so the IP
    // cap only needs to stop bursts while leaving room for a shared NAT.
    ttl: 60_000,
    limit: 20,
    matchers: [
      {
        method: 'POST',
        patterns: [/\/auth\/register$/],
      },
    ],
  },
  'login-account': {
    // Every attempt counts, successful ones included, so the window leaves
    // room for a shared scanner account signing in on a gate fleet and for CI
    // logins. Sustained guessing stays at 2/min per account and IP.
    ttl: FIFTEEN_MINUTES_MS,
    limit: 30,
    identity: 'email-ip',
    // passport-local reads `email` from the body, then from the query string.
    emailSource: 'body-or-query',
    matchers: [
      {
        method: 'POST',
        patterns: [/\/auth\/login$/],
      },
    ],
  },
  'password-reset-email': {
    ttl: FIFTEEN_MINUTES_MS,
    limit: 3,
    identity: 'email',
    matchers: [
      {
        method: 'POST',
        patterns: [/\/auth\/password-reset\/request$/],
      },
    ],
  },
  'email-verification-send': {
    // Anonymous request/resend mail every address that has an account and
    // send nothing otherwise (signup itself mails the first code).
    ttl: FIFTEEN_MINUTES_MS,
    limit: 5,
    identity: 'email',
    shareBucketAcrossRoutes: true,
    matchers: [
      {
        method: 'POST',
        patterns: [/\/auth\/email-verification\/(request|resend)$/],
      },
    ],
  },
  'email-verification-verify': {
    ttl: FIFTEEN_MINUTES_MS,
    limit: 10,
    identity: 'email-ip',
    matchers: [
      {
        method: 'POST',
        patterns: [/\/auth\/email-verification\/(verify|account-email\/verify)$/],
      },
    ],
  },
  'account-email-send': {
    // Signed-in account email codes, one account's share of an address.
    ttl: FIFTEEN_MINUTES_MS,
    limit: 5,
    identity: 'user-email',
    matchers: [
      {
        method: 'POST',
        patterns: [/\/auth\/email-verification\/account-email\/request$/],
      },
    ],
  },
  'account-email-address': {
    // Signed-in account email codes to one address across every account, so
    // more accounts do not multiply account-email-send into a mail flood. Kept
    // apart from the anonymous request/resend bucket: the handler answers 409
    // without mail for an address another account owns, and that owner still
    // has request/resend for their own address.
    ttl: FIFTEEN_MINUTES_MS,
    limit: 10,
    identity: 'email',
    matchers: [
      {
        method: 'POST',
        patterns: [/\/auth\/email-verification\/account-email\/request$/],
      },
    ],
  },
};

const DEFAULT_THROTTLER = {
  name: 'default',
  // @nestjs/throttler v6 uses ms units: 60_000ms = 1 minute global default.
  ttl: 60_000,
  limit: 60,
} as const;

const REFRESH_ROUTE_PATTERN = /\/auth\/refresh$/;

const reflector = new Reflector();

@Injectable()
export class TrafficDefenseService {
  /** ThrottlerModule options shared by AppModule and the HTTP throttle specs. */
  getThrottlerModuleConfig(): Pick<
    Extract<ThrottlerModuleOptions, { throttlers: ThrottlerOptions[] }>,
    'throttlers' | 'errorMessage'
  > {
    return {
      throttlers: [this.getDefaultThrottlerOptions(), ...this.getThrottlerOptions()],
      errorMessage: TRAFFIC_RATE_LIMITED,
    };
  }

  getDefaultThrottlerOptions(): ThrottlerOptions {
    return {
      ...DEFAULT_THROTTLER,
      skipIf: (context) => this.shouldSkipDefaultThrottle(context),
      getTracker: (req) => this.resolveDefaultTracker(req as RequestLike),
    };
  }

  getThrottlerOptions(): ThrottlerOptions[] {
    return TRAFFIC_POLICY_NAMES.map((name) => {
      const definition = TRAFFIC_POLICIES[name];
      return {
        name,
        ttl: definition.ttl,
        limit: definition.limit,
        skipIf: (context) => !this.appliesToRequest(name, context),
        getTracker: (req, context) => this.resolveTracker(name, req as RequestLike, context),
        ...(definition.shareBucketAcrossRoutes
          ? {
              generateKey: (_context: ExecutionContext, tracker: string, throttlerName: string) =>
                createHash('sha256').update(`${throttlerName}-${tracker}`).digest('hex'),
            }
          : {}),
      };
    });
  }

  /** Who a named policy's buckets belong to (see `PolicyIdentity`). */
  getPolicyIdentity(policy: TrafficPolicyName): PolicyIdentity {
    return TRAFFIC_POLICIES[policy].identity ?? 'principal';
  }

  /**
   * Bucket identity for a named policy. Never derived from cookies or
   * admission tokens: the client can mint those at will, so they would hand
   * out a fresh bucket per request. `context` is the throttled route; email
   * policies read its `@ThrottleEmailBody` schema from it.
   */
  resolveTracker(
    policy: TrafficPolicyName,
    req: RequestLike,
    context?: ExecutionContext,
  ): string {
    const identity = this.getPolicyIdentity(policy);
    const ipKey = resolveThrottleIpKey(req);

    if (identity === 'principal') {
      const userId = resolveThrottleUserId(req);
      return userId ? `${policy}:user:${userId}` : `${policy}:ip:${ipKey}`;
    }

    const email = this.resolvePolicyEmail(policy, req, context);
    if (!email) {
      return `${policy}:ip:${ipKey}`;
    }

    const emailKey = hashThrottleIdentity(email);
    if (identity === 'email') {
      return `${policy}:email:${emailKey}`;
    }
    if (identity === 'user-email') {
      const userId = resolveThrottleUserId(req);
      return userId
        ? `${policy}:user:${userId}:email:${emailKey}`
        : `${policy}:email-ip:${emailKey}:${ipKey}`;
    }
    return `${policy}:email-ip:${emailKey}:${ipKey}`;
  }

  /**
   * The verified user for authenticated routes, otherwise the trusted client
   * IP. Client-supplied cookies are ignored: a fresh random cookie per request
   * would otherwise bypass every anonymous limit (login, signup, reset).
   */
  resolveDefaultTracker(req: RequestLike): string {
    const userId = resolveThrottleUserId(req);
    if (userId) {
      return `default:user:${userId}`;
    }

    return `default:ip:${resolveThrottleIpKey(req)}`;
  }

  shouldSkipDefaultThrottle(context: ExecutionContext): boolean {
    if (context.getType<'http' | 'ws' | 'rpc'>() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestLike>();
    const method = this.resolveRouteMethod(request);
    if (method === 'OPTIONS') {
      return true;
    }

    // AuthInitializer calls POST /auth/refresh on every page load. Without a
    // refresh cookie the handler returns 204 without touching storage, so
    // counting it would only make anonymous visitors behind one NAT block
    // each other.
    return (
      method === 'POST' &&
      REFRESH_ROUTE_PATTERN.test(resolveRoutePath(request)) &&
      !request.cookies?.[AUTH_COOKIE_NAME]
    );
  }

  rateLimited(policy: TrafficPolicyName): TrafficDecision {
    return {
      action: 'rate-limit',
      code: TRAFFIC_RATE_LIMITED,
      policy,
    };
  }

  evaluateSecurityDecision(
    policy: TrafficPolicyName,
    snapshot: TrafficMacroSignalSnapshot,
  ): TrafficDecision {
    if (snapshot.forceBlock) {
      return {
        action: 'block',
        code: SECURITY_BLOCKED,
        policy,
      };
    }

    const suspiciousAxes = [
      snapshot.distinctAccountCount,
      snapshot.distinctPhoneCount,
      snapshot.distinctEmailCount,
      snapshot.distinctPaymentMethodCount,
      snapshot.distinctDeviceCount,
      snapshot.distinctAdmissionTokenCount,
    ].filter((count) => (count ?? 0) > 1).length;

    if (snapshot.repeatedAttempts >= 10 && suspiciousAxes >= 3) {
      return {
        action: 'block',
        code: SECURITY_BLOCKED,
        policy,
      };
    }

    if (snapshot.forceChallenge || (snapshot.repeatedAttempts >= 5 && suspiciousAxes >= 2)) {
      return {
        action: 'challenge',
        code: SECURITY_CHALLENGE_REQUIRED,
        policy,
      };
    }

    return { action: 'allow', policy };
  }

  private appliesToRequest(policy: TrafficPolicyName, context: ExecutionContext): boolean {
    if (!this.matchesPolicy(policy, context)) {
      return false;
    }

    if (this.getPolicyIdentity(policy) === 'principal') {
      return true;
    }

    return (
      this.resolvePolicyEmail(policy, context.switchToHttp().getRequest<RequestLike>(), context) !==
      null
    );
  }

  /**
   * The normalized email an identity policy keys on, or `null` to skip it.
   * With a `@ThrottleEmailBody` schema on the route, only a body the route
   * will accept counts, keyed by its parsed email. Otherwise the raw email
   * from the policy's `emailSource` (login reads it like passport-local).
   */
  private resolvePolicyEmail(
    policy: TrafficPolicyName,
    req: RequestLike,
    context: ExecutionContext | undefined,
  ): string | null {
    const schema = this.resolveEmailBodySchema(context);
    if (schema) {
      return resolveValidatedThrottleEmail(req, schema);
    }

    return resolveThrottleEmail(req, TRAFFIC_POLICIES[policy].emailSource);
  }

  private resolveEmailBodySchema(
    context: ExecutionContext | undefined,
  ): ThrottleEmailBodySchema | undefined {
    if (typeof context?.getHandler !== 'function') {
      return undefined;
    }

    return reflector.get<ThrottleEmailBodySchema | undefined>(
      THROTTLE_EMAIL_BODY_METADATA,
      context.getHandler(),
    );
  }

  private matchesPolicy(policy: TrafficPolicyName, context: ExecutionContext): boolean {
    if (context.getType<'http' | 'ws' | 'rpc'>() !== 'http') {
      return false;
    }

    const request = context.switchToHttp().getRequest<RequestLike>();
    const path = resolveRoutePath(request);
    const method = this.resolveRouteMethod(request);

    return TRAFFIC_POLICIES[policy].matchers.some((matcher) => {
      if (matcher.method !== method) {
        return false;
      }

      return matcher.patterns.some((pattern) => pattern.test(path));
    });
  }

  /** Express serves HEAD with the GET handler, so it is the same route. */
  private resolveRouteMethod(request: RequestLike): string {
    const method = (request.method ?? 'GET').toUpperCase();
    return method === 'HEAD' ? 'GET' : method;
  }
}
