import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';

/**
 * Throttle identity helpers.
 *
 * A throttle tracker must only be built from values the client cannot mint at
 * will: the JWT-verified user, or the trusted client IP. Anything the client
 * chooses freely (cookies, admission headers, emails) may only be combined
 * with one of those, or be paired with an IP-scoped ceiling on the same route,
 * otherwise rotating the value creates a fresh bucket per request.
 */
export type ThrottleRequestLike = Request & {
  user?: { id?: string; userId?: string };
  body?: unknown;
  query?: unknown;
};

/**
 * Where a route reads the email it acts on.
 * - `body`: Zod-validated JSON bodies (password reset, email verification).
 *   The query string is ignored there, so it must not move the bucket either.
 * - `body-or-query`: passport-local, which takes `body.email` and falls back to
 *   `query.email` (`lookup(req.body) || lookup(req.query)`). The throttle has
 *   to read the same value, or `?email=<victim>` would skip the email policy.
 */
export type ThrottleEmailSource = 'body' | 'body-or-query';

export function resolveThrottleUserId(req: ThrottleRequestLike): string | null {
  const userId = req.user?.id ?? req.user?.userId;
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}

/**
 * Returns the trusted client IP as a throttle key. IPv6 clients are grouped
 * by their /64 prefix because a single subscriber usually controls a whole
 * /64 and could otherwise rotate addresses to get a fresh bucket per request.
 */
export function resolveThrottleIpKey(req: ThrottleRequestLike): string {
  return toThrottleIpKey(resolveTrustedRequestIp(req));
}

export function toThrottleIpKey(ip: string): string {
  const withoutZone = ip.split('%')[0] ?? ip;
  if (isIP(withoutZone) !== 6) {
    return ip;
  }

  const prefix = ipv6Prefix64(withoutZone);
  return prefix ? `${prefix}::/64` : ip;
}

export function resolveThrottleEmail(
  req: ThrottleRequestLike,
  source: ThrottleEmailSource = 'body',
): string | null {
  const raw =
    credentialField(req.body, 'email') ??
    (source === 'body-or-query' ? credentialField(req.query, 'email') : null);
  return raw === null ? null : normalizeThrottleEmail(raw);
}

/** Email policies key on the address as the account lookup reads it: trimmed, any case. */
export function normalizeThrottleEmail(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export const THROTTLE_EMAIL_BODY_METADATA = 'grabit:throttle-email-body';

/** The subset of a Zod schema the throttle needs (`z.object({ email: ... })`). */
export type ThrottleEmailBodySchema = {
  safeParse(value: unknown): { success: true; data: { email: string } } | { success: false };
};

/**
 * Declares the body schema of a route whose email traffic policies spend a
 * per-address budget. Pass the same schema as the route's
 * `@Body(new ZodValidationPipe(schema))`.
 *
 * ThrottlerGuard runs before that pipe. Without this, a body the route rejects
 * with 400 (an unknown `locale`, a malformed `frontendOrigin`) sends no mail
 * but still fills the address bucket, so anyone could keep an owner's reset or
 * verification mail blocked without one mail arriving. With it, the email
 * policies skip bodies the schema rejects and key on the parsed email. The
 * route's default bucket (per IP, or per user when signed in) still counts
 * every request. route-throttles.spec checks that every route with an
 * address-wide policy declares the schema its `@Body` pipe uses.
 */
export function ThrottleEmailBody(schema: ThrottleEmailBodySchema): MethodDecorator {
  return SetMetadata(THROTTLE_EMAIL_BODY_METADATA, schema);
}

/**
 * The email an email policy keys on for a declared body schema: the parsed,
 * normalized email, or `null` when the route will reject the body.
 */
export function resolveValidatedThrottleEmail(
  req: ThrottleRequestLike,
  schema: ThrottleEmailBodySchema,
): string | null {
  const parsed = schema.safeParse(req.body);
  return parsed.success ? normalizeThrottleEmail(parsed.data.email) : null;
}

export function hashThrottleIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

/**
 * Same value rules as passport-local's `lookup`: a truthy, non-object field.
 * Falsy values ('' / 0 / false) and arrays/objects count as absent, so the
 * caller falls through to the next source exactly like passport-local does.
 */
function credentialField(source: unknown, field: string): string | null {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const value = (source as Record<string, unknown>)[field];
  if (!value || typeof value === 'object') {
    return null;
  }

  return String(value);
}

function ipv6Prefix64(ip: string): string | null {
  // IPv4-mapped/embedded forms are rare on the wire; keep the full address.
  if (ip.includes('.')) {
    return null;
  }

  const hasCompression = ip.includes('::');
  const [headRaw = '', tailRaw = ''] = ip.split('::');
  const head = headRaw ? headRaw.split(':') : [];
  const tail = hasCompression && tailRaw ? tailRaw.split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (!hasCompression && missing !== 0)) {
    return null;
  }

  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  const parsed = groups.slice(0, 4).map((group) => Number.parseInt(group, 16));
  if (parsed.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) {
    return null;
  }

  return parsed.map((group) => group.toString(16)).join(':');
}
