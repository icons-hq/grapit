import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Request } from 'express';

const FALLBACK_IP = '0.0.0.0';
/**
 * API env var holding the secret shared with the Grabit Cloudflare edge Worker.
 * A comma-separated list is accepted so a rotation can run without downtime:
 * the API accepts `old,new` while the Worker switches from old to new.
 */
export const EDGE_PROXY_SHARED_SECRET_ENV = 'EDGE_PROXY_SHARED_SECRET';
/** Header the Grabit edge Worker sets to prove a request came through it. */
export const EDGE_PROXY_SECRET_HEADER = 'x-grabit-edge-secret';
/** Header the Grabit edge Worker sets to the visitor IP Cloudflare observed. */
export const EDGE_CLIENT_IP_HEADER = 'x-grabit-client-ip';
/**
 * `true` makes a production API refuse to start without
 * `EDGE_PROXY_SHARED_SECRET`. Unset (the default) only warns, because a
 * load-balancer fallback or Worker rollback runs without the secret on purpose.
 */
export const EDGE_PROXY_SHARED_SECRET_REQUIRED_ENV = 'EDGE_PROXY_SHARED_SECRET_REQUIRED';
export const EDGE_PROXY_SECRET_MISSING_MESSAGE =
  'CRITICAL: EDGE_PROXY_SHARED_SECRET is not set in production. Client IPs fall back to '
  + 'cf-connecting-ip from Cloudflare peers, which is the Worker egress address on Grabit '
  + 'edge Worker subrequests, so every visitor can share one IP-based rate limit '
  + '(email verification, signup, login, password reset).';
/** At most one "client IP is a Cloudflare address" warning per interval. */
export const CLOUDFLARE_CLIENT_IP_WARNING_INTERVAL_MS = 60_000;

const logger = new Logger('RequestIp');
let lastCloudflareClientIpWarningAtMs: number | null = null;
const CLOUDFLARE_IPV4_CIDRS = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
] as const;
const CLOUDFLARE_IPV6_CIDRS = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
] as const;

/**
 * Resolves the client IP used for throttling, consent records and audit logs.
 *
 * Trust boundary:
 * - With `EDGE_PROXY_SHARED_SECRET` configured, only a request carrying a
 *   matching `x-grabit-edge-secret` header (set by the Grabit edge Worker) may
 *   name its client, through `x-grabit-client-ip` (or `cf-connecting-ip`).
 *   Every other request, including one relayed by somebody else's Cloudflare
 *   Worker straight to the public run.app origin, is identified by its peer.
 *   That includes traffic from a Worker version without the secret or from the
 *   load-balancer fallback, which then collapses into a few Cloudflare peer
 *   IPs: unset the API secret before such a rollback (see the managed-demo
 *   runbook).
 * - Without the secret (rollout fallback), a Cloudflare peer may name its
 *   client through `cf-connecting-ip` only. Cloudflare sets that header on
 *   Worker subrequests to non-Cloudflare origins and a Worker cannot change
 *   it. `True-Client-IP` and `X-Forwarded-For` are never trusted because any
 *   Worker can set them to arbitrary values.
 */
export function resolveTrustedRequestIp(req: Request): string {
  const headers = req.headers ?? {};
  const proxyPeerIp = normalizedIp(req.ip) ?? normalizedIp(req.socket?.remoteAddress);
  const forwardedIp = resolveForwardedClientIp(headers, proxyPeerIp);
  const ip =
    forwardedIp ||
    proxyPeerIp ||
    req.socket?.remoteAddress ||
    FALLBACK_IP;
  const resolved = isIP(ip) ? ip : FALLBACK_IP;
  warnIfCloudflareClientIp(resolved, forwardedIp ? 'forwarded header' : 'peer');
  return resolved;
}

/**
 * A client IP inside Cloudflare's own ranges is a Worker egress or edge
 * address, not a visitor: every request resolved this way shares one
 * IP-based rate limit bucket (the 260517 incident). Usually the edge secret is
 * missing on the API or the Worker, or the Worker stopped sending it.
 */
function warnIfCloudflareClientIp(ip: string, source: 'forwarded header' | 'peer'): void {
  if (!isCloudflareProxyIp(ip)) {
    return;
  }
  const nowMs = Date.now();
  if (
    lastCloudflareClientIpWarningAtMs !== null
    && nowMs - lastCloudflareClientIpWarningAtMs < CLOUDFLARE_CLIENT_IP_WARNING_INTERVAL_MS
  ) {
    return;
  }
  lastCloudflareClientIpWarningAtMs = nowMs;
  logger.warn(
    `Resolved client IP ${ip} (from the ${source}) is a Cloudflare address, so visitors share `
    + `IP-based rate limits. Check EDGE_PROXY_SHARED_SECRET on the API and the edge Worker. `
    + `Logged at most once per minute.`,
  );
}

export type EdgeProxySecretStatus = 'configured' | 'not_production' | 'missing';

export interface EdgeProxySecretCheckReporter {
  critical(message: string): void;
  captureMessage(message: string): void;
}

const defaultEdgeProxySecretReporter: EdgeProxySecretCheckReporter = {
  critical: (message) => logger.error(message),
  captureMessage: (message) => {
    Sentry.captureMessage(message, 'fatal');
  },
};

