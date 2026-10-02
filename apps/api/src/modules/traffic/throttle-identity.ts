import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
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
};

const MAX_EMAIL_LENGTH = 320;

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

export function resolveThrottleEmail(req: ThrottleRequestLike): string | null {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return null;
  }

  const email = (body as Record<string, unknown>)['email'];
  if (typeof email !== 'string') {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= MAX_EMAIL_LENGTH ? normalized : null;
}

export function hashThrottleIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
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
