import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { ThrottlerModuleOptions, ThrottlerOptions } from '@nestjs/throttler';
import { AUTH_COOKIE_NAME } from '@grabit/shared/constants/index.js';
import type { Request } from 'express';
import {
  hashThrottleIdentity,
  resolveThrottleEmail,
  resolveThrottleIpKey,
  resolveThrottleUserId,
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
  'signup',
  'login-account',
  'password-reset-email',
  'email-verification-send',
  'email-verification-verify',
  'account-email-send',
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
 * - `email`: the normalized request email across every IP. Only for anonymous
 *   routes whose side effect lands on that address (mail sends), so one
 *   address cannot be flooded from many IPs. The route's IP-scoped default
 *   bucket still caps how many addresses one IP can target. Such a route must
 *   mail every address whose owner can use the flow: a request that sends
 *   nothing still spends the address budget, and only real mail tells the
 *   owner what is going on (and hands them a fresh code or link).
 * - `email-ip`: the normalized request email from one client IP. Used where a
 *   cross-IP cap would let anyone lock a victim out (login, code verify).
 * - `user-email`: the normalized request email per JWT-verified user (per
 *   client IP when anonymous). For signed-in routes that may refuse to send,
 *   such as a 409 for an address another account owns: one account's
 *   requests must not spend a budget that the address owner needs.
 * Identity policies skip requests that carry no usable email; the route's
 * default bucket still applies to them.
 */
type PolicyIdentity = 'principal' | 'email' | 'email-ip' | 'user-email';

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
    // Signed-in account email codes. The handler answers 409 without mail for
    // an address another account owns, so this is per account and address,
    // never shared with the owner's own request/resend or account-email flow.
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
};

const DEFAULT_THROTTLER = {
  name: 'default',
  // @nestjs/throttler v6 uses ms units: 60_000ms = 1 minute global default.
  ttl: 60_000,
  limit: 60,
} as const;

const REFRESH_ROUTE_PATTERN = /\/auth\/refresh$/;

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
        getTracker: (req) => this.resolveTracker(name, req as RequestLike),
        ...(definition.shareBucketAcrossRoutes
          ? {
              generateKey: (_context: ExecutionContext, tracker: string, throttlerName: string) =>
                createHash('sha256').update(`${throttlerName}-${tracker}`).digest('hex'),
            }
          : {}),
      };
    });
  }

  /**
   * Bucket identity for a named policy. Never derived from cookies or
   * admission tokens: the client can mint those at will, so they would hand
   * out a fresh bucket per request.
   */
  resolveTracker(policy: TrafficPolicyName, req: RequestLike): string {
    const identity = TRAFFIC_POLICIES[policy].identity ?? 'principal';
    const ipKey = resolveThrottleIpKey(req);

    if (identity === 'principal') {
      const userId = resolveThrottleUserId(req);
      return userId ? `${policy}:user:${userId}` : `${policy}:ip:${ipKey}`;
    }

    const email = resolveThrottleEmail(req, TRAFFIC_POLICIES[policy].emailSource);
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
      REFRESH_ROUTE_PATTERN.test(this.resolveRoutePath(request)) &&
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

    const identity = TRAFFIC_POLICIES[policy].identity ?? 'principal';
    if (identity === 'principal') {
      return true;
    }

    return (
      resolveThrottleEmail(
        context.switchToHttp().getRequest<RequestLike>(),
        TRAFFIC_POLICIES[policy].emailSource,
      ) !== null
    );
  }

  private matchesPolicy(policy: TrafficPolicyName, context: ExecutionContext): boolean {
    if (context.getType<'http' | 'ws' | 'rpc'>() !== 'http') {
      return false;
    }

    const request = context.switchToHttp().getRequest<RequestLike>();
    const path = this.resolveRoutePath(request);
    const method = this.resolveRouteMethod(request);

    return TRAFFIC_POLICIES[policy].matchers.some((matcher) => {
      if (matcher.method !== method) {
        return false;
      }

      return matcher.patterns.some((pattern) => pattern.test(path));
    });
  }

  /**
   * The path a policy is matched against. The Express router accepts several
   * spellings for one handler: it matches case-insensitively by default
   * (Express 5 `case sensitive routing` off) and ignores a trailing slash. The
   * raw URL would let `/auth/LOGIN` skip every policy the handler relies on,
   * so match the template of the route that dispatched the request. Outside a
   * routed request, fall back to the URL with the same folding.
   */
  private resolveRoutePath(request: RequestLike): string {
    const routePath = request.route?.path;
    return this.normalizePath(
      typeof routePath === 'string' && routePath.length > 0
        ? routePath
        : (request.originalUrl ?? request.url ?? ''),
    );
  }

  /** Express serves HEAD with the GET handler, so it is the same route. */
  private resolveRouteMethod(request: RequestLike): string {
    const method = (request.method ?? 'GET').toUpperCase();
    return method === 'HEAD' ? 'GET' : method;
  }

  private normalizePath(path: string): string {
    const withoutQuery = (path.split('?')[0] ?? path).toLowerCase();
    if (!withoutQuery) {
      return '/';
    }

    return withoutQuery.replace(/\/+$/, '') || '/';
  }
}