/**
 * Startup check (main.ts): a production API without `EDGE_PROXY_SHARED_SECRET`
 * logs a CRITICAL line and reports to Sentry. With
 * `EDGE_PROXY_SHARED_SECRET_REQUIRED=true` it throws, so the revision fails to
 * start instead.
 */
export function checkEdgeProxySecretAtStartup(
  env: NodeJS.ProcessEnv = process.env,
  reporter: EdgeProxySecretCheckReporter = defaultEdgeProxySecretReporter,
): EdgeProxySecretStatus {
  const isProduction = env['NODE_ENV'] === 'production' || env['GRABIT_ENV'] === 'production';
  if (!isProduction) {
    return 'not_production';
  }
  if (configuredEdgeSecrets(env).length > 0) {
    return 'configured';
  }

  reporter.critical(EDGE_PROXY_SECRET_MISSING_MESSAGE);
  reporter.captureMessage(EDGE_PROXY_SECRET_MISSING_MESSAGE);
  if (env[EDGE_PROXY_SHARED_SECRET_REQUIRED_ENV]?.trim().toLowerCase() === 'true') {
    throw new Error(
      `${EDGE_PROXY_SECRET_MISSING_MESSAGE} ${EDGE_PROXY_SHARED_SECRET_REQUIRED_ENV}=true, aborting startup.`,
    );
  }
  return 'missing';
}

function resolveForwardedClientIp(
  headers: Request['headers'],
  proxyPeerIp: string | null,
): string | null {
  const edgeSecrets = configuredEdgeSecrets();
  if (edgeSecrets.length > 0) {
    if (!edgeSecretMatches(headers[EDGE_PROXY_SECRET_HEADER], edgeSecrets)) {
      return null;
    }
    return (
      firstHeaderIp(headers[EDGE_CLIENT_IP_HEADER]) ??
      firstHeaderIp(headers['cf-connecting-ip'])
    );
  }

  return isCloudflareProxyIp(proxyPeerIp)
    ? firstHeaderIp(headers['cf-connecting-ip'])
    : null;
}

function configuredEdgeSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env[EDGE_PROXY_SHARED_SECRET_ENV] ?? '')
    .split(',')
    .map((secret) => secret.trim())
    .filter((secret) => secret.length > 0);
}

function edgeSecretMatches(
  value: string | string[] | undefined,
  accepted: string[],
): boolean {
  const provided = (Array.isArray(value) ? value[0] : value)?.trim();
  if (!provided) {
    return false;
  }
  // Compare fixed-length digests so neither content nor length leaks by
  // timing, and check every accepted secret so the match position does not.
  const providedDigest = sha256(provided);
  let matched = false;
  for (const secret of accepted) {
    matched = timingSafeEqual(providedDigest, sha256(secret)) || matched;
  }
  return matched;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function isCloudflareProxyIp(ip: string | null): boolean {
  if (!ip) {
    return false;
  }
  return isIP(ip) === 4
    ? CLOUDFLARE_IPV4_CIDRS.some((cidr) => ipv4InCidr(ip, cidr))
    : CLOUDFLARE_IPV6_CIDRS.some((cidr) => ipv6InCidr(ip, cidr));
}

function normalizedIp(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  if (isIP(value) === 4) {
    return value;
  }
  const mappedIpv4 = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mappedIpv4 && isIP(mappedIpv4) === 4) {
    return mappedIpv4;
  }
  return isIP(value) === 6 ? value : null;
}

function firstHeaderIp(value: string | string[] | undefined): string | null {
  const candidate = (Array.isArray(value) ? value[0] : value)?.trim();
  return candidate ? normalizedIp(candidate) : null;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [network, prefixRaw] = cidr.split('/');
  const prefix = Number(prefixRaw);
  const ipNumber = ipv4ToNumber(ip);
  const networkNumber = network ? ipv4ToNumber(network) : null;
  if (ipNumber === null || networkNumber === null || !Number.isInteger(prefix)) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNumber & mask) === (networkNumber & mask);
}

function ipv4ToNumber(ip: string): number | null {
  if (isIP(ip) !== 4) {
    return null;
  }
  return ip
    .split('.')
    .reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);
}

function ipv6InCidr(ip: string, cidr: string): boolean {
  const [network, prefixRaw] = cidr.split('/');
  const prefix = Number(prefixRaw);
  const ipNumber = ipv6ToBigInt(ip);
  const networkNumber = network ? ipv6ToBigInt(network) : null;
  if (ipNumber === null || networkNumber === null || !Number.isInteger(prefix)) {
    return false;
  }
  const shift = 128n - BigInt(prefix);
  return (ipNumber >> shift) === (networkNumber >> shift);
}

function ipv6ToBigInt(ip: string): bigint | null {
  if (isIP(ip) !== 6) {
    return null;
  }
  const parts = ip.split('::');
  if (parts.length > 2) {
    return null;
  }
  const head = parseIpv6Part(parts[0] ?? '');
  const tail = parseIpv6Part(parts[1] ?? '');
  if (!head || !tail) {
    return null;
  }
  const zeroCount = parts.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<number>(zeroCount).fill(0), ...tail];
  if (zeroCount < 0 || groups.length !== 8) {
    return null;
  }
  return groups.reduce((acc, group) => (acc << 16n) + BigInt(group), 0n);
}

function parseIpv6Part(part: string): number[] | null {
  if (!part) {
    return [];
  }
  return part.split(':').map((group) => Number.parseInt(group, 16));
}
