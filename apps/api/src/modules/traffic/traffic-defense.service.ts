import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import { AUTH_COOKIE_NAME } from '@grabit/shared/constants/index.js';
import type { Request } from 'express';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';

export const TRAFFIC_RATE_LIMITED = 'TRAFFIC_RATE_LIMITED';
export const SECURITY_CHALLENGE_REQUIRED = 'SECURITY_CHALLENGE_REQUIRED';
export const SECURITY_BLOCKED = 'SECURITY_BLOCKED';

const TRAFFIC_POLICY_NAMES = [
  'queue-entry',
  'lock-seat',
  'prepare-reservation',
  'confirm-payment',
  'signup',
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
};

type PolicyRouteMatcher = {
  method: string;
  patterns: RegExp[];
};

type TrafficPolicyDefinition = {
  ttl: number;
  limit: number;
  matchers: PolicyRouteMatcher[];
};

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
    ttl: 60_000,
    limit: 5,
    matchers: [
      {
        method: 'POST',
        patterns: [/\/auth\/register$/],
      },
    ],
  },
};

@Injectable()
export class TrafficDefenseService {
  getThrottlerOptions(): ThrottlerOptions[] {
    return TRAFFIC_POLICY_NAMES.map((name) => ({
      name,
      ttl: TRAFFIC_POLICIES[name].ttl,
      limit: TRAFFIC_POLICIES[name].limit,
      skipIf: (context) => !this.matchesPolicy(name, context),
      getTracker: (req) => this.resolveTracker(name, req as RequestLike),
    }));
  }

  resolveTracker(policy: TrafficPolicyName, req: RequestLike): string {
    const userId = this.resolveUserId(req);
    const sessionCookie = this.resolveSessionCookie(req);
    const admissionToken = this.resolveAdmissionToken(req);
    const ip = resolveTrustedRequestIp(req);

    if (policy === 'queue-entry') {
      if (userId) {
        return `${policy}:user:${userId}`;
      }

      if (sessionCookie) {
        return `${policy}:session-ip:${this.hashIdentity(sessionCookie)}:${ip}`;
      }

      if (admissionToken) {
        return `${policy}:admission:${this.hashIdentity(admissionToken)}`;
      }

      return `${policy}:ip:${ip}`;
    }

    if (userId) {
      return `${policy}:user:${userId}`;
    }

    if (sessionCookie) {
      return `${policy}:session:${this.hashIdentity(sessionCookie)}`;
    }

    if (admissionToken) {
      return `${policy}:admission:${this.hashIdentity(admissionToken)}`;
    }

    return `${policy}:ip:${ip}`;
  }

  resolveDefaultTracker(req: RequestLike): string {
    const userId = this.resolveUserId(req);
    const sessionCookie = this.resolveSessionCookie(req);
    const ip = resolveTrustedRequestIp(req);

    if (userId) {
      return `default:user:${userId}`;
    }

    if (sessionCookie) {
      return `default:session:${this.hashIdentity(sessionCookie)}`;
    }

    return `default:ip:${ip}`;
  }

  shouldSkipDefaultThrottle(context: ExecutionContext): boolean {
    if (context.getType<'http' | 'ws' | 'rpc'>() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestLike>();
    return (request.method ?? 'GET').toUpperCase() === 'OPTIONS';
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

  private matchesPolicy(policy: TrafficPolicyName, context: ExecutionContext): boolean {
    if (context.getType<'http' | 'ws' | 'rpc'>() !== 'http') {
      return false;
    }

    const request = context.switchToHttp().getRequest<RequestLike>();
    const path = this.normalizePath(request.originalUrl ?? request.url ?? '');
    const method = (request.method ?? 'GET').toUpperCase();

    return TRAFFIC_POLICIES[policy].matchers.some((matcher) => {
      if (matcher.method !== method) {
        return false;
      }

      return matcher.patterns.some((pattern) => pattern.test(path));
    });
  }

  private resolveUserId(req: RequestLike): string | null {
    const userId = req.user?.id ?? req.user?.userId;
    return typeof userId === 'string' && userId.length > 0 ? userId : null;
  }

  private resolveSessionCookie(req: RequestLike): string | null {
    const cookies = req.cookies ?? {};
    const queueSessionCookie = cookies['queueSessionId'];
    const authCookie = cookies[AUTH_COOKIE_NAME];
    const genericSessionCookie = cookies['session'];
    const value = queueSessionCookie ?? authCookie ?? genericSessionCookie;

    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private resolveAdmissionToken(req: RequestLike): string | null {
    const headerValue = req.headers['x-queue-admission-token'];
    const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const bodyQueueAdmission =
      this.readNestedString(req.body, 'queueAdmission', 'admissionToken') ??
      this.readFlatString(req.body, 'admissionToken');
    const queryQueueAdmission =
      this.readFlatString(req.query, 'admissionToken') ??
      this.readFlatString(req.query, 'queueAdmissionToken');

    const value = headerToken ?? bodyQueueAdmission ?? queryQueueAdmission;

    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private readNestedString(
    payload: Record<string, unknown> | undefined,
    parentKey: string,
    childKey: string,
  ): string | null {
    const candidate = payload?.[parentKey];
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const value = (candidate as Record<string, unknown>)[childKey];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private readFlatString(
    payload: Record<string, unknown> | undefined,
    key: string,
  ): string | null {
    const value = payload?.[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private hashIdentity(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
  }

  private normalizePath(path: string): string {
    const withoutQuery = path.split('?')[0] ?? path;
    if (!withoutQuery) {
      return '/';
    }

    return withoutQuery.replace(/\/+$/, '') || '/';
  }
}
