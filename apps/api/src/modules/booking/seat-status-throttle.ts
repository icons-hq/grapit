import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { resolveThrottleIpKey } from '../traffic/throttle-identity.js';

/**
 * Rate limit for the public seat status read (audit #8).
 *
 * The response is served from a short shared cache, so the budget only caps
 * per-client floods. It leaves room for the booking page's re-reads after
 * every own lock/unlock, which the lock-seat policy already bounds.
 */
export const SEAT_STATUS_THROTTLE_LIMIT = 60;
export const SEAT_STATUS_THROTTLE_TTL_MS = 10_000;

const accessTokenVerifier = new JwtService();

function readBearerToken(req: Request): string | null {
  const header = req.headers?.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

/**
 * Subject of a valid access token. Only selects the rate-limit bucket: the
 * route stays public and nothing is authorized from it. A client cannot mint a
 * new bucket per request because the signature must verify.
 */
function readVerifiedSubject(req: Request): string | null {
  const token = readBearerToken(req);
  const secret = process.env['JWT_SECRET'];
  if (!token || !secret) return null;

  try {
    const payload = accessTokenVerifier.verify<{ sub?: unknown }>(token, { secret });
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Booking page readers always carry an access token (the page requires login
 * and queue admission), so they are limited per account and never share a
 * bucket behind carrier NAT. Everything else is limited per trusted client IP,
 * IPv6 clients per /64 prefix: a subscriber controls the whole /64 and could
 * otherwise rotate addresses for a fresh bucket per request.
 */
export function resolveSeatStatusThrottleTracker(req: Record<string, unknown>): string {
  const request = req as unknown as Request;
  const subject = readVerifiedSubject(request);
  return subject
    ? `seat-status:user:${subject}`
    : `seat-status:ip:${resolveThrottleIpKey(request)}`;
}

export const SEAT_STATUS_THROTTLE = {
  limit: SEAT_STATUS_THROTTLE_LIMIT,
  ttl: SEAT_STATUS_THROTTLE_TTL_MS,
  getTracker: resolveSeatStatusThrottleTracker,
};
